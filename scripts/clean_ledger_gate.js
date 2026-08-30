import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

console.log('========================================================================================');
console.log('🛡️ 启动真正硬核统一时序动态账本质量门禁器 (Clean Ledger Gate v3.0 工业实装版)');
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
  console.log(`🔍 正在严格质检账本文件: ${filePath}`);
  console.log(`----------------------------------------------------------------------------------------`);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ 文件不存在: ${filePath}`);
    allPassed = false;
    continue;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.error(`❌ JSON 格式损坏，无法解析: ${err.message}`);
    allPassed = false;
    totalViolationsCount++;
    continue;
  }

  const violations = [];

  // =====================================================================================
  // 1. 元数据一致性校验 (Check 5: breakdown 之和必须严格等于 skipped_audit_log.length)
  // =====================================================================================
  const skipLog = data.skipped_audit_log || [];
  const meta = data.metadata || {};
  const breakdown = meta.skipped_breakdown || {};
  const breakdownSum = Object.values(breakdown).reduce((sum, val) => sum + Number(val), 0);

  if (meta.skipped_stops_total !== skipLog.length) {
    violations.push(`[元数据不一致] metadata.skipped_stops_total (${meta.skipped_stops_total}) !== skipped_audit_log.length (${skipLog.length})`);
  }
  if (breakdownSum !== skipLog.length) {
    violations.push(`[元数据不一致] metadata.skipped_breakdown 分类之和 (${breakdownSum}) !== skipped_audit_log.length (${skipLog.length})`);
  }

  // =====================================================================================
  // 2. 跨频道归一化 SHA256 唯一性校验 (Check 1: 树节点实例绝不允许跨频道重复)
  // =====================================================================================
  const instancesDetail = data.tree_instances_detail || {};
  const seenShaMap = new Map();

  for (const [nodeId, instList] of Object.entries(instancesDetail)) {
    instList.forEach(inst => {
      const raw = inst.raw_text || '';
      const normText = raw.replace(/\s+/g, '');
      if (normText.length > 5) {
        const sha = crypto.createHash('sha256').update(normText).digest('hex');
        if (seenShaMap.has(sha)) {
          violations.push(`[A层-跨频道重复进树] 节点 [${nodeId}] 实例与 [${seenShaMap.get(sha).nodeId}] 重复 (SHA: ${sha.slice(0, 8)}): "${raw.slice(0, 40)}..."`);
        } else {
          seenShaMap.set(sha, { nodeId, msgId: inst.message_id });
        }
      }
    });
  }

  // =====================================================================================
  // 3. A层：严格 Message ID 格式、原生真连续子串校验、图注阻断、点位口播阻断
  // =====================================================================================
  const PURE_FILL_REGEX = /^(\d+(\.\d+)?\s*(出|买|接|减|加|挂|止损|清仓|建仓|减持|减仓)|(出|买|接|减|加|减持)\s*(\d+(\.\d+)?|点|一半))/i;

  for (const [nodeId, instList] of Object.entries(instancesDetail)) {
    instList.forEach(inst => {
      // 3.1 严格 message_id 格式
      if (!inst.message_id || !/^post_[A-Za-z0-9]+$/.test(inst.message_id)) {
        violations.push(`[A层-ID格式违规] 节点 [${nodeId}] 中的 message_id 非法或带截断占位符: "${inst.message_id}"`);
      }

      // 3.2 严格原生真子串校验 (严禁先删空白再匹配)
      const raw = inst.raw_text || '';
      const span = inst.evidence_span || '';
      if (!span) {
        violations.push(`[A层-缺失Span] 节点 [${nodeId}] 实例缺失 evidence_span`);
      } else if (!raw.includes(span)) {
        violations.push(`[A层-原生真子串违规] 节点 [${nodeId}] 的 evidence_span 不是 raw_text 的原生连续子串 (原文不含该精确子串)`);
      }

      // 3.3 图注/配图说明禁止进 gold_* (Check 3)
      if (nodeId.startsWith('gold_')) {
        const isImageCaption = /(图\b|如图|这张图|spx图|k线图)/.test(raw) && !/(二次握手.*吸|回踩.*低吸|只做一次|转弯.*回吸|\/2=|被动减.*建仓|普跌同沉)/.test(raw);
        if (isImageCaption) {
          violations.push(`[A层-图注混入金标] 节点 [${nodeId}] 混入配图说明/图注: "${raw.slice(0, 50)}..."`);
        }
      }

      // 3.4 纯点位成交口播禁止进树 (Check 4)
      if (raw.length < 40 && PURE_FILL_REGEX.test(raw) && !/(机制|规则|公式|要素|二次握手|反弹一半|靴子|被动减|只做一次)/.test(raw)) {
        violations.push(`[A层-点位口播混入树] 节点 [${nodeId}] 混入纯点位口播: "${raw.slice(0, 50)}..."`);
      }
    });

    // =====================================================================================
    // 4. B层：同日同 tree_id 对【所有】节点严格只计 1 次规则复述 (Check 2)
    // =====================================================================================
    const dateCounts = {};
    instList.forEach(inst => {
      if (inst.et_date) {
        dateCounts[inst.et_date] = (dateCounts[inst.et_date] || 0) + 1;
      }
    });

    for (const [d, count] of Object.entries(dateCounts)) {
      if (count > 1) {
        violations.push(`[B层-所有节点同日去重违规] 节点 [${nodeId}] 在 ${d} 重复计账 ${count} 次 (同日多票未合并)`);
      }
    }
  }

  // =====================================================================================
  // 5. C层：Skip 审计中的真课错漏校验（严禁将核心规则与反例打为 weak）
  // =====================================================================================
  for (const skipItem of skipLog) {
    if (skipItem.category === 'duplicate_post' || skipItem.category === 'same_day_suffix' || skipItem.category === 'image_caption_memo') {
      continue; // 跨频道副本、同日后缀与图注属于正常审计
    }

    const raw = skipItem.raw_text || '';

    // C1: 被动减操作时钟
    if ((raw.includes('夜盘出一半') && (raw.includes('韩指') || raw.includes('韩国指数'))) || (raw.includes('3点强平') && raw.includes('循环'))) {
      violations.push(`[C层-真课错漏] Skip 中包含 [被动减操作时钟]，应挂接 gold_006，严禁当弱点评: "${raw.slice(0, 50)}..."`);
    }

    // C2: 盘口转弯优先于新闻
    if (raw.includes('到处找新闻') || raw.includes('看到点位看转弯') || raw.includes('不要到处找新闻')) {
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

    // C6: 反例词不能当 weak
    if (raw.includes('不会回补') || raw.includes('没有回踩缺口一说') || raw.includes('指数没有回踩缺口')) {
      if (skipItem.category !== 'negative_boundary_case' && !skipItem.reason?.includes('反例')) {
        violations.push(`[C层-反例错漏] Skip 中包含 [缺口反例限定]，应归入 negative_boundary_case，严禁当普通弱点评: "${raw.slice(0, 50)}..."`);
      }
    }
  }

  // 输出当前文件质检报告
  if (violations.length === 0) {
    console.log(`✅ 门禁 100% 通过！Check 1~5 全项规则校验合格 (0 违规)`);
  } else {
    console.error(`🚨 门禁未通过！共检测出 ${violations.length} 项违规:`);
    violations.forEach((v, idx) => console.error(`   ${idx + 1}. ${v}`));
    allPassed = false;
    totalViolationsCount += violations.length;
  }
}

console.log('\n========================================================================================');
if (allPassed) {
  console.log(`🎉 所检账本文件 100% 真实通过 Clean Ledger Gate v3.0 工业硬核门禁！`);
  process.exit(0);
} else {
  console.error(`❌ 全量质检未通过，累计发现 ${totalViolationsCount} 项真实违规，已阻止放行！`);
  process.exit(1);
}
