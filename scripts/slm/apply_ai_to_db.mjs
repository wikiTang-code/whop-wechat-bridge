import { getDb } from '../../database.js';
import { resimulateReplayQueue, pushCurrentReplayCard } from '../../follow-replay-engine.js';
import fs from 'fs';

async function main() {
  const db = getDb();
  const filePath = 'data/slm/pending_inferred_ai.json';
  if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    process.exit(1);
  }

  const items = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  console.log(`准备应用 ${items.length} 笔 AI 解析结果到 follow_replay_queue (status='pending')...`);

  const updateStmt = db.prepare(`
    UPDATE follow_replay_queue
    SET parsed_ticker = ?, parsed_action = ?, parsed_price = ?, source_lot_price = ?, fraction_desc = ?, fraction_ratio = ?
    WHERE id = ? AND status = 'pending'
  `);

  const tx = db.transaction((rows) => {
    let updated = 0;
    for (const r of rows) {
      const res = updateStmt.run(
        r.parsed_ticker,
        r.parsed_action,
        r.parsed_price,
        r.source_lot_price,
        r.fraction_desc,
        r.fraction_ratio,
        r.id
      );
      if (res.changes > 0) updated++;
    }
    return updated;
  });

  const count = tx(items);
  console.log(`✅ 成功更新 ${count} 条待审记录为 AI 模型解析要素！`);

  // 从第 38 笔开始执行全队列级联推演
  console.log('🔄 正在基于 AI 模型要素从第 #38 笔开始级联重算后续持仓与股数...');
  const simResult = resimulateReplayQueue(db, 38);
  console.log('✅ 级联重算完成！统计:', JSON.stringify(simResult));

  // 获取当前队头
  const head = db.prepare(`
    SELECT seq_no, parsed_ticker, parsed_action, parsed_price, parsed_qty, fraction_desc, raw_content
    FROM follow_replay_queue
    WHERE status = 'pending'
    ORDER BY seq_no ASC
    LIMIT 1
  `).get();
  console.log('\n🎯 当前队头待审单 (AI-Driven):', JSON.stringify(head, null, 2));

  // 推送企微卡片
  console.log('\n📲 正在向企业微信推送最新待审卡片...');
  const pushRes = await pushCurrentReplayCard(db);
  console.log('✅ 推送结果:', JSON.stringify(pushRes));
}

main().catch(err => {
  console.error('Error applying AI results:', err);
  process.exit(1);
});
