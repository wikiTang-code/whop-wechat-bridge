import { getDb, initDb } from '../database.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

initDb();
const db = getDb();

console.log('========================================================================================');
console.log('🧪 执行 L2b Part 2: 第二批 20 窗 (l2b_dry_cut_20b.jsonl) 严格干切 (只切不抽，同频±3，is_same_feed)');
console.log('========================================================================================\n');

const registry = JSON.parse(fs.readFileSync('config/channel_registry.json', 'utf-8'));

// 1. 获取文件的真实 SHA256 (取前16位)
function getRealFileSha(filePath) {
  if (!filePath || filePath === 'no_image' || !fs.existsSync(filePath)) return 'no_image';
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

// 递归查找目录下的所有图片
function getAllLocalMediaFiles(dir, ext = '.jpg') {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllLocalMediaFiles(fullPath, ext));
    } else if (file.endsWith(ext)) {
      results.push({ path: fullPath.replace(/\\/g, '/'), size: stat.size });
    }
  });
  return results;
}

const ALL_LOCAL_MEDIA = getAllLocalMediaFiles('data/media/zhao');

// 2. 拼装单条战法窗
function buildWindow(targetMsg, seedMetadata = {}) {
  const channelId = targetMsg.channel_id;
  const createdTs = Number(targetMsg.created_at);

  // 向前同 feed 取 3 条
  const prevMsgs = db.prepare(`
    SELECT id, channel_id, sender_name, created_at, content, attachments
    FROM messages
    WHERE channel_id = ? AND created_at < ?
    ORDER BY created_at DESC LIMIT 3
  `).all(channelId, createdTs).reverse();

  // 向后同 feed 取 3 条
  const nextMsgs = db.prepare(`
    SELECT id, channel_id, sender_name, created_at, content, attachments
    FROM messages
    WHERE channel_id = ? AND created_at > ?
    ORDER BY created_at ASC LIMIT 3
  `).all(channelId, createdTs);

  const allMsgs = [...prevMsgs, targetMsg, ...nextMsgs];

  // 验证是否 100% 同 feed_id
  const isSameFeed = allMsgs.every(m => (m.channel_id || channelId) === channelId);

  // 格式化 raw_text (在每条消息前显式标注其真实频道名称与 feed_id)
  const dialogueMessages = allMsgs.map(m => {
    const dt = new Date(Number(m.created_at)).toLocaleString('zh-CN', { timeZone: 'America/New_York' });
    const cName = registry[m.channel_id]?.name || m.channel_id || registry[channelId]?.name || channelId;
    const fId = m.channel_id || channelId;
    return {
      post_id: m.id,
      feed_id: fId,
      channel_name: cName,
      time_et: dt,
      sender_name: m.sender_name,
      content: m.content,
      is_anchor_post: m.id === targetMsg.id
    };
  });

  const rawTextLines = dialogueMessages.map(m => {
    return `[${m.post_id}] 📡【${m.channel_name} (${m.feed_id})】 ${m.time_et} ${m.sender_name}: ${m.content}`;
  });
  const rawText = rawTextLines.join('\n\n');

  // 检查真图 (收集窗内所有对话对应的已落盘有效真图，并关联其对应 post 发言与上下文)
  const images = [];

  const getPostCaption = (msg) => {
    if (!msg || !msg.content) return '无文字口播（纯图消息）';
    const clean = msg.content.replace(/\[IMAGE:https?:\/\/[^\]]+\]/g, '').trim();
    return clean || '无文字口播（纯图消息）';
  };

  // 遍历窗内全部消息，从本地全量图库匹配属于该消息 post_id 的真图
  for (const m of allMsgs) {
    const matchedFiles = ALL_LOCAL_MEDIA.filter(f => f.path.includes(m.id));
    const dt = new Date(Number(m.created_at)).toLocaleString('zh-CN', { timeZone: 'America/New_York' });
    const cName = registry[m.channel_id]?.name || registry[channelId]?.name || channelId;
    const caption = getPostCaption(m);
    for (const mf of matchedFiles) {
      if (!images.some(img => img.local_path === mf.path)) {
        const sha = getRealFileSha(mf.path);
        images.push({
          post_id: m.id,
          feed_id: m.channel_id || channelId,
          channel_name: cName,
          sender_name: m.sender_name,
          time_et: dt,
          post_caption: caption,
          local_path: mf.path,
          image_sha: sha,
          size_bytes: mf.size
        });
      }
    }
  }

  const hasRealImage = images.length > 0;
  const primaryImg = images[0] || { local_path: 'no_image', image_sha: 'no_image' };

  // 严格提取 evidence_span (必须是 raw_text 里的连续子串)
  let evidenceSpan = seedMetadata.evidence_span;
  if (!evidenceSpan || !rawText.includes(evidenceSpan)) {
    throw new Error(`❌ 严重契约违背: evidence_span 不是 raw_text 连续子串: [${targetMsg.id}]\nSpan: "${evidenceSpan}"`);
  }

  // 软标记判断: 后文消息距离锚点时间跨度是否超过 24 小时
  let contextStale = false;
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  for (const nm of nextMsgs) {
    const deltaMs = Number(nm.created_at) - createdTs;
    if (deltaMs > ONE_DAY_MS) {
      contextStale = true;
      break;
    }
  }

  return {
    post_id: targetMsg.id,
    feed_id: channelId,
    channel_name: registry[channelId]?.name || channelId,
    et_date: new Date(createdTs).toISOString().slice(0, 10),
    is_same_feed: isSameFeed,
    context_stale: contextStale,
    has_real_image: hasRealImage,
    image_count: images.length,
    images: images,
    local_image_path: primaryImg.local_path,
    image_sha: primaryImg.image_sha,
    kid: seedMetadata.kid || 'pending_new',
    statement: seedMetadata.statement || targetMsg.content.slice(0, 80).replace(/\n/g, ' '),
    evidence_span: evidenceSpan,
    not: seedMetadata.not || [],
    status: seedMetadata.status || 'proposed',
    do_not_use_as_order: true,
    raw_text: rawText,
    dialogue_messages: dialogueMessages,
    dialogue_message_count: allMsgs.length
  };
}

// 3. 第二批 20 窗种子表 (补满公式区 + 讨论区/记录区高价值口诀答疑)
const STRICT_20B_SEEDS = [
  // --- [1] 公式区 04: NBIS 反弹一半 ---
  {
    seed_id: 'formula_003_nbis',
    post_id: 'post_1CWLwrA3b6TrT7GJopo379',
    kid: 'k_half_retrace_watch',
    label: 'NBIS (134+78.21)/2 反弹一半',
    evidence_span: '（134+78.21）/2=106.1上轮最高在   103.84差一点没有达到一半的价格\n\n这轮\n\n最高12月4日 103.84\n\n最低12月17  75.25\n\n(103.84+75.25)/2=89.54 一半这个保守位置',
    statement: '（134+78.21）/2=106.1，这轮（103.84+75.25）/2=89.54，一半这个保守位置。',
    not: []
  },
  // --- [2] 公式区 05: OKLO 突破前高挑战 ---
  {
    seed_id: 'formula_004_oklo_break',
    post_id: 'post_1CWwwWfs2tNWqUSXGWFCCB',
    kid: 'k_half_retrace_watch',
    label: 'OKLO 突破前高再挑战',
    evidence_span: '目前完成了114.29这个突破就后面震荡后再有机会去挑战134这个高点',
    statement: '目前完成了114.29这个突破就后面震荡后再有机会去挑战134这个高点。',
    not: []
  },
  // --- [3] 公式区 06: HOOD (109+70)/2 反弹一半 ---
  {
    seed_id: 'formula_005_hood',
    post_id: 'post_1CYiBfdotsxGAhV6Kk1zvK',
    kid: 'k_half_retrace_watch',
    label: 'HOOD (109+70)/2 反弹一半',
    evidence_span: 'hood一半位置在（109+70）/2=89  89附近',
    statement: 'hood一半位置在（109+70）/2=89，89附近。',
    not: []
  },
  // --- [4] 公式区 07: TSLL 减派息一半位置出一半 ---
  {
    seed_id: 'formula_006_tsll',
    post_id: 'post_1CYiBio1Ki9rFfzqMidBh9',
    kid: 'k_half_retrace_watch',
    label: 'TSLL 减派息一半位置出一半',
    evidence_span: '（13.55+23.6）/2=18.55  -1元派息  17.55一半位置再出一半 tsll一半在17.55附近',
    statement: '（13.55+23.6）/2=18.55，-1元派息，17.55一半位置再出一半。',
    not: []
  },
  // --- [5] 公式区 08: AMZN 亚马逊反弹一半出一半 ---
  {
    seed_id: 'formula_007_amzn',
    post_id: 'post_1CYiFXPvHbtarByzwWzVFF',
    kid: 'k_half_retrace_watch',
    label: 'AMZN 亚马逊反弹一半出一半',
    evidence_span: '亚马逊 （244+196）除2等于220你  到一半位置附近时候在减一半',
    statement: '亚马逊（244+196）除2等于220，到一半位置附近时候再减一半。',
    not: []
  },
  // --- [6] 记录区: 周五先多后空轮次 ---
  {
    seed_id: 'playbook_friday_long_then_short',
    post_id: 'post_1CZEMrtkRdEXBxYiVSBWZB',
    kid: 'pending_new',
    label: '周五先多后空轮次',
    evidence_span: '今天也是主要是先多后空的轮次\n\n尾盘可能会看下加密的跌的情况看有没有机会',
    statement: '今天主要是先多后空的轮次，尾盘看下加密跌的情况看有没有机会。',
    not: []
  },
  // --- [7] 记录区: 极限点低吸与波动值轮动 ---
  {
    seed_id: 'playbook_extreme_dip_wave',
    post_id: 'post_1CeVM9uP2Fo3WyWmQxnLvr',
    kid: 'pending_new',
    label: '极限点低吸与波动值轮动',
    evidence_span: '7640的极限点一直是每天反复说极限点位去低吸低吸低吸 因为指数的话7700  7760 7820按60的波动值会往上波动一轮\n指数低位的 按轮动都能分批次获利',
    statement: '极限点位去低吸，指数按60的波动值会往上波动一轮，指数低位的按轮动分批次获利。',
    not: []
  },
  // --- [8] 讨论区: 维持异动涨幅止盈与急跌收集低位筹码 ---
  {
    seed_id: 'playbook_gain_take_and_dip_collect',
    post_id: 'post_1CePoYLbFYk8eQPPTAW6QZ',
    kid: 'pending_new',
    label: '异动涨幅止盈与急跌收集筹码',
    evidence_span: '每天要维持有异动涨幅可以止盈 急跌了都收集低位筹码吸',
    statement: '每天要维持有异动涨幅可以止盈，急跌了都收集低位筹码吸。',
    not: []
  },
  // --- [9] 记录区: 财报资讯看增长分批出与盘后杀空回买 ---
  {
    seed_id: 'playbook_earnings_growth_tranch',
    post_id: 'post_1CUmieqA3rqzHWzhDCDkrD',
    kid: 'pending_new',
    label: '财报小幅增长分批出与盘后杀空回买',
    evidence_span: '比如hims就小幅增长的就盘后小涨幅分批出一波 然后在看看电话会议前有没有盘后杀空杀低点附近的在回买 卖出后一般设置比较低的价格万一杀多吃到了也可以在有点收益\n\n没吃到等几天下来也可以\n\nrddt就是财报后又快到193附近了\n\n反正到支撑位股票很多不用总盯着一个\n\n哪个性价比和形态到了吸哪个',
    statement: '小幅增长就盘后小涨幅分批出一波，看电话会议前有没有盘后杀空杀低点附近再回买。',
    not: []
  },
  // --- [10] 记录区: 减持回流仓位布局与急涨急跌高低切 ---
  {
    seed_id: 'playbook_unlock_flow_cut',
    post_id: 'post_1CeEB4X4yrtEZKnUbGXKTt',
    kid: 'pending_new',
    label: '减持回流高低切',
    evidence_span: '今天和明天是减持回流量相对大的两天 会急跌急涨锯齿多\n也是仓位布局到7-8成左右  有些急涨的就一半出 在调入急跌的 高低切自己切切',
    statement: '减持回流量相对大的两天会急跌急涨锯齿多，有些急涨的就一半出，再调入急跌的高低切。',
    not: []
  },
  // --- [11] 记录区: 强势股看QQQ转弯低吸 ---
  {
    seed_id: 'playbook_strong_stock_qqq_turn',
    post_id: 'post_1CeDwfoHoe5Zs5fsKV9ddL',
    kid: 'pending_new',
    label: '强势股看QQQ转弯低吸',
    evidence_span: '回流都有t+2的时差效应 \n\n强势股主要看qqq的转弯去低吸',
    statement: '回流都有t+2的时差效应，强势股主要看qqq的转弯去低吸。',
    not: []
  },
  // --- [12] 讨论区: 普跌急跌买占仓位与普涨顶点抛 ---
  {
    seed_id: 'playbook_general_drop_buy_peak_sell',
    post_id: 'post_1CeCAEHUWqBakCEAPXJk8N',
    kid: 'pending_new',
    label: '普跌急跌买占仓位与普涨顶点抛',
    evidence_span: '就是都普跌时候 他也急跌 买了占仓位  指数都普涨 看顶点了抛',
    statement: '都普跌时候他也急跌买了占仓位，指数都普涨看顶点了抛。',
    not: []
  },
  // --- [13] 讨论区: 阶梯低吸点位与增补纪律 ---
  {
    seed_id: 'playbook_step_dip_buy',
    post_id: 'post_1CeC98SVWJG41jsLpx7u8u',
    kid: 'pending_new',
    label: '阶梯低吸点位与增补纪律',
    evidence_span: '7700就是第一个低吸点 就是今天万一有7650-7640是在增补',
    statement: '7700就是第一个低吸点，万一有7650-7640是在增补。',
    not: []
  },
  // --- [14] 记录区: 均摊仓位不压单票 ---
  {
    seed_id: 'playbook_position_equal_spread',
    post_id: 'post_1CdwDx4hMUH1Egb2YsDZuB',
    kid: 'pending_new',
    label: '均摊仓位不压单票',
    evidence_span: '现有仓位可以了 在下面就是3.9-3.8加一笔这次都均摊不压一个上面',
    statement: '现有仓位可以了，再下面加一笔这次都均摊不压一个上面。',
    not: []
  },
  // --- [15] 记录区: 横盘磨损与急跌吸个股 ---
  {
    seed_id: 'playbook_decay_drop_stock_buy',
    post_id: 'post_1Cdw4bCTXkcvTgk1ScduTM',
    kid: 'pending_new',
    label: '横盘磨损与急跌吸个股',
    evidence_span: '昨天尾盘强平的很多说明昨天都在吃横盘磨损 只根据价格有急跌时候吸个股等spx成交放大在期权',
    statement: '都在吃横盘磨损，只根据价格有急跌时候吸个股，等spx成交放大再期权。',
    not: []
  },
  // --- [16] 记录区: 开盘多轮次与尾盘空轮次低吸 ---
  {
    seed_id: 'playbook_morning_long_afternoon_dip',
    post_id: 'post_1CdoV7EK8jmBHuuWUZjRgy',
    kid: 'pending_new',
    label: '开盘多轮次与尾盘空轮次低吸',
    evidence_span: '今天数据出来先拉了一波 开盘是多的轮次 等尾盘空的轮次在低吸的时候在吸点最低点出来的和急跌的',
    statement: '开盘是多的轮次，等尾盘空的轮次低吸的时候再吸点最低点出来的和急跌的。',
    not: []
  },
  // --- [17] 记录区: 估值缺口与拉开价差加批次 ---
  {
    seed_id: 'playbook_valuation_gap_spread',
    post_id: 'post_1CdmTzmUAG6L5s6brLgnac',
    kid: 'pending_new',
    label: '估值缺口与拉开价差加批次',
    evidence_span: '存储仓位等拉开价差会再加一批  qqq今天注意注意700整数位关口附近的支撑回踩探底看能不能支撑住',
    statement: '存储仓位等拉开价差会再加一批，qqq注意700整数位关口附近的支撑回踩探底。',
    not: []
  },
  // --- [18] 记录区: 急跌买一份与异动涨幅分批出一半 ---
  {
    seed_id: 'playbook_dip_buy_one_gain_sell_half',
    post_id: 'post_1Cdhz9mecyHJEKvKPaqa4o',
    kid: 'pending_new',
    label: '急跌买一份与异动出半',
    evidence_span: '急跌了就是根据自己仓位买一份 比如conl上去了异动多出一半比如6%出了一半再涨6%出一半  如果再跌3.95附近在吸一个批次  横盘了就不操作',
    statement: '急跌了根据自己仓位买一份，异动多出一半（如6%出一半再涨6%出一半），横盘不操作。',
    not: []
  },
  // --- [19] 讨论区: 中选特征急跌马上转弯 ---
  {
    seed_id: 'playbook_midterm_dip_turn',
    post_id: 'post_1CdhevDYpKLmPx7tWfUk2k',
    kid: 'pending_new',
    label: '政策博弈急跌马上转弯',
    evidence_span: '像最近 频繁出利好美国的政策 打压其他国家 急跌马上转弯都是中选的特点',
    statement: '像最近频繁出利好政策，急跌马上转弯都是中选的特点。',
    not: []
  },
  // --- [20] 记录区: 周五杠杆强平与拉开价差分批低吸 ---
  {
    seed_id: 'playbook_margin_unwind_spread_dip',
    post_id: 'post_1Cdft7zNeDDcKbwk4jStAG',
    kid: 'pending_new',
    label: '杠杆去化期拉开价差分批低吸',
    evidence_span: '周五韩国政府账户接收了散户t+3强平的仓位在今天开始慢慢去这批接受的杠杆\n\n\n\nA股港股继续开始了减持回流 加上周四有闪迪等存储的财报 这周还是每天拉开价差 分批次低吸',
    statement: '杠杆去化与减持回流期间，每天拉开价差分批次低吸。',
    not: []
  }
];

const final20b = [];
for (let i = 0; i < STRICT_20B_SEEDS.length; i++) {
  const item = STRICT_20B_SEEDS[i];
  const row = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(item.post_id);
  if (!row) {
    throw new Error(`❌ 致命错误: 未在数据库中找到指定 post_id: ${item.post_id} (${item.label})`);
  }
  const win = buildWindow(row, item);
  win.cu_id = `cu_l2b_drycut_20260831_${String(i + 1).padStart(5, '0')}`;
  win.seed_id = item.seed_id;
  win.seed_label = item.label;
  final20b.push(win);
}

// 4. 落盘独立文件 data/samples/l2b_dry_cut_20b.jsonl
const outPath = path.resolve('data/samples/l2b_dry_cut_20b.jsonl');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
const content = final20b.map(w => JSON.stringify(w)).join('\n') + '\n';
fs.writeFileSync(outPath, content, 'utf-8');

console.log(`✅ 成功落盘第二批 20 窗独立文件: ${outPath} (共 ${final20b.length} 窗)`);
console.log('========================================================================================');
console.log('📋 L2b Part 2 第二批 20 窗干切清单与全要素核验表');
console.log('========================================================================================');
console.log('序号 | CU ID | 真实 post_id | 频道名称 (feed_id) | 同Feed | 配图状态 | 规范 kid | 锚点口诀 / 原文摘要');
console.log('-----|-------|--------------|--------------------|--------|----------|----------|----------------------------------------------------');
final20b.forEach((w, i) => {
  const num = String(i + 1).padStart(2, '0');
  const imgStr = w.has_real_image ? `🖼️ 有图 (${w.images.length}张)` : 'no_image';
  const sameFeedStr = w.is_same_feed ? '✅同' : '❌异';
  const preview = w.statement.replace(/\n+/g, ' ').slice(0, 50);
  console.log(`${num} | ${w.cu_id} | ${w.post_id} | ${w.channel_name.slice(0, 10)} | ${sameFeedStr} | ${imgStr.padEnd(8)} | ${w.kid.padEnd(20)} | ⭐[${w.seed_id}] ${preview}`);
});
console.log('========================================================================================\n');
