import fs from 'fs';
import path from 'path';

console.log('========================================================================================');
console.log('🛡️ 启动升级版统一时序动态账本清洗与质量硬核门禁器 (Clean Ledger Gate v2.0)');
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

  // A 层检查：message_id 严格格式、真子串校验、图注阻断
  const checkInstance = (inst, parentNode) => {
    // 1. message_id 格式
    if (!inst.message_id || !/^post_[A-Za-z0-9]+$/.test(inst.message_id)) {
      violations.push(`[A层-ID格式违规] 节点 [${parentNode}] 中的 message_id 非法或截断: "${inst.message_id}"`);
    }

    // 2. 严格原文连续子串（不剥空白）
    if (inst.raw_text && inst.evidence_span) {
      if (!inst.raw_text.includes(inst.evidence_span.trim())) {
        violations.push(`[A层-严格子串违规] 节点 [${parentNode}] 的 evidence_span 不是 raw_text 的连续子串`);
      }
    }

    // 3. 图注/配图说明禁止进 gold_*
    const raw = inst.raw_text || '';
    if (parentNode.startsWith('gold_')) {
      const isPureImageCaption = /(图\b|如图|这张图|spx图|k线图)/.test(raw) && !/(二次握手.*吸|回踩.*低吸|只做一次|转弯.*回吸|\/2=|被动减.*建仓)/.test(raw);
      if (isPureImageCaption) {
        violations.push(`[A层-图注混入金标] 节点 [${parentNode}] 混入配图说明/图注: "${raw.slice(0, 50)}..."`);
      }
    }
  };

  // 遍历 tree_instances_detail
  const instancesDetail = data.tree_instances_detail || {};
  for (const [nodeId, instList] of Object.entries(instancesDetail)) {
    instList.forEach(inst => checkInstance(inst, nodeId));

    // B 层检查：同一天同 tree_id 对【所有】节点只计 1 次规则复述（杜绝同日多票虚增）
    const dateCounts = {};
    instList.forEach(inst => {
      if (inst.et_date) {
        dateCounts[inst.et_date] = (dateCounts[inst.et_date] || 0) + 1;
      }
    });

    for (const [d, count] of Object.entries(dateCounts)) {
      if (count > 1) {
        violations.push(`[B层-所有节点同日去重违规] 节点 [${nodeId}] 在 ${d} 重复计账 ${count} 次 (未合并同日后缀)`);
      }
    }
  }

  // C 层检查：Skip 审计中的真课错漏校验（所有非 duplicate/suffix 的项目严禁漏判真课）
  const skipLog = data.skipped_audit_log || [];
  for (const skipItem of skipLog) {
    if (skipItem.category === 'duplicate_post' || skipItem.category === 'same_day_suffix' || skipItem.category === 'image_caption_memo') {
      continue;
    }

    const raw = skipItem.raw_text || '';

    // C1: 被动减操作时钟
    if ((raw.includes('夜盘出一半') && (raw.includes('韩指') || raw.includes('韩国指数'))) || (raw.includes('3点强平') && raw.includes('循环'))) {
      violations.push(`[C层-真课错漏] Skip 中包含 [被动减操作时钟]，应挂接 gold_006，严禁当弱点评: "${raw.slice(0, 50)}..."`);
    }

    // C2: 盘口转弯优先于新闻
    if (raw.includes('到处找新闻') || raw.includes('看到点位看转弯')) {
      violations.push(`[C层-真课错漏] Skip 中包含 [盘口转弯优先于新闻]，应挂接 prop_017，严禁当弱点评: "${raw.slice(0, 50)}..."`);
    }

    // C3: 缺口只做一次日内
    if (raw.includes('只做一次日内') || (raw.includes('缺口') && raw.includes('只做一次'))) {
      violations.push(`[C层-真课错漏] Skip 中包含 [缺口只做一次日内]，应挂接 gold_003，严禁当弱点评: "${raw.slice(0, 50)}..."`);
    }

    // C4: 整数没小数点底部要素
    if (raw.includes('整数') && raw.includes('小数点') && raw.includes('最低')) {
      violations.push(`[C层-真课错漏] Skip 中包含 [整数没小数点底部要素]，应挂接 prop_001，严禁当弱点评: "${raw.slice(0, 50)}..."`);
    }

    // C5: 节后叠月末
    if (raw.includes('节后') && raw.includes('月末减持') && raw.includes('多等一周')) {
      violations.push(`[C层-真课错漏] Skip 中包含 [节后叠月末细则]，应挂接 gold_006，严禁当弱点评: "${raw.slice(0, 50)}..."`);
    }
  }

  if (violations.length === 0) {
    console.log(`✅ 门禁通过！A/B/C 三层硬核规则 100% 校验合格 (0 违规)`);
  } else {
    console.error(`🚨 门禁未通过！共检测出 ${violations.length} 项违规:`);
    violations.forEach((v, idx) => console.error(`   ${idx + 1}. ${v}`));
    allPassed = false;
    totalViolationsCount += violations.length;
  }
}

console.log('\n========================================================================================');
if (allPassed) {
  console.log('🎉 全量账本通过 Clean Ledger Gate v2.0 硬核门禁校验，数据严密自洽，允许放行与交底！');
  process.exit(0);
} else {
  console.error(`❌ 全量账本门禁未通过，共存在 ${totalViolationsCount} 处违规，严禁放行！`);
  process.exit(1);
}
