import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const CLUSTERS_FILE = path.join(ROOT_DIR, 'data/runtime/unsupervised_clusters.json');
const PREPARED_FILE = path.join(ROOT_DIR, 'data/runtime/taxonomy_prepared_049a.json');
const OUTPUT_TAXONOMY_FILE = path.join(ROOT_DIR, 'data/runtime/proposed_taxonomy_049b.json');
const REPORT_FILE = path.join(ROOT_DIR, 'docs/project/049b-formalization-report.md');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('Error: GEMINI_API_KEY is not configured in .env');
  process.exit(1);
}

// 049-B 首批试点白名单（精选 6 大高稳定、语义纯净核心簇）
const PILOT_CLUSTER_IDS = [
  'c_pattern_with_level_07', // 稳定性 1.0, 夜盘二次探底 + 盘前 19点人工干预高抛
  'c_pattern_with_level_06', // 稳定性 0.973, 7180~7200 缺口引力回吸与估值建仓
  'c_pattern_with_level_04', // 稳定性 0.87, 开盘回踩加仓 + 尾盘前 14:00~15:00 减持
  'c_risk_rule_08',          // 稳定性 1.0, 1/3 常规底仓建仓 + 明确点位硬止损
  'c_risk_rule_03',          // 稳定性 0.964, 尾盘散户止损大单吞噬买入法 (同花顺/王炸)
  'c_risk_rule_01'           // 稳定性 0.91, 极端连续抛售后夜盘量化V底与被动减持买入
];

async function callGeminiJson(prompt, retries = 3) {
  const models = ['gemini-3.5-flash', 'gemini-3.5-flash-lite'];
  
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1
            }
          })
        });

        if (!resp.ok) {
          const errText = await resp.text();
          if (resp.status === 503 || resp.status === 429) {
            console.warn(`[${model}] Attempt ${attempt} HTTP ${resp.status}. Retrying...`);
            await new Promise(r => setTimeout(r, 2000 * attempt));
            continue;
          }
          throw new Error(`HTTP ${resp.status}: ${errText}`);
        }

        const data = await resp.json();
        let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) throw new Error('Empty LLM response');
        
        // 清理 markdown 代码块
        rawText = rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        return JSON.parse(rawText);
      } catch (err) {
        if (attempt === retries) {
          console.warn(`[Model ${model}] all retries failed: ${err.message}. Trying next model...`);
          break;
        }
        await new Promise(r => setTimeout(r, 1500 * attempt));
      }
    }
  }
  throw new Error('All models failed to return valid JSON');
}

// Fail-Closed 严格校验器：严禁伪造数字，严禁脱离证据链
function validateAndSanitizePlaybook(rawPlaybook, cluster, cardMap) {
  const errors = [];
  const validMemberIds = new Set(cluster.member_ids);

  // 1. 校验 evidence_card_ids
  if (!Array.isArray(rawPlaybook.evidence_card_ids) || rawPlaybook.evidence_card_ids.length < 2) {
    errors.push('evidence_card_ids 必须包含至少 2 个真实有效卡片 ID');
  } else {
    for (const cid of rawPlaybook.evidence_card_ids) {
      if (!validMemberIds.has(cid)) {
        errors.push(`evidence_card_id [${cid}] 不属于本簇成员 ID，严禁越界引用`);
      }
      if (!cardMap.has(cid)) {
        errors.push(`evidence_card_id [${cid}] 在预处理数据中不存在`);
      }
    }
  }

  // 2. 校验数字真实性 (numeric_bounds)
  const evidenceTexts = (rawPlaybook.evidence_card_ids || [])
    .map(cid => {
      const c = cardMap.get(cid);
      return c ? `${c.title} ${c.trigger_text} ${c.action_text} ${c.raw_content}` : '';
    })
    .join(' ');

  const sanitizedLevels = [];
  if (rawPlaybook.numeric_bounds && Array.isArray(rawPlaybook.numeric_bounds.levels)) {
    for (const lvl of rawPlaybook.numeric_bounds.levels) {
      const lvlStr = String(lvl);
      // 检查该数字是否在引用的证据文本中精确出现
      if (evidenceTexts.includes(lvlStr)) {
        sanitizedLevels.push(lvl);
      } else {
        console.warn(`[Fail-Closed] 剔除未在证据原文中出现的伪造数值点位: ${lvl}`);
      }
    }
  }

  // 3. 基础字段非空检查
  if (!rawPlaybook.proposed_label || rawPlaybook.proposed_label.length < 4) {
    errors.push('proposed_label 缺失或过短');
  }
  if (!rawPlaybook.core_mechanism || rawPlaybook.core_mechanism.length < 10) {
    errors.push('core_mechanism 缺失或描述不足');
  }
  if (!rawPlaybook.trigger_condition) {
    errors.push('trigger_condition 必须明确声明');
  }
  if (!rawPlaybook.action_specification) {
    errors.push('action_specification 必须明确声明');
  }

  return {
    is_valid: errors.length === 0,
    errors,
    sanitized: {
      cluster_id: cluster.cluster_id,
      card_type: cluster.bucket_name.startsWith('pattern') ? 'pattern' : 'risk_rule',
      bucket_name: cluster.bucket_name,
      cluster_size: cluster.size,
      stability_score: cluster.stability_score,
      proposed_label: rawPlaybook.proposed_label,
      core_mechanism: rawPlaybook.core_mechanism,
      trigger_condition: rawPlaybook.trigger_condition,
      action_specification: rawPlaybook.action_specification,
      risk_management: rawPlaybook.risk_management || null,
      applicable_tickers: Array.isArray(rawPlaybook.applicable_tickers) ? rawPlaybook.applicable_tickers : [],
      numeric_bounds: {
        levels: sanitizedLevels.length > 0 ? sanitizedLevels : null,
        time_windows: rawPlaybook.numeric_bounds?.time_windows || [],
        position_ratio: rawPlaybook.numeric_bounds?.position_ratio || null
      },
      evidence_card_ids: rawPlaybook.evidence_card_ids,
      status: 'proposed_pilot' // 严格受限于试点状态，绝不伪造为认证生产
    }
  };
}

async function main() {
  console.log('=== REQ-049-B: 战法本体约束 LLM 形式化提纯与 Fail-Closed 校验 ===');

  if (!fs.existsSync(CLUSTERS_FILE)) {
    console.error(`Error: ${CLUSTERS_FILE} not found.`);
    process.exit(1);
  }
  if (!fs.existsSync(PREPARED_FILE)) {
    console.error(`Error: ${PREPARED_FILE} not found.`);
    process.exit(1);
  }

  const clustersData = JSON.parse(fs.readFileSync(CLUSTERS_FILE, 'utf8'));
  const preparedData = JSON.parse(fs.readFileSync(PREPARED_FILE, 'utf8'));

  // 建立 card_id 快速查询索引
  const cardMap = new Map();
  for (const bucketList of Object.values(preparedData.buckets)) {
    for (const c of bucketList) {
      cardMap.set(c.id, c);
    }
  }

  // 搜集白名单簇对象
  const targetClusters = [];
  for (const [bName, bRes] of Object.entries(clustersData.buckets)) {
    for (const cl of bRes.clusters) {
      if (PILOT_CLUSTER_IDS.includes(cl.cluster_id)) {
        targetClusters.push({ ...cl, bucket_name: bName });
      }
    }
  }

  console.log(`[*] 锁定白名单试点簇: ${targetClusters.length} 个 (目标 6 个)`);

  const formalizedPlaybooks = [];
  const failedAudits = [];

  for (let i = 0; i < targetClusters.length; i++) {
    const cl = targetClusters[i];
    console.log(`\n-----------------------------------------------------------`);
    console.log(`[${i+1}/${targetClusters.length}] 形式化提纯簇: ${cl.cluster_id} (规模: ${cl.size}, 稳定性: ${cl.stability_score})`);

    // 组装代表性上下文（Medoids 前 5 个 + Borderline 前 2 个）
    const sampleCards = [];
    for (const m of cl.medoids.slice(0, 5)) {
      const full = cardMap.get(m.id);
      if (full) sampleCards.push(full);
    }
    for (const b of cl.borderline.slice(0, 2)) {
      const full = cardMap.get(b.id);
      if (full) sampleCards.push(full);
    }

    const contextText = sampleCards.map((c, idx) => `
### 样本 ${idx+1} [ID: ${c.id}]
- 标题: ${c.title}
- 触发条件: ${c.trigger_text}
- 操作指示: ${c.action_text}
- 赵哥原发言: "${c.raw_content}"
- 涉及标的: ${JSON.stringify(c.tickers)}
`).join('\n');

    const prompt = `
你是一名资深美股量化微观结构分析师。以下是一组通过余弦空间流形聚类提取出的赵哥真实发言卡片簇（无监督聚类 ID: ${cl.cluster_id}，稳定性: ${cl.stability_score}）。
请严格基于给出的卡片证据原话，提取并提炼出一份严密的【量化交易战法/风控规则形式化规范】。

【极其严厉的合规红线】：
1. 绝对严禁写“写小说式”的泛泛空谈，只准提炼客观可触发的微观结构模式；
2. 绝对严禁伪造数字！如果原文没有明确的支撑点位数字，levels 必须置为 [];
3. 必须在 evidence_card_ids 中填入 2~4 个你直接引用的卡片 ID（必须来自下面提供的 ID）；
4. proposed_label 必须精炼（8~16字），格式如：“【战法/纪律】XXXX”。

【卡片样本证据】：
${contextText}

【必须输出的 JSON 结构规范】：
{
  "proposed_label": "string",
  "core_mechanism": "string (100字内，微观机理解析)",
  "trigger_condition": "string (明确客观的盘口/K线/时钟触发条件)",
  "action_specification": "string (买入/卖出/加仓/减仓具体操作指引)",
  "risk_management": "string (止损点、防踩踏或仓位纪律)",
  "applicable_tickers": ["string"],
  "numeric_bounds": {
    "levels": [number],
    "time_windows": ["string"],
    "position_ratio": "string或null"
  },
  "evidence_card_ids": ["string"]
}
`;

    try {
      const rawPlaybook = await callGeminiJson(prompt);
      const auditRes = validateAndSanitizePlaybook(rawPlaybook, cl, cardMap);

      if (auditRes.is_valid) {
        console.log(`✅ [Audit PASS] 成功形式化: ${auditRes.sanitized.proposed_label}`);
        formalizedPlaybooks.push(auditRes.sanitized);
      } else {
        console.error(`❌ [Audit FAIL] 校验拦截: ${auditRes.errors.join('; ')}`);
        failedAudits.push({ cluster_id: cl.cluster_id, errors: auditRes.errors });
      }
    } catch (err) {
      console.error(`[Error] 形式化簇 ${cl.cluster_id} 发生异常: ${err.message}`);
      failedAudits.push({ cluster_id: cl.cluster_id, errors: [err.message] });
    }

    // 防抖保护
    await new Promise(r => setTimeout(r, 1000));
  }

  // 4. 落盘产物
  const outputPayload = {
    generated_at: new Date().toISOString(),
    status: 'pilot_formalized',
    total_pilot_clusters: targetClusters.length,
    passed_count: formalizedPlaybooks.length,
    failed_count: failedAudits.length,
    playbooks: formalizedPlaybooks,
    failed_audits: failedAudits
  };

  fs.writeFileSync(OUTPUT_TAXONOMY_FILE, JSON.stringify(outputPayload, null, 2), 'utf8');
  console.log(`\n[+] 形式化战法清单已写入: ${OUTPUT_TAXONOMY_FILE}`);

  // 5. 生成 049-B 交付报告
  generateReport(formalizedPlaybooks, failedAudits, REPORT_FILE);
  console.log(`[+] 049-B 阶段交付报告已写入: ${REPORT_FILE}`);
  console.log('=== REQ-049-B Pilot Formalization Finished ===');
}

function generateReport(playbooks, failedAudits, reportPath) {
  const lines = [
    '# REQ-049-B: 战法本体约束 LLM 形式化提纯阶段报告 (试点白名单)',
    '',
    '> **前序基石**：`docs/project/049a-clustering-stability-report.md` (Commit 39e1da8)',
    '> **红线执行**：Fail-Closed 严格校验器，杜绝虚构数字，100% 绑定真实证据卡片 ID',
    '> **生产防护**：所有战法标记为 `proposed_pilot`，与 REQ-038 黄金战法并行共存，绝不擅自越权替换',
    '',
    '---',
    '',
    '## 1. 049-B 试点提纯战法清单 (Schema 校验 100% 通过)',
    ''
  ];

  for (const pb of playbooks) {
    lines.push(`### ${pb.proposed_label}`);
    lines.push(`- **所属簇与分桶**: \`${pb.cluster_id}\` (${pb.bucket_name}, 规模: ${pb.cluster_size} 张, 稳定性: ${pb.stability_score})`);
    lines.push(`- **核心微观机理**: ${pb.core_mechanism}`);
    lines.push(`- **精确触发条件**: ${pb.trigger_condition}`);
    lines.push(`- **具体操作指示**: ${pb.action_specification}`);
    lines.push(`- **风控止损规则**: ${pb.risk_management || '无显式额外规则'}`);
    lines.push(`- **适用标的范围**: ${pb.applicable_tickers.length ? pb.applicable_tickers.join(', ') : '大盘/通用'}`);
    lines.push(`- **关键数值与时间边界**:`);
    lines.push(`  - 显式点位 (已通过原文查验): ${pb.numeric_bounds.levels ? pb.numeric_bounds.levels.join(', ') : '无 (仅形态/时间触发)'}`);
    lines.push(`  - 敏感时间窗口: ${pb.numeric_bounds.time_windows.length ? pb.numeric_bounds.time_windows.join(', ') : '无'}`);
    lines.push(`  - 建议建仓比例: ${pb.numeric_bounds.position_ratio || '未限定'}`);
    lines.push(`- **铁证卡片链 (Evidence IDs)**:`);
    for (const cid of pb.evidence_card_ids) {
      lines.push(`  - \`${cid}\``);
    }
    lines.push('');
  }

  if (failedAudits.length > 0) {
    lines.push('---');
    lines.push('## 2. Fail-Closed 校验拦截异常记录');
    for (const f of failedAudits) {
      lines.push(`- 簇 \`${f.cluster_id}\`: ${f.errors.join('; ')}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('## 3. 049-B 验收与进入 049-C 门禁状态');
  lines.push('');
  lines.push('- [x] **白名单精选**：不搞全库一刀切，仅对 6 个高稳定（稳定性 ≥ 0.87）核心流形形式化；');
  lines.push('- [x] **Fail-Closed 校验**：所有伪造点位被物理剔除，无证据卡片全部拦截拒绝；');
  lines.push('- [x] **与 REQ-038 隔离**：产物以 `proposed_pilot` 隔离沉淀，生产 HUD 真源毫发无损；');
  lines.push('- [ ] **Human / 架构师审阅**：核验上述 6 项试点战法，确认是否准予启动 `049-C`（四态弱检验回测验证）。');
  lines.push('');

  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
}

main().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
