import { getDb } from './database.js';

/**
 * 种子数据：自适应词汇匹配规则
 */
export function seedDefaultCampaignRules(influencerId) {
  const db = getDb();
  
  const check = db.prepare('SELECT 1 FROM campaign_rules WHERE influencer_id = ? LIMIT 1').get(influencerId);
  if (check) return;
  
  console.log(`[Campaign Engine] 正在初始化大V [${influencerId}] 的默认交易匹配规则库...`);
  const rules = [
    { type: 'open', regex: '进场|建仓|买入|开仓|上仓|多单|进二成|买点|打底' },
    { type: 'close', regex: '出完|清仓|走了|出清|平仓|止损|砍了|割了|割肉|获利了结|全部出' },
    { type: 'adjust', regex: '做T|做t|加仓|减仓|高抛低吸|仓位|底仓|底仓T|加点|减点' }
  ];
  
  const stmt = db.prepare(`
    INSERT INTO campaign_rules (influencer_id, pattern_type, keyword_regex, confidence_weight)
    VALUES (?, ?, ?, 1.0)
  `);
  
  for (const r of rules) {
    stmt.run(influencerId, r.type, r.regex);
  }
  console.log('[Campaign Engine] 默认交易规则初始化成功。');
}

/**
 * 获取特定大V的规则库并编译为 RegExp
 */
function getCompiledRules(influencerId) {
  const db = getDb();
  seedDefaultCampaignRules(influencerId); // 防御性种子注册

  const rows = db.prepare('SELECT pattern_type, keyword_regex FROM campaign_rules WHERE influencer_id = ?').all(influencerId);
  
  const rulesMap = { open: [], close: [], adjust: [] };
  for (const r of rows) {
    rulesMap[r.pattern_type].push(new RegExp(r.keyword_regex, 'i'));
  }
  return rulesMap;
}

/**
 * 评估消息命中的操作类型
 * @returns {'open' | 'close' | 'adjust' | 'comment'}
 */
function matchMessageAction(content, compiledRules) {
  // 1. 优先匹配平仓/关闭
  for (const rx of compiledRules.close) {
    if (rx.test(content)) return 'close';
  }
  // 2. 匹配加减仓/调整
  for (const rx of compiledRules.adjust) {
    if (rx.test(content)) return 'adjust';
  }
  // 3. 匹配建仓/开启
  for (const rx of compiledRules.open) {
    if (rx.test(content)) return 'open';
  }
  return 'comment';
}

/**
 * 处理单条大V消息，进行战役状态流转与多对多关联
 */
export async function processMessageForCampaigns(msg) {
  if (!msg.tickers || msg.tickers.trim() === '') return;
  const db = getDb();
  
  const influencerId = msg.sender_id;
  const compiledRules = getCompiledRules(influencerId);
  
  // 提取个股 (tickers 是以逗号包裹的格式, 如 ,NVDA,TSLA,)
  const tickers = msg.tickers.split(',').filter(Boolean);
  
  for (const ticker of tickers) {
    const action = matchMessageAction(msg.content, compiledRules);
    
    // 查询当前活跃状态下的战役
    let activeCampaign = db.prepare(`
      SELECT * FROM campaigns 
      WHERE influencer_id = ? AND ticker = ? AND status = 'active'
    `).get(influencerId, ticker);
    
    let campaignId;
    
    if (action === 'close') {
      if (activeCampaign) {
        // 1. 正常平仓关闭现有战役
        db.prepare(`
          UPDATE campaigns 
          SET status = 'closed', close_time = ?, close_reason = ?, updated_at = ?
          WHERE id = ?
        `).run(msg.created_at, msg.content, msg.created_at, activeCampaign.id);
        campaignId = activeCampaign.id;
        console.log(`[Campaign Engine] 战役 #${campaignId} (${ticker}) 已由大V平仓信号正常关闭`);
      } else {
        // 2. 孤儿关闭信号：无活跃战役时，向前追溯 7 天补建已关闭的战役
        const openTime = msg.created_at - 7 * 86400 * 1000;
        const insertStmt = db.prepare(`
          INSERT INTO campaigns (influencer_id, ticker, status, open_time, close_time, open_reason, close_reason, created_at, updated_at)
          VALUES (?, ?, 'closed', ?, ?, ?, ?, ?, ?)
        `);
        const info = insertStmt.run(
          influencerId,
          ticker,
          openTime,
          msg.created_at,
          '追溯补建 - 收到清仓信号',
          msg.content,
          msg.created_at,
          msg.created_at
        );
        campaignId = info.lastInsertRowid;
        console.log(`[Campaign Engine] 收到孤儿关闭信号，追溯补建已关闭的战役 #${campaignId} (${ticker})`);
      }
    } else if (action === 'open') {
      if (!activeCampaign) {
        // 3. 开启新战役
        const insertStmt = db.prepare(`
          INSERT INTO campaigns (influencer_id, ticker, status, open_time, open_reason, created_at, updated_at)
          VALUES (?, ?, 'active', ?, ?, ?, ?)
        `);
        const info = insertStmt.run(
          influencerId,
          ticker,
          msg.created_at,
          msg.content,
          msg.created_at,
          msg.created_at
        );
        campaignId = info.lastInsertRowid;
        console.log(`[Campaign Engine] 发现开仓信号，成功创建新战役 #${campaignId} (${ticker})`);
      } else {
        // 4. 已有活跃战役，开仓信号视为“加仓”调整
        campaignId = activeCampaign.id;
        // 更新战役更新时间
        db.prepare('UPDATE campaigns SET updated_at = ? WHERE id = ?').run(msg.created_at, campaignId);
        console.log(`[Campaign Engine] 活跃战役 #${campaignId} (${ticker}) 发现重复建仓信号，视为追加仓位`);
      }
    } else { // adjust 或者 comment
      if (activeCampaign) {
        // 5. 关联现有战役
        campaignId = activeCampaign.id;
        db.prepare('UPDATE campaigns SET updated_at = ? WHERE id = ?').run(msg.created_at, campaignId);
      } else if (action === 'adjust') {
        // 6. 无活跃战役但发出了调整信号，自动转为开启新战役
        const insertStmt = db.prepare(`
          INSERT INTO campaigns (influencer_id, ticker, status, open_time, open_reason, created_at, updated_at)
          VALUES (?, ?, 'active', ?, ?, ?, ?)
        `);
        const info = insertStmt.run(
          influencerId,
          ticker,
          msg.created_at,
          `自适应开仓 - 调整信号触发: ${msg.content}`,
          msg.created_at,
          msg.created_at
        );
        campaignId = info.lastInsertRowid;
        console.log(`[Campaign Engine] 活跃战役未找到，因加减仓信号自适应开启新战役 #${campaignId} (${ticker})`);
      }
    }
    
    // 如果找到了或创建了战役，建立多对多消息关联
    if (campaignId) {
      db.prepare(`
        INSERT OR IGNORE INTO campaign_messages (campaign_id, message_id, created_at)
        VALUES (?, ?, ?)
      `).run(campaignId, msg.id, msg.created_at);
    }
  }
}

/**
 * 自动清理并关闭超时无发文的交易战役 (7天自动判定为超时清仓/关闭)
 */
export function checkAndCloseStaleCampaigns() {
  const db = getDb();
  const now = Date.now();
  const ONE_WEEK_MS = 7 * 86400 * 1000;
  const staleThreshold = now - ONE_WEEK_MS;

  // 查询最近 7 天内无任何更新的 active 战役
  const staleCampaigns = db.prepare(`
    SELECT * FROM campaigns 
    WHERE status = 'active' AND updated_at < ?
  `).all(staleThreshold);

  if (staleCampaigns.length > 0) {
    console.log(`[Campaign Engine] 发现 ${staleCampaigns.length} 个活跃战役已超过 7 天无消息更新。自动进行超时关闭...`);
    const updateStmt = db.prepare(`
      UPDATE campaigns 
      SET status = 'closed', close_time = ?, close_reason = '系统超时自动关闭', updated_at = ?
      WHERE id = ?
    `);

    for (const c of staleCampaigns) {
      updateStmt.run(c.updated_at + ONE_WEEK_MS, now, c.id);
      console.log(`[Campaign Engine] 战役 #${c.id} (${c.ticker}) 已被系统超时关闭`);
    }
  }
}

/**
 * 基于历史发言为特定大V批量归纳构建历史战役 (画像重构或增量分析时触发)
 */
export async function rebuildHistoricalCampaigns(influencerId) {
  const db = getDb();
  
  console.log(`[Campaign Engine] 开始为大V [${influencerId}] 重新构建历史战役...`);
  
  // 清理该大V已有的战役与关联关系
  db.transaction(() => {
    // 查出该大V的战役ID
    const campaigns = db.prepare('SELECT id FROM campaigns WHERE influencer_id = ?').all(influencerId);
    const ids = campaigns.map(c => c.id);
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`DELETE FROM campaign_messages WHERE campaign_id IN (${placeholders})`).run(...ids);
      db.prepare(`DELETE FROM campaigns WHERE influencer_id = ?`).run(influencerId);
    }
  })();

  // 拉取该大V的所有历史发言 (正序)
  const messages = db.prepare(`
    SELECT * FROM messages 
    WHERE sender_id = ? AND tickers IS NOT NULL AND tickers != ''
    ORDER BY created_at ASC
  `).all(influencerId);

  console.log(`[Campaign Engine] 检索到 ${messages.length} 条含 stock 标的的历史发言。正在重放匹配...`);
  
  for (const msg of messages) {
    await processMessageForCampaigns(msg);
  }

  // 最后检查一次超时未关闭战役
  checkAndCloseStaleCampaigns();
  console.log(`[Campaign Engine] 历史战役重构完成！`);
}
