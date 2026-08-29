import { getDb } from '../database.js';
import fs from 'fs';

const db = getDb();

console.log('========================================================================================');
console.log('🔍 全数据库「赵哥」发言频道与图文消息全量覆盖审计');
console.log('========================================================================================\n');

// 1. 查找赵哥的所有发言频道统计
const zhaoStats = db.prepare(`
  SELECT 
    channel_id,
    COUNT(*) as total_messages,
    SUM(CASE WHEN content LIKE '%img-v2%' OR content LIKE '%assets-2%' OR content LIKE '%[IMAGE:%' THEN 1 ELSE 0 END) as image_messages,
    MIN(created_at) as first_seen,
    MAX(created_at) as last_seen
  FROM messages 
  WHERE sender_name LIKE '%赵哥%' OR sender_name LIKE '%zhao%' OR sender_id = 'user_17909136'
  GROUP BY channel_id
  ORDER BY total_messages DESC
`).all();

console.log(`📊 数据库中检索到赵哥发言的频道共 ${zhaoStats.length} 个:\n`);

const channelNameMap = {
  'forum_feed_1CTr7SqVMzFfuFiiRJLEHN': '📻 不用翻墙美股发布 (官方广播)',
  'chat_feed_1CTr5VAdNHtbZAFaTitvoT': '💬 不用翻墙美股讨论区',
  'chat_feed_1CTrCEx44dP13jW3RVkYiS': '📈 不用翻墙期权',
  'chat_feed_1CU95KbtifP1JtuqTiVXZb': '📝 讨论区股票记录',
  'chat_feed_1CWLuNUVYVVYttro8gAvJ5': '📜 历史股票期权记录区',
  'chat_feed_1CWr2M4f1Q8x9K': '📐 市值理论100跌50 公式记录'
};

let totalZhaoMsgs = 0;
let totalZhaoImgMsgs = 0;

console.log('| 序号 | 频道 ID | 频道中文名 | 赵哥发言总条数 | 含图消息条数 | 活跃时间跨度 |');
console.log('|:---|:---|:---|:---|:---|:---|');

function formatDate(val) {
  if (!val) return 'N/A';
  if (typeof val === 'number') return new Date(val).toISOString().slice(0, 10);
  return String(val).slice(0, 10);
}

zhaoStats.forEach((st, idx) => {
  totalZhaoMsgs += st.total_messages;
  totalZhaoImgMsgs += st.image_messages;
  const cname = channelNameMap[st.channel_id] || `频道 (${st.channel_id})`;
  console.log(`| ${idx + 1} | \`${st.channel_id}\` | **${cname}** | ${st.total_messages} 条 | ${st.image_messages} 张 | ${formatDate(st.first_seen)} ~ ${formatDate(st.last_seen)} |`);
});

console.log(`\n📌 赵哥全库发言总计: ${totalZhaoMsgs} 条消息 | 含图消息总计: ${totalZhaoImgMsgs} 条\n`);

// 2. 检查知识 CU 切窗对赵哥发言频道的覆盖情况
const cuPath = 'data/samples/l2b_cu_20260829_know01.jsonl';
if (fs.existsSync(cuPath)) {
  const cuLines = fs.readFileSync(cuPath, 'utf-8').trim().split('\n').filter(Boolean);
  console.log(`📚 当前知识 CU 样本集: 共 ${cuLines.length} 组知识窗`);
  
  const cuChannelStats = {};
  cuLines.forEach(l => {
    try {
      const cu = JSON.parse(l);
      const ch = cu.channel || 'unknown';
      cuChannelStats[ch] = (cuChannelStats[ch] || 0) + 1;
    } catch (e) {}
  });

  console.log('\n🔍 知识切窗对赵哥发言频道的覆盖分布:');
  for (const [ch, cnt] of Object.entries(cuChannelStats)) {
    console.log(`  - 频道 [${ch}]: ${cnt} 组知识 CU`);
  }
}

// 3. 检查 media_manifest.json 对赵哥图片的覆盖情况
const manifestPath = 'data/media/zhao/media_manifest.json';
if (fs.existsSync(manifestPath)) {
  const manifestData = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const manifest = manifestData.manifest || [];
  console.log(`\n🖼️ 当前图文资产清单: 共纳入 ${manifest.length} 张图片`);
}

console.log('\n========================================================================================');
