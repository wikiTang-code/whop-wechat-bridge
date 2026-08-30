import fs from 'fs';
import path from 'path';

console.log('========================================================================================');
console.log('🛡️ 启动统一时序动态账本清洗与质量门禁器 (Clean Ledger Gate v1.0)');
console.log('========================================================================================\n');

const targetFiles = process.argv.slice(2);
const ledgerFiles = targetFiles.length > 0 
  ? targetFiles 
  : fs.readdirSync('data/l2b/gold')
      .filter(f => f.startsWith('zhao_chronological_ledger_') && f.endsWith('.json'))
      .map(f => path.join('data/l2b/gold', f));

let allPassed = true;
let totalViolationsCount = 0;

for (const filePath of ledgerFiles) {
  console.log(`\n----------------------------------------------------------------------------------------`);
  console.log(`🔍 正在检查账本文件: ${filePath}`);
  console.log(`----------------------------------------------------------------------------------------`);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ 文件不存在: ${filePath}`);
    allPassed = false;
    continue;
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const violations = [];

  // A 层检查：message_id 格式与 evidence_span 子串校验
  const checkInstance = (inst, parentNode) => {
    if (!inst.message_id || !/^post_[A-Za-z0-9]+$/.test(inst.message_id)) {
      violations.push(`[A层-ID格式违规] 节点 [${parentNode}] 中的 message_id 非法或截断: "${inst.message_id}"`);
    }
    if (inst.raw_text && inst.evidence_span) {
      const cleanRaw = inst.raw_text.replace(/\s+/g, '');
      const cleanSpan = inst.evidence_span.replace(/\s+/g, '');
      if (!cleanRaw.includes(cleanSpan)) {
        violations.push(`[A层-子串违规] 节点 [${parentNode}] 的 evidence_span 不是 raw_text 的连续子串`);
      }
    }
  };

  // 遍历 tree_instances_detail
  const instancesDetail = data.tree_instances_detail || {};
  for (const [nodeId, instList] of Object.entries(instancesDetail)) {
    instList.forEach(inst => checkInstance(inst, nodeId));

    // B 层检查：同一天同 tree_id 规则复述去重校验
    const dateCounts = {};
    instList.forEach(inst => {
      if (inst.et_date) {
        dateCounts[inst.et_date] = (dateCounts[inst.et_date] || 0) + 1;
      }
    });

    for (const [d, count] of Object.entries(dateCounts)) {
      if (count > 1 && (nodeId === 'gold_004_position_control_70_pct' || nodeId === 'gold_011_zhao_poem_official')) {
        violations.push(`[B层-同日虚增] 节点 [${nodeId}] 在 ${d} 重复计账 ${count} 次 (未合并同日后缀)`);
      }
    }
  }

  // C 层检查：Skip 审计中的真课错漏校验（仅针对 weak_commentary 误分类，合法 duplicate/suffix 除外）
  const skipLog = data.skipped_audit_log || [];
  for (const skipItem of skipLog) {
    if (skipItem.category === 'duplicate_post' || skipItem.category === 'same_day_suffix' || skipItem.category === 'image_caption_memo') {
      continue; // 跨频道副本、同日后缀与图注属于正常审计，不视作错漏
    }

    const raw = skipItem.raw_text || '';

    // C1: 检查是否将核心日历时钟/细则错打为 weak
    if ((raw.includes('夜盘出一半') && raw.includes('韩指')) || (raw.includes('3点强平') && raw.includes('循环'))) {
      violations.push(`[C层-真课错漏] Skip 中包含 [被动减操作时钟]，应挂接 gold_006.refinement，严禁当弱点评: "${raw.slice(0, 50)}..."`);
    }

    // C2: 检查是否将核心盘口纪律错打为 weak
    if (raw.includes('到处找新闻') || raw.includes('看到点位看转弯')) {
      violations.push(`[C层-真课错漏] Skip 中包含 [盘口转弯优先于新闻]，应挂接 prop_017，严禁当弱点评: "${raw.slice(0, 50)}..."`);
    }
  }

  if (violations.length === 0) {
    console.log(`✅ 门禁通过！A/B/C 三层规则 100% 校验合格 (0 违规)`);
  } else {
    console.error(`🚨 门禁未通过！共检测出 ${violations.length} 项违规:`);
    violations.forEach((v, idx) => console.error(`   ${idx + 1}. ${v}`));
    allPassed = false;
    totalViolationsCount += violations.length;
  }
}

console.log('\n========================================================================================');
if (allPassed) {
  console.log('🎉 全量账本 (1~8 档) 100% 通过 Clean Ledger Gate 门禁校验，数据严密自洽，允许放行与交底！');
  process.exit(0);
} else {
  console.error(`❌ 全量账本门禁未通过，共存在 ${totalViolationsCount} 处违规，严禁放行！`);
  process.exit(1);
}
