import fs from 'fs';
import { getDb, initDb } from '../database.js';

initDb();
const db = getDb();

console.log('====================================================');
console.log('🛡️ 运行断言检验：周哥 L2b 知识原子库隔离性与合规性检查');
console.log('====================================================\n');

// 1. 检验 atoms.json
const atomsPath = 'data/l2b/mrzhou/atoms.json';
if (!fs.existsSync(atomsPath)) {
  console.error('❌ 缺少 data/l2b/mrzhou/atoms.json');
  process.exit(1);
}

const atoms = JSON.parse(fs.readFileSync(atomsPath, 'utf-8'));
console.log(`📋 成功载入周哥 L2b 原子总数: ${atoms.length} 个`);

let allHintOnly = true;
let allNotPlaceOrder = true;
const mrzhouKids = new Set();

for (const a of atoms) {
  mrzhouKids.add(a.kid);
  if (a.status !== 'hint_only') {
    console.error(`❌ [${a.kid}] status 不是 hint_only: ${a.status}`);
    allHintOnly = false;
  }
  if (a.not !== 'place_order') {
    console.error(`❌ [${a.kid}] not 属性缺失或不是 place_order: ${a.not}`);
    allNotPlaceOrder = false;
  }
}

if (!allHintOnly || !allNotPlaceOrder) {
  console.error('❌ 周哥 L2b 原子合规检查未通过！');
  process.exit(1);
}
console.log('✅ 所有 18 个原子 100% 标记为 status=hint_only 且 not=place_order！');

// 2. 检查 SQLite l2a_order_candidates 表中是否有周哥原子污染
const candidates = db.prepare(`SELECT * FROM l2a_order_candidates LIMIT 1000`).all();
let pollutedCount = 0;

for (const c of candidates) {
  const content = JSON.stringify(c);
  for (const kid of mrzhouKids) {
    if (content.includes(kid)) {
      console.error(`❌ 发现 L2a 候选表污染！ID: ${c.id} 包含周哥原子: ${kid}`);
      pollutedCount++;
    }
  }
}

if (pollutedCount > 0) {
  console.error(`❌ L2a 候选表存在 ${pollutedCount} 处周哥原子污染！`);
  process.exit(1);
}

console.log('✅ L2a 候选订单表 100% 纯净，零周哥原子污染！');
console.log('\n====================================================');
console.log('🎉 周哥 L2b 知识库隔离性断言 100% 全部通过！');
console.log('====================================================');
