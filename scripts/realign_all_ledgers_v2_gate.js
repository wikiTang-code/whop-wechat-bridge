import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('whop_archive.db');
const db = new Database(dbPath);

console.log('========================================================================================');
console.log('🏛️ 执行 1~9 档 (1~8000 条消息) 全量标准清洗与硬核去虚增重刷流水线');
console.log('========================================================================================\n');

const goldLessons = JSON.parse(fs.readFileSync('data/l2b/gold/l2b_gold_lessons.json', 'utf-8'));

const BOOKMARK_REGEX = /(法\b|机制|要素|口诀|打油诗|普跌同沉|普涨我跌|事件来临|节日前夕|币市波动|一般要|一般有|相当于|二次握手|握手|缺口|只做一次|只做一次日内|被动减|减持|总仓位不要超过|7成|3成|反弹一半|\/2=|大单检测|大单入场|散户止损|死拿|成本出|磨损值|两段式|靴子|结算|利润垫|转弯|指数门|QQQ等转弯|到处找新闻|看到点位看转弯|3–3:30|3点强平|底部要素|底部几大要素|整数|小数点|电话会议|电话会|企稳反弹|企稳|主动规避|躲月末)/;

// 定义各档分块
const segments = [
  { name: '第 1~2 档 (1~2000 条)', offset: 0, limit: 2000, file: 'zhao_chronological_ledger_1_2000.json' },
  { name: '第 3 档 (2001~3000 条)', offset: 2000, limit: 1000, file: 'zhao_chronological_ledger_2001_3000.json' },
  { name: '第 4 档 (3001~4000 条)', offset: 3000, limit: 1000, file: 'zhao_chronological_ledger_3001_4000.json' },
  { name: '第 5 档 (4001~5000 条)', offset: 4000, limit: 1000, file: 'zhao_chronological_ledger_4001_5000.json' },
  { name: '第 6 档 (5001~6000 条)', offset: 5000, limit: 1000, file: 'zhao_chronological_ledger_5001_6000.json' },
  { name: '第 7 档 (6001~7000 条)', offset: 6000, limit: 1000, file: 'zhao_chronological_ledger_6001_7000.json' },
  { name: '第 8 档 (7001~8000 条)', offset: 7000, limit: 1000, file: 'zhao_chronological_ledger_7001_8000.json' }
];

for (const seg of segments) {
  console.log(`\n⏳ 正在清洗并生成: ${seg.name} -> ${seg.file}...`);

  const zhaoMessages = db.prepare(`
    SELECT id, channel_name, channel_id, sender_name, content, created_at
    FROM messages
    WHERE (sender_name LIKE '%赵%' OR sender_name LIKE '%zhao%' OR sender_name = 'xiaozhaolucky' OR channel_name = '不用翻墙美股发布')
      AND content IS NOT NULL
    ORDER BY created_at ASC
    LIMIT ${seg.limit} OFFSET ${seg.offset}
  `).all();

  const treeInstancesMap = new Map();
  goldLessons.forEach(g => treeInstancesMap.set(g.gold_id, []));

  const gapSubdivision = {
    gold_003_rule_replays: [],
    prop_008_retrace_replays: [],
    boundary_negative_cases: [],
    point_memos: []
  };

  const skippedAuditLog = [];
  const seenContentSet = new Set();
  const seenNodeDateMap = new Map(); // 确保同一档内同 tree_id 同日只计 1 次

  let bookmarkedCount = 0;

  for (let i = 0; i < zhaoMessages.length; i++) {
    const globalIdx = seg.offset + i + 1;
    const msg = zhaoMessages[i];
    let text = msg.content || '';
    text = text.replace(/\[IMAGE:https?:\/\/[^\]]+\]/g, '').trim();
    if (text.length < 6) continue;

    const match = text.match(BOOKMARK_REGEX);
    if (!match) continue;

    bookmarkedCount++;
    const triggerWord = match[0];
    const etDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(msg.created_at));

    // 跨频道去重
    const contentKey = text.replace(/\s+/g, '');
    const isDuplicate = seenContentSet.has(contentKey);
    seenContentSet.add(contentKey);

    if (isDuplicate) {
      skippedAuditLog.push({
        index: globalIdx,
        message_id: msg.id,
        et_date: etDate,
        channel: msg.channel_name,
        trigger: triggerWord,
        category: 'duplicate_post',
        reason: '跨频道完全重复发布，不重复记账',
        raw_text: text.slice(0, 150)
      });
      continue;
    }

    // 通用挂接辅助函数（硬核同日只记 1 次）
    const tryAddInstance = (nodeId, treeName, spanText, fullText, subtype) => {
      if (!seenNodeDateMap.has(nodeId)) seenNodeDateMap.set(nodeId, new Set());
      const dateSet = seenNodeDateMap.get(nodeId);

      // 提取严格存在于 text 中的真实子串
      let validSpan = spanText;
      if (!text.includes(validSpan)) {
        validSpan = text.slice(0, 120);
      }

      if (!dateSet.has(etDate)) {
        dateSet.add(etDate);
        treeInstancesMap.get(nodeId).push({
          index: globalIdx,
          tree_id: nodeId,
          tree_name: treeName,
          subtype: subtype || 'rule_replay',
          message_id: msg.id,
          et_date: etDate,
          channel: msg.channel_name,
          evidence_span: validSpan,
          raw_text: fullText
        });
        return true;
      } else {
        skippedAuditLog.push({
          index: globalIdx,
          message_id: msg.id,
          et_date: etDate,
          channel: msg.channel_name,
          trigger: triggerWord,
          category: 'same_day_suffix',
          reason: `同日 (${etDate}) 节点 [${nodeId}] 规则已计账 1 次，同日多发作为当日 fill 宿主审计，不虚增规则计数`,
          raw_text: text.slice(0, 150)
        });
        return false;
      }
    };

    // 1. 图注阻断
    if (text.includes('二次握手') && (text.includes('图') || text.includes('比较精确') || text.includes('如图'))) {
      skippedAuditLog.push({
        index: globalIdx,
        message_id: msg.id,
        et_date: etDate,
        channel: msg.channel_name,
        trigger: triggerWord,
        category: 'image_caption_memo',
        reason: '二次握手配图说明（非不破低点低吸操作规则复述），降为图注备忘',
        raw_text: text.slice(0, 150)
      });
      continue;
    }

    // 2. gold_011: 打油诗全文本尊 (2026-01-04 post_1CWoRBJvkuBQgdN2Cq7Mci)
    if (text.includes('普跌同沉不用慌') || (text.includes('口诀') && text.includes('白话文') && text.includes('普涨我跌'))) {
      tryAddInstance('gold_011_zhao_poem_official', '赵哥主观交易总诀 (打油诗全文本尊)', text.slice(0, 150), text.slice(0, 350));
      continue;
    }

    // 3. prop_017: 盘口转弯优先于新闻小作文 (post_1CaM8rTWT7FyzvdGbUMxzS)
    if (text.includes('到处找新闻') || text.includes('看到点位看转弯') || text.includes('不要到处找新闻')) {
      tryAddInstance('prop_017_price_level_turn_over_news', '盘口转弯优先于新闻小作文纪律', text.slice(0, 150), text.slice(0, 250));
      continue;
    }

    // 4. prop_015: 跨时段操作 (3~3:30 V买、盘后 4~4:15 卖 / 0DTE)
    if ((text.includes('0DTE') && text.includes('尾盘')) || (text.includes('3–3:30') && text.includes('卖')) || (text.includes('收盘附近吸') && text.includes('夜盘/盘前短出'))) {
      tryAddInstance('prop_015_intraday_session_rhythm_0dte', '跨交易时段节奏与0DTE尾盘配合', text.slice(0, 150), text.slice(0, 250));
      continue;
    }

    // 5. gold_008: 入场扫描：指数转弯再看个股 (post_1CaFCe6NUnN9AtgCH4nh93)
    if (text.includes('QQQ等转弯往上再看科技股') || (text.includes('QQQ') && text.includes('转弯往上') && text.includes('回吸'))) {
      tryAddInstance('gold_008_index_turn_gate', '入场扫描：指数转弯再看个股', text.slice(0, 150), text.slice(0, 250));
      continue;
    }

    // 6. gold_003: 缺口每次只做一次日内 (post_1CbASmAPtdCknnaHcfBcAo)
    if (text.includes('每次到缺口只做一次日内') || (text.includes('缺口') && text.includes('只做一次日内'))) {
      const added = tryAddInstance('gold_003_gap_intraday_once', '缺口每次只做一次日内', text.slice(0, 150), text.slice(0, 250));
      if (added) {
        gapSubdivision.gold_003_rule_replays.push({
          index: globalIdx,
          tree_id: 'gold_003_gap_intraday_once',
          message_id: msg.id,
          et_date: etDate,
          channel: msg.channel_name,
          evidence_span: text.slice(0, 150),
          raw_text: text.slice(0, 250)
        });
      }
      continue;
    }

    // 7. prop_001: 底部几大要素 (急跌最低价是整数没小数点) (post_1CbE4JTR7XvBrPPFqZzJZ5)
    if (text.includes('底部几大要素') || (text.includes('最低价是整数') && text.includes('小数点'))) {
      tryAddInstance('prop_001_dip_buy_integer', '急跌整数无小数点底部要素', text.slice(0, 150), text.slice(0, 250));
      continue;
    }

    // 8. prop_011: NVDA 电话会投资板块带动多空 (post_1CbFr1hvfSzMc63eiEe5QS)
    if (text.includes('电话会议') || (text.includes('电话会') && text.includes('英伟达'))) {
      tryAddInstance('prop_011_earnings_call_reversal', '大盘财报电话会前后多空反转', text.slice(0, 150), text.slice(0, 250));
      continue;
    }

    // 9. prop_012: 企稳反弹底部判断 (post_1CbAVWUdjvCJmcDctmxaEo)
    if (text.includes('企稳反弹了就是跌底部了') || (text.includes('每月不降低了') && text.includes('企稳反弹'))) {
      tryAddInstance('prop_012_position_leverage_ratio', '稳反弹仓位分工与做T杠杆比率', text.slice(0, 150), text.slice(0, 250));
      continue;
    }

    // 10. gold_005: 反弹一半公式
    if (text.includes('反弹一半') || (text.includes('/2=') && text.includes('+'))) {
      tryAddInstance('gold_005_half_retrace_watch', '反弹一半公式空间测算', text.slice(0, 150), text.slice(0, 250));
      continue;
    }

    // 11. gold_006: 节前被动减 (含时钟/10%被动减/1.5倍回流/月末叠加细则)
    if (text.includes('被动减') || text.includes('节前前5天') || text.includes('节日前夕') || text.includes('春节赎回') || (text.includes('节前') && (text.includes('留现金') || text.includes('双底') || text.includes('买多'))) || text.includes('主动规避回调') || (text.includes('节后') && text.includes('月末减持'))) {
      tryAddInstance('gold_006_passive_redeem_holiday', '节前基金被动减持与赎回', text.slice(0, 150), text.slice(0, 250), 'passive_redeem_holiday_and_clock');
      continue;
    }

    // 12. gold_007: 靴子落地与周五多空结算走普涨
    if (text.includes('靴子落地') || (text.includes('日本加息') && text.includes('结算') && text.includes('普涨')) || (text.includes('周五') && text.includes('结算普涨'))) {
      if (text.includes('tsll') || text.includes('特斯拉') || text.includes('销量')) {
        skippedAuditLog.push({
          index: globalIdx,
          message_id: msg.id,
          et_date: etDate,
          channel: msg.channel_name,
          trigger: triggerWord,
          category: 'single_ticker_event_memo',
          reason: 'TSLL单票利空销量靴子落地，作为个股事件备忘，不进宏观通用规则',
          raw_text: text.slice(0, 150)
        });
      } else {
        tryAddInstance('gold_007_shoe_drops_settlement', '重大事件靴子落地走普涨', text.slice(0, 150), text.slice(0, 250));
      }
      continue;
    }

    // 13. gold_004: 7/3 仓位风控
    if (text.includes('7成') && (text.includes('3成') || text.includes('死拿') || text.includes('做T') || text.includes('总仓位不要超过'))) {
      tryAddInstance('gold_004_position_control_70_pct', '7成底仓与3成做T机动', text.slice(0, 150), text.slice(0, 250));
      continue;
    }

    // 14. gold_001: 二次握手
    if (text.includes('二次握手') || text.includes('两次握手') || (text.includes('握手') && (text.includes('低点') || text.includes('探底')))) {
      tryAddInstance('gold_001_second_handshake', '二次握手不破低点低吸', text.slice(0, 150), text.slice(0, 250));
      continue;
    }

    // 15. gold_009: 成本出最后补仓
    if (text.includes('成本出') && text.includes('最后补的那笔')) {
      tryAddInstance('gold_009_cost_exit_last_batch', '分批只减最后补的一笔成本出', text.slice(0, 150), text.slice(0, 250));
      continue;
    }

    // 16. gold_013: 减持 3+1 天
    if (text.includes('减持') && (text.includes('3天后第4天') || text.includes('3天'))) {
      tryAddInstance('gold_013_supply_unlock_3_plus_1', '减持3天后第4天看', text.slice(0, 150), text.slice(0, 250));
      continue;
    }

    // 17. prop_002: 腰斩 50% 迎翻倍
    if (text.includes('100跌50') || (text.includes('腰斩') && text.includes('50%'))) {
      tryAddInstance('prop_002_cut_in_half_100_percent', '事件腰斩50%迎翻倍100%机会', text.slice(0, 150), text.slice(0, 250));
      continue;
    }

    // 18. prop_007: 夜盘普跌盘前干预
    if (text.includes('夜盘') && text.includes('买入法') && (text.includes('干预') || text.includes('普跌'))) {
      tryAddInstance('prop_007_night_plunge_premarket_intervention', '夜盘普跌盘前干预买入法', text.slice(0, 150), text.slice(0, 250));
      continue;
    }

    // 19. prop_009: 磨损值折算
    if (text.includes('磨损值') || (text.includes('相当于') && text.includes('第一轮'))) {
      tryAddInstance('prop_009_decay_equivalent_calc', '期权/杠杆磨损值折算上一轮价格', text.slice(0, 150), text.slice(0, 250));
      continue;
    }

    // 20. prop_010: 减持约 9 天
    if (text.includes('减持') && (text.includes('9天左右') || text.includes('天左右') || text.includes('接近支撑可以回吸'))) {
      tryAddInstance('prop_010_supply_unlock_ndays_dip', '减持过一段天数靠近支撑回吸', text.slice(0, 150), text.slice(0, 250));
      continue;
    }

    // 21. prop_013: 低吸三种模式 (支撑/元旦前缺口/双底)
    if (text.includes('低吸') && text.includes('支撑') && text.includes('缺口') && text.includes('双底')) {
      tryAddInstance('prop_013_three_dip_types_selection', '低吸三大模式：支撑位/节前缺口/双底形态', text.slice(0, 150), text.slice(0, 250));
      continue;
    }

    // 22. prop_014: MSCI 剔除被动清仓
    if (text.includes('MSCI') || (text.includes('被动清仓') && text.includes('非成分股'))) {
      tryAddInstance('prop_014_msci_exclusion_sector_sympathy_dip', 'MSCI剔除被动清仓与同板块非成分股错杀低吸', text.slice(0, 150), text.slice(0, 250));
      continue;
    }

    // 23. prop_016: 指数大缺口回补买点
    if (text.includes('指数大缺口') || (text.includes('大缺口回补') && text.includes('大仓位'))) {
      tryAddInstance('prop_016_index_macro_gap_heavy_dip', '指数大缺口隔月回补与个股低位大仓位吸筹法', text.slice(0, 150), text.slice(0, 250));
      continue;
    }

    // 24. 缺口精细分流 (反例 vs 回踩补缺 vs 点位备忘)
    if (text.includes('缺口')) {
      if (text.includes('没有回踩缺口一说') || text.includes('指数没有回踩缺口') || text.includes('不会回补') || text.includes('最多摸上沿')) {
        gapSubdivision.boundary_negative_cases.push({
          index: globalIdx,
          type: 'negative_boundary_case',
          message_id: msg.id,
          et_date: etDate,
          channel: msg.channel_name,
          memo_span: text.slice(0, 150),
          raw_text: text.slice(0, 250)
        });
      } else if (text.includes('普涨隔天回踩') || text.includes('每天小幅回补') || text.includes('分三次回买') || text.includes('回踩') || text.includes('低吸') || text.includes('补完') || text.includes('跳涨先回踩') || text.includes('回吸')) {
        const added = tryAddInstance('prop_008_gap_retrace_fill_dip', '高开回踩补缺低吸法', text.slice(0, 150), text.slice(0, 250));
        if (added) {
          gapSubdivision.prop_008_retrace_replays.push({
            index: globalIdx,
            tree_id: 'prop_008_gap_retrace_fill_dip',
            message_id: msg.id,
            et_date: etDate,
            channel: msg.channel_name,
            evidence_span: text.slice(0, 150),
            raw_text: text.slice(0, 250)
          });
        }
      } else {
        gapSubdivision.point_memos.push({
          index: globalIdx,
          type: 'point_memo_watch',
          message_id: msg.id,
          et_date: etDate,
          channel: msg.channel_name,
          memo_span: text.slice(0, 150),
          raw_text: text.slice(0, 250)
        });
        skippedAuditLog.push({
          index: globalIdx,
          message_id: msg.id,
          et_date: etDate,
          channel: msg.channel_name,
          trigger: triggerWord,
          category: 'weak_commentary_or_single_event',
          reason: '单日缺口讨论或点位备忘，未达到独立规则标准',
          raw_text: text.slice(0, 150)
        });
      }
      continue;
    }

    // 25. 纯点位成交
    const isPureFill = /(\b\d+(\.\d+)?\s*(出|买|接|减|加|挂|止损|清仓|建仓|减持|减仓)|(出|买|接|减|加|减持)\s*(\d+(\.\d+)?|点|一半))/i.test(text) && text.length < 40;
    if (isPureFill) {
      skippedAuditLog.push({
        index: globalIdx,
        message_id: msg.id,
        et_date: etDate,
        channel: msg.channel_name,
        trigger: triggerWord,
        category: 'pure_fill_order',
        reason: '点位成交/减持口播，不进策略树',
        raw_text: text.slice(0, 150)
      });
      continue;
    }

    // 26. 其余弱点评
    skippedAuditLog.push({
      index: globalIdx,
      message_id: msg.id,
      et_date: etDate,
      channel: msg.channel_name,
      trigger: triggerWord,
      category: 'weak_commentary_or_single_event',
      reason: '单日讨论区问答或弱语义描述，未达到树节点标准',
      raw_text: text.slice(0, 150)
    });
  }

  // 统计
  const instanceSummary = {};
  for (const [tId, insts] of treeInstancesMap.entries()) {
    if (insts.length > 0) {
      const lessonObj = goldLessons.find(g => g.gold_id === tId);
      instanceSummary[tId] = {
        name: lessonObj?.name || tId,
        status: lessonObj?.status || 'proposed',
        instances_count: insts.length,
        sample_spans: insts.slice(0, 3).map(s => s.evidence_span)
      };
    }
  }

  const skipStats = {};
  skippedAuditLog.forEach(s => skipStats[s.category] = (skipStats[s.category] || 0) + 1);

  const resultData = {
    metadata: {
      segment: seg.name,
      date_range: `${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(zhaoMessages[0].created_at))} ~ ${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(zhaoMessages[zhaoMessages.length - 1].created_at))}`,
      total_scanned: zhaoMessages.length,
      bookmarked_stops: bookmarkedCount,
      tree_nodes_populated_count: Object.keys(instanceSummary).length,
      skipped_stops_total: skippedAuditLog.length,
      skipped_breakdown: skipStats
    },
    tree_instances_summary: instanceSummary,
    gap_subdivision_summary: {
      gold_003_intraday_once_count: treeInstancesMap.get('gold_003_gap_intraday_once')?.length || 0,
      prop_008_retrace_fill_count: treeInstancesMap.get('prop_008_gap_retrace_fill_dip')?.length || 0,
      boundary_negative_cases_count: gapSubdivision.boundary_negative_cases.length,
      point_memos_count: gapSubdivision.point_memos.length
    },
    tree_instances_detail: Object.fromEntries(treeInstancesMap),
    gap_subdivision: gapSubdivision,
    skipped_audit_log: skippedAuditLog
  };

  const outPath = path.join('data/l2b/gold', seg.file);
  fs.writeFileSync(outPath, JSON.stringify(resultData, null, 2), 'utf-8');
  console.log(`✅ 成功输出: ${outPath} (命中了 ${Object.keys(instanceSummary).length} 个树节点, 真实 Skip 审计 ${skippedAuditLog.length} 条)`);
}

console.log('\n🎉 1~9 档全量账本标准重刷完成！');
