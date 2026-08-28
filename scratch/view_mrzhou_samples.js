import { getDb, initDb } from '../database.js';

initDb();
const db = getDb();

console.log('====================================================');
console.log('🔍 深度查看 Mrzhoulucky 频道的信号特征');
console.log('====================================================\n');

console.log('📡 1. 【日内波段信号检测】(chat_feed_1CaEnj8BrNBr95YSbgabYZ) 最新样本:');
const intradaySamples = db.prepare(`
  SELECT content, created_at FROM messages
  WHERE channel_id = 'chat_feed_1CaEnj8BrNBr95YSbgabYZ'
  ORDER BY created_at DESC LIMIT 3
`).all();
for (const s of intradaySamples) {
  console.log(`---\n${s.content}\n`);
}

console.log('\n📡 2. 【股票分析】(chat_feed_1CaPyASfSWTuruMgL2u3sT) 最新样本:');
const stockAnalysisSamples = db.prepare(`
  SELECT content, created_at FROM messages
  WHERE channel_id = 'chat_feed_1CaPyASfSWTuruMgL2u3sT'
  ORDER BY created_at DESC LIMIT 3
`).all();
for (const s of stockAnalysisSamples) {
  console.log(`---\n${s.content}\n`);
}
