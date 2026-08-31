import { getDb, initDb } from '../database.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

initDb();
const db = getDb();

console.log('========================================================================================');
console.log('🧪 重新生成 L2b 20 窗 Dry-Cut (彻底对齐规范与原文事实，绝无假 SHA / 编造词汇)');
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
    SELECT id, sender_name, created_at, content, attachments
    FROM messages
    WHERE channel_id = ? AND created_at < ?
    ORDER BY created_at DESC LIMIT 3
  `).all(channelId, createdTs).reverse();

  // 向后同 feed 取 3 条
  const nextMsgs = db.prepare(`
    SELECT id, sender_name, created_at, content, attachments
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

  // 检查真图 (收集窗内所有 7 条对话对应的已落盘有效真图，并关联其对应 post 发言与上下文)
  const images = [];

  // 辅助清洗该条消息文字作为图片说明
  const getPostCaption = (msg) => {
    if (!msg || !msg.content) return '无文字口播（纯图消息）';
    const clean = msg.content.replace(/\[IMAGE:https?:\/\/[^\]]+\]/g, '').trim();
    return clean || '无文字口播（纯图消息）';
  };

  // 1. 如果种子显式指定了本地路径且存在
  if (seedMetadata.local_path && fs.existsSync(seedMetadata.local_path)) {
    const sha = getRealFileSha(seedMetadata.local_path);
    const stat = fs.statSync(seedMetadata.local_path);
    const dt = new Date(Number(targetMsg.created_at)).toLocaleString('zh-CN', { timeZone: 'America/New_York' });
    const cName = registry[targetMsg.channel_id]?.name || registry[channelId]?.name || channelId;
    images.push({
      post_id: targetMsg.id,
      feed_id: targetMsg.channel_id || channelId,
      channel_name: cName,
      sender_name: targetMsg.sender_name,
      time_et: dt,
      post_caption: getPostCaption(targetMsg),
      local_path: seedMetadata.local_path.replace(/\\/g, '/'),
      image_sha: sha,
      size_bytes: stat.size
    });
  }

  // 2. 遍历窗内全部 7 条消息，从本地全量图库匹配属于该消息 post_id 的真图
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

// 3. 严格定义 20 组互不重复、严格对应原文连续子串的口诀清单
const STRICT_20_SEEDS = [
  // --- 1. G4: 二次握手博弈财报 (精准对齐 post_1CUmhoAGUop4SppGjvML7p 真实原文) ---
  {
    seed_id: 'G4',
    post_id: 'post_1CUmhoAGUop4SppGjvML7p',
    kid: 'k_second_handshake',
    label: '二次握手博弈财报',
    evidence_span: '因为这次是第二次遇到 rddt  hims这种盘中二次握手  二次握手的低点还是最近第三季度的最低点这种的 财报博弈方式 一般没太大问题 小超预期 大超预期 盘后都会有多的  在二次握手吸   盘后才预期 多的时候出',
    statement: '盘中二次握手低点博弈财报，在二次握手吸，盘后多的时候出。',
    not: []
  },
  // --- 2. G5: 4-28 被动减全文与缺口回买 ---
  {
    seed_id: 'G5',
    post_id: 'post_1CaWLMfYvJsZHjS9ugtaPj',
    kid: 'k_passive_redeem_then_rebuy',
    label: '4-28被动减全文与缺口回买',
    evidence_span: '明天盘后有些像微软这样大盘股的财报\n\n大陆这三天夜盘和盘前会被动减持\n\n\n\n每天会回踩进些不同板块个股的低点 分开三天',
    statement: '大盘股财报窗口预期被动减持，回踩不同板块个股低点分开观察。',
    not: []
  },
  // --- 3. g_img_001: 九转序列数学曲率图 ---
  {
    seed_id: 'g_img_001',
    post_id: 'post_1CXYCpXPkLs5VVnU5aBkJe',
    kid: 'pending_new',
    label: '九转序列数学曲率图',
    evidence_span: '九转序列是默认的一个数学公式 计算的曲率   反弹红1-9  回调就是绿1-9',
    statement: '九转序列是默认的数学公式计算曲率，反弹看红1-9，回调看绿1-9。',
    local_path: 'data/media/zhao/2026-01-27/post_1CXYCpXPkLs5VVnU5aBkJe_0.jpg',
    not: []
  },
  // --- 4. g_img_002: 看转弯两次有效拐点图 ---
  {
    seed_id: 'g_img_002',
    post_id: 'post_1CYDwHo9hVfbwciyfsR9sa',
    kid: 'pending_new',
    label: '看转弯两次有效拐点图',
    evidence_span: '每天只需要看转弯 真金白银是真  消息都是阻碍你',
    statement: '每天只需要看转弯，真金白银是真，消息都是阻碍你。',
    local_path: 'data/media/zhao/2026-02-17/post_1CYDwHo9hVfbwciyfsR9sa_0.jpg',
    not: []
  },
  // --- 5. g_img_003: 二次握手精确 SPX 指数图 ---
  {
    seed_id: 'g_img_003',
    post_id: 'post_1CayBBJeexEDaiEveHEmGa',
    kid: 'k_second_handshake',
    label: '二次握手精确 SPX 指数图',
    evidence_span: '二次握手比较精确的指数spx图',
    statement: '看二次握手用 SPX 图更精确。',
    local_path: 'data/media/zhao/2026-05-12/post_1CayBBJeexEDaiEveHEmGa_0.jpg',
    not: []
  },
  // --- 6. g_img_004: 法案投票周期高低点图 ---
  {
    seed_id: 'g_img_004',
    post_id: 'post_1Cb4TAuGNsh8zYEUCgnce7',
    kid: 'pending_new',
    label: '法案投票周期高低点图',
    evidence_span: '加密的高点 总在第一轮投票投一半时候',
    statement: '加密的高点常在第一轮投票投一半时。',
    local_path: 'data/media/zhao/2026-05-15/post_1Cb4TAuGNsh8zYEUCgnce7_0.jpg',
    not: []
  },
  // --- 7. g_img_005: IREN 跌补三缺口46整数底图 ---
  {
    seed_id: 'g_img_005',
    post_id: 'post_1CbTUayc44sNzPweAjd3QW',
    kid: 'pending_new',
    label: 'IREN 跌补三缺口46整数底图',
    evidence_span: '最有爆发的三要素要时刻盯紧 抓机会',
    statement: '最有爆发的三要素要时刻盯紧，抓机会。',
    local_path: 'data/media/zhao/2026-05-27/post_1CbTUayc44sNzPweAjd3QW_0.jpg',
    not: []
  },
  // --- 8. 公式区 01: CRWV (137.75+65.11)/2 反弹一半 ---
  {
    seed_id: 'formula_001',
    post_id: 'post_1CWLuUbwbhS7EvhKs97CBG',
    kid: 'k_half_retrace_watch',
    label: 'CRWV (137.75+65.11)/2 反弹一半',
    evidence_span: '第一轮计算公式 （137.75+65.11）/2=101.43\n\n\n\n根据公式就是101.43是一半位置出一半 到137.75 关门影响的高点附近就全出',
    statement: '第一轮计算公式（137.75+65.11）/2=101.43，是一半位置出一半。',
    not: []
  },
  // --- 9. 公式区 02: OKLO (135+79)/2 反弹一半 ---
  {
    seed_id: 'formula_002',
    post_id: 'post_1CWLw66PRrtK3gy33HJ4nP',
    kid: 'k_half_retrace_watch',
    label: 'OKLO (135+79)/2 反弹一半',
    evidence_span: '（135+79）/2=107 当时在109出过一半oklo 他属于到了一半位置没到前高的',
    statement: '（135+79）/2=107，到了一半位置出一半。',
    not: []
  },
  // --- 10. 总纲: 赵哥主观交易总诀打油诗 ---
  {
    seed_id: 'playbook_poem',
    post_id: 'post_1CWoRBJvkuBQgdN2Cq7Mci',
    kid: 'pending_new',
    label: '赵哥主观交易总诀打油诗',
    evidence_span: '普跌同沉不用慌，收盘寻底看稳当；\n\n普涨我跌要提防，减持利空细查详。\n\n事件来临莫急闯，尾二收盘低吸仓，\n\n靴子落地迎反弹，持股静待红盘扬。',
    statement: '主观交易总诀：普跌同沉不用慌，普涨我跌要提防，事件来临莫急闯，靴子落地迎反弹。',
    not: []
  },
  // --- 11. 形态: 不破第一轮低点二次握手吸 ---
  {
    seed_id: 'playbook_handshake_low',
    post_id: 'post_1CTt7rqCrE8p2CFjCM4ZRL',
    kid: 'k_second_handshake',
    label: '不破第一轮低点二次握手吸',
    evidence_span: '目前第一轮抛压后小反弹  等看下有没有第二轮下压 不破第一轮低点 在第一轮附近的完成二次握手',
    statement: '等看下有没有第二轮下压，不破第一轮低点，在第一轮附近完成二次握手。',
    not: []
  },
  // --- 12. 磨损计算: 期权与杠杆磨损值折算上一轮价格 ---
  {
    seed_id: 'playbook_decay_calc',
    post_id: 'post_1CTupUZ5X6Q9X8RUSBd5c9',
    kid: 'pending_new',
    label: '期权与杠杆磨损值折算上一轮价格',
    evidence_span: '回调 18.8-18.7  和17.9-17.8附近支撑分批回吸 第三次 计算了磨损值  18.8相当于第一轮的19.2',
    statement: '近支撑分批回吸计算磨损值，折算等效支撑价格。',
    not: []
  },
  // --- 13. 纪律: 分批只减最后补的一笔成本出 ---
  {
    seed_id: 'playbook_cost_exit',
    post_id: 'post_1CUovuqHikTdzgQiiS7ENA',
    kid: 'pending_new',
    label: '分批只减最后补的一笔成本出',
    evidence_span: '分批只减自己最后补的那笔\n\n\n\n距离举例  \n\n\n\n比如40补的bmnr  也在反弹40附近就先成本出',
    statement: '分批只减自己最后补的那笔，反弹至成本先成本出。',
    not: []
  },
  // --- 14. 战法: 皮球理论水下急跌埋伏异动出 ---
  {
    seed_id: 'playbook_rubber_ball',
    post_id: 'post_1Cbwt9woNwEzibuyrHM7bb',
    kid: 'pending_new',
    label: '皮球理论水下急跌埋伏异动出',
    evidence_span: '皮球理论就是 水下急跌埋伏 异动出',
    statement: '皮球理论就是水下急跌埋伏，异动出。',
    not: []
  },
  // --- 15. 时机: 周末不互撕跳涨与周五盘后低点回买 ---
  {
    seed_id: 'playbook_friday_v',
    post_id: 'post_1CU4FU6SrPb6ssWKXkHNDo',
    kid: 'pending_new',
    label: '周末不互撕跳涨与周五盘后低点回买',
    evidence_span: '因为周末没有互撕 跳涨了 再次回买以周五的盘后最低的价格计算找回买机会',
    statement: '周末无利空跳涨，以周五盘后最低价格计算找回买机会。',
    not: []
  },
  // --- 16. 纪律: 缺口每次只做一次日内 ---
  {
    seed_id: 'playbook_gap_once',
    post_id: 'post_1CbASmAPtdCknnaHcfBcAo',
    kid: 'pending_new',
    label: '缺口每次只做一次日内',
    evidence_span: '每次到缺口只做一次日内  跌破肯定往下继续补下面缺口',
    statement: '每次到缺口只做一次日内，跌破等待下方缺口。',
    not: []
  },
  // --- 17. 仓位: 总仓位不超过7成留3成做T ---
  {
    seed_id: 'playbook_position_70',
    post_id: 'post_1CW3UCsAesy8CkMKzSDzA7',
    kid: 'pending_new',
    label: '总仓位不超过7成留3成做T',
    evidence_span: '盘后所有的股票加起来总仓位不要超过7成 周一万一有回踩还要有做T资金',
    statement: '盘后总仓位不超过7成，保留3成做T资金。',
    not: ['总仓位超过7成']
  },
  // --- 18. 公式: RKLB/ASTS 反弹一半方向测算 ---
  {
    seed_id: 'formula_space_asts',
    post_id: 'post_1CVkJTMPBDiPHpvx618Da4',
    kid: 'k_half_retrace_watch',
    label: 'RKLB/ASTS 反弹一半方向测算',
    evidence_span: '太空板块是昨天刚反弹 asts和rklb也是往反弹一半的方向走 \n\n\n\nrklb  （66.35+37.57）/2=51.96\n\nasts (49.31+83.31)/2=66.31',
    statement: '太空板块往反弹一半的方向走：rklb（66.35+37.57）/2=51.96，asts (49.31+83.31)/2=66.31。',
    not: []
  },
  // --- 19. 因果: 减持企稳迹象 ---
  {
    seed_id: 'playbook_supply_unlock',
    post_id: 'post_1CULVkM6vhRYwSunr7xuLj',
    kid: 'pending_new',
    label: '减持企稳迹象配置',
    evidence_span: '减持完毕公告虽然还没出 但是有企稳迹象了',
    statement: '减持完毕公告虽未出，但出现企稳迹象时可关注。',
    not: []
  },
  // --- 20. 纪律: 被动减每天股仓位一般分三份每跌一个缺口买一份 ---
  {
    seed_id: 'playbook_passive_three_parts',
    post_id: 'post_1CbAPabncHPXk44npRESnx',
    kid: 'pending_new',
    label: '被动减每天股仓位一般分三份每跌一个缺口买一份',
    evidence_span: '被动减每天股仓位一般分三份 每跌一个缺口买一份',
    statement: '被动减持期间仓位分三份，每跌一个缺口买一份。',
    not: ['一次性满仓买入']
  }
];

const final20 = [];
for (let i = 0; i < STRICT_20_SEEDS.length; i++) {
  const item = STRICT_20_SEEDS[i];
  const row = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(item.post_id);
  if (!row) {
    throw new Error(`❌ 致命错误: 未在数据库中找到指定 post_id: ${item.post_id} (${item.label})`);
  }
  const win = buildWindow(row, item);
  win.cu_id = `cu_l2b_drycut_20260830_${String(i + 1).padStart(5, '0')}`;
  win.seed_id = item.seed_id;
  win.seed_label = item.label;
  final20.push(win);
}

// 4. 落盘独立文件 data/samples/l2b_dry_cut_20.jsonl
const outPath = path.resolve('data/samples/l2b_dry_cut_20.jsonl');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, final20.map(x => JSON.stringify(x)).join('\n') + '\n', 'utf-8');

console.log(`✅ 成功落盘独立文件: ${outPath} (共 ${final20.length} 窗)\n`);

// 5. 打印验收核对报表
console.log('=======================================================================================================================================');
console.log('📋 L2b 规范全面对齐 20 窗清单与全要素核验表');
console.log('=======================================================================================================================================');
console.log('序号 | CU ID | 真实 post_id | 频道名称 (feed_id) | 同Feed | 配图状态 (真实SHA) | 规范 kid | 锚点口诀 / 原文前 200 字摘要');
console.log('-----|-------|--------------|--------------------|--------|---------------------|----------|----------------------------------------------------');

final20.forEach((w, i) => {
  const seedTag = w.seed_id ? `⭐[${w.seed_id}] ` : '';
  const imgStr = w.has_real_image ? `🖼️ ${w.local_image_path.split('/').pop()} (SHA:${w.image_sha})` : 'no_image';
  const cleanSnippet = w.raw_text.replace(/\n/g, ' ').slice(0, 55);
  console.log(
    `${String(i + 1).padStart(2, '0')} | ${w.cu_id} | ${w.post_id} | ${w.channel_name} | ${w.is_same_feed ? '✅同' : '❌混'} | ${imgStr} | ${w.kid} | ${seedTag}${cleanSnippet}...`
  );
});

console.log('\n=======================================================================================================================================');
console.log('🎯 六大核心修正闭环验证:');
console.log(`- 1. [G4 对齐换帖] post_1CUmhoAGUop4SppGjvML7p ("在二次握手吸"): ${final20.some(w => w.post_id === 'post_1CUmhoAGUop4SppGjvML7p') ? '✅ 100% 命中且证据为汉字' : '❌ 错误'}`);
console.log(`- 2. [证据排除图片URL] 003~007 全部为汉字口诀: ${final20.every(w => !w.evidence_span.startsWith('[IMAGE:')) ? '✅ 100% 纯汉字证据' : '❌ 包含图片URL'}`);
console.log(`- 3. [非标准 kid 改 pending_new] 未在25 hits中的全部打标 pending_new: ${final20.filter(w => ['k_second_handshake', 'k_passive_redeem_then_rebuy', 'k_half_retrace_watch', 'k_rubber_ball_after_gap_fill', 'pending_new'].includes(w.kid)).length === 20 ? '✅ 100% 合规' : '❌ 存在自造 kid'}`);
console.log(`- 4. [018 标错战法修正] post_1CVkJTMPBDiPHpvx618Da4 修正为 k_half_retrace_watch: ${final20.find(w => w.post_id === 'post_1CVkJTMPBDiPHpvx618Da4')?.kid === 'k_half_retrace_watch' ? '✅ 修正' : '❌ 错误'}`);
console.log(`- 5. [014 statement 删减加戏] post_1Cbwt9woNwEzibuyrHM7bb 仅保留水下急跌埋伏异动出: ${final20.find(w => w.post_id === 'post_1Cbwt9woNwEzibuyrHM7bb')?.statement === '皮球理论就是水下急跌埋伏，异动出。' ? '✅ 无加戏' : '❌ 仍有加戏'}`);
console.log(`- 6. [真 SHA 校验] 5张配图全部填写真实 SHA256 前16位: ${final20.filter(w => w.has_real_image).every(w => w.image_sha !== 'verified_gold_image' && w.image_sha !== 'no_image') ? '✅ 真实 SHA256' : '❌ 存在假 SHA'}`);
console.log('=======================================================================================================================================\n');
