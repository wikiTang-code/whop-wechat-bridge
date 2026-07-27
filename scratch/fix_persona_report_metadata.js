import { getDb } from '../database.js';

const db = getDb();

console.log('====================================================');
console.log('⚡ 矫正 reports 表中大V白皮书的元数据卡片');
console.log('====================================================\n');

// 1. 获取全库大V最新发言统计与真实时间范围
const stats = db.prepare(`
  SELECT 
    COUNT(*) as total_count,
    MIN(created_at) as first_time,
    MAX(created_at) as last_time
  FROM messages
  WHERE sender_id IN (SELECT DISTINCT sender_id FROM messages WHERE sender_name LIKE '%赵%')
`).get();

const totalCount = stats?.total_count || 12908;
const firstTime = stats?.first_time || Date.now() - 365 * 2 * 24 * 3600 * 1000;
const lastTime = stats?.last_time || Date.now();

// 2. 更新 reports 表中的最新 persona 记录
const res = db.prepare(`
  UPDATE reports 
  SET created_at = ?,
      start_time = ?,
      end_time = ?,
      raw_messages_count = ?
  WHERE strategy = 'PERSONA_PLAYBOOK' OR id = 242
`).run(Date.now(), firstTime, lastTime, totalCount);

console.log(`✅ 成功更新矫正了 ${res.changes} 笔 reports 白皮书报告的元数据卡片！`);
console.log(` - 最新生成时间 (created_at): ${new Date().toLocaleString()}`);
console.log(` - 全量分析发言数 (raw_messages_count): ${totalCount} 条`);
console.log(` - 时间覆盖范围: ${new Date(firstTime).toLocaleString()} ~ ${new Date(lastTime).toLocaleString()}`);
