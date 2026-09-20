# REQ-049 战法本体无监督流形聚类与形式化验证方案（约束修订版）
# (Unsupervised Strategy Taxonomy Induction — Constrained Revision)

> **状态**：`accepted-revision`（Grok 交叉审阅通过 · Gemini 带约束采纳）  
> **关联**：`REQ-037`（多模态知识图谱）· `REQ-038`（战法归因）· `REQ-041`（四维共振雷达）  
> **真相源**：[`docs/project/03-requirements.md`](./03-requirements.md) · [`05-wip-board.md`](./05-wip-board.md) · [`07-review-inbox.md`](./07-review-inbox.md)  
> **核心原则**：探索 ≠ 生产认证；卡片 ≠ 入场信号；与 REQ-038 黄金战法**并行共存**，不推倒重来。

---

## 0. 修订演进对照（Grok 审阅落地）

| 维度 | 原始草案 | 修订落地版（本方案） |
|---|---|---|
| **聚类范围** | 4,156 张卡片混合聚类 | **按 `card_type` 物理分层**（至少 pattern 与 risk_rule 隔离），杜绝文风混淆 |
| **超参数设定** | `min_cluster_size=15` 锁死 | **5–8 起步扫描至 15**，输出多超参 Jaccard 稳定性报告；Noise 保留抽检 |
| **输入特征** | 纯文本语义拼接 | **文本向量 + 结构化离散特征**（标的族、时段桶、多空方向、是否有价位、vision 标签） |
| **LLM 归纳约束** | 直接输出正式战术定义与 DAG | **仅作为候选（proposed）**；**强制 `evidence_card_ids`，无证据则 null**，严禁伪造数值阈值 |
| **行情验证门禁** | $ge 60%$ 胜率二元晋级为黄金大类 | **类型化四态弱检验**（`supportive / inconclusive / contradictory / insufficient`），废除粗暴胜率门禁 |
| **生产关系** | 废弃旧体系与人工 7 大类 | **旧 7 类与 REQ-038 黄金卡 100% 保留**；049 全程作为只读实验候选，经人工验收方可另开 CHG |

---

## 一、 阶段一：分层无监督流形发现 (049-A)

### 1.1 分层输入构建
**禁止**将 `pattern` 与 `macro`、`asset_memory`、`risk_rule` 混进同一个聚类空间中跑。
优先对核心交易形态 `pattern`（2,265 张）独立建库；对 `risk_rule`（585 张）单独聚类分析保护逻辑。

针对每张卡片构建两部分特征：
1. **纯净文本内容**：`card_type | title | trigger_text | action_text | theory_text | vision_summary`；
2. **结构化离散特征**：
   - 标的族（TSLA族 / 科技巨头M7 / 中小盘 / 大盘指数）；
   - 时段桶（早盘 09:30-10:30 / 盘中 10:30-15:00 / 尾盘 15:00-16:00 / 盘前盘后夜盘）；
   - 意图方向（long / short / neutral / unknown）；
   - `has_price_level`（Boolean 标有具体点位）；
   - `vision_tags`（若由真图 OCR 提取）。

### 1.2 向量嵌入标准
- 统一固定模型与版本：使用 **Gemini text-embedding-004** 或本地 **BGE-M3**（单模型定死，严禁两套向量混跑比簇）；
- 缓存路径：`data/runtime/taxonomy_embeddings_{model}_{card_type}.npy`。

### 1.3 聚类与稳定性扫描
- **UMAP 作用定位**：用于流形空间可视化与辅助参考；正式主标签在高维空间进行密度拟合；
- **HDBSCAN 参数扫描**：
  - 扫描范围：`min_cluster_size ∈ {5, 8, 12, 15}`，联动扫描 `min_samples ∈ {3, 5}`；
  - 输出稳定性报告：各组参数下的有效簇数、Noise 比例、跨参数 Jaccard 一致性；
- **Noise (-1) 处理**：绝不丢弃，全部汇入 `unassigned` 候选池供人工抽检，**严禁**送给大模型强行编造名字。

### 1.4 阶段一交付物 (DoD)
- [ ] 分类型聚类快照 `data/runtime/unsupervised_clusters.json`
- [ ] 参数稳定性扫描报告（无人工预设单一超参偏见）
- [ ] 每簇核心几何中心点（Medoids）与边缘样本（Borderline Samples）ID 列表
- [ ] **不包含任何 LLM 输出的正式战术中文名称**（仅保留 `cluster_id`）

---

## 二、 阶段二：严格证据约束下的 LLM 形式化归纳 (049-B)

### 2.1 输入样本
- 每个发现的紧密簇：抽取 10 张核心中心样本（Medoids）+ 3~5 张边缘样本 + 关联的原始大V发言与消息 ID；
- 可选双模型（Gemini 1.5 Pro 与 本地 14B）交叉比对，仅重合的概念进入后续验证。

### 2.2 严格受限的 Schema 与校验器规则
大模型输出必须严格遵循以下格式，并通过后端校验器自动审查：
```json
{
  "cluster_id": 3,
  "status": "proposed",
  "proposed_label": "跳空缺口引力回踩确认战法",
  "market_regime": "开盘/盘中震荡",
  "trigger_preconditions": {
    "text": "出现未回补跳空缺口，现价向缺口边缘靠拢",
    "evidence_card_ids": ["ocard_123", "ocard_456"]
  },
  "execution_semantics": {
    "text": "挂单于缺口支撑位分批吸筹，不追高",
    "evidence_card_ids": ["ocard_123"]
  },
  "invalidation_criteria": {
    "text": "有效跌破缺口底边界且未迅速收回",
    "evidence_card_ids": ["ocard_789"]
  },
  "numeric_thresholds": [],
  "do_not_use_as_order": true
}
```

**硬核校验红线（Fail-Closed）**：
1. **证据链绑定**：任一结构化字段必须挂载 `evidence_card_ids`；若无出处，该字段必须为 `null`，严禁自由发挥编写散文；
2. **拒绝伪造数值**：`numeric_thresholds` 中的数值若未在证据卡片原文中明确出现，严禁写入，仅允许定性描述；
3. **资金安全隔离**：严禁输出任何可执行交易指令（如下单股数、实盘 Action）；
4. **状态锁死**：`status` 固定为 `proposed`，未经人工 Review 验收严禁入生产 SoR。

### 2.3 阶段二交付物 (DoD)
- [ ] 形式化候选定义库 `data/runtime/formal_strategy_taxonomy.proposed.json`
- [ ] 自动化校验器与证据链覆盖率报告
- [ ] 人工抽检 $ge 20$ 个核心簇群的核验记录

---

## 三、 阶段三：类型化历史行情弱检验，而非一刀切晋级 (049-C)

### 3.1 差异化指标设计（拒绝一刀切买入胜率）
| 簇类型 | 合理检验方法 | 严禁采用的指标 |
|---|---|---|
| **带点位的 pattern** | 事件研究法：消息产生后 $H$ 周期内触及目标位/失效位的频率、最大不利偏离 (MAE) | 严禁事后优选最佳卖点（严防前视偏差） |
| **risk_rule (风控)** | 保护效果检验：规则触发后若未执行止损/减仓，后续路径是否显著更差 | 严禁将防守口令当做多信号算买入胜率 |
| **macro (宏观)** | 宏观环境状态标注，统计该宏观状态下的波动率分布 | 严禁直接作为交易买卖信号计算胜率 |

### 3.2 回测与因果隔离规范
- **时点因果对齐**：事件触发时点严格锁定为原始消息 `created_at`（美东时间），行情数据绝对只取该时点之后；
- **微观分层采样**：针对开盘首小时与尾盘强平，结合富途 OpenD 分钟级 K 线验证；日间常规战法以日 K 极值与 MAE 为基准；
- **披露多重检验风险**：对参与测试的所有簇进行 Bonferroni 修正或 FDR（False Discovery Rate）披露，防止白噪声伪战法。

### 3.3 四态结论标签（替代二元晋级）
回测输出绝不使用“正式黄金晋级”或“强制淘汰”，而是输出科学的四态标签：
- 🟢 **`supportive`**：在样本外区间方向与效应依然显著一致，且有效样本 $n ge 20$；
- 🟡 **`inconclusive`**：统计效应微弱，在不同时间切片下表现不稳定；
- 🔴 **`contradictory`**：实际市场走势与卡片逻辑方向显著相反；
- ⚪ **`insufficient`**：样本数过小（$n < 15$）或缺少可交易数值点位。

### 3.4 阶段三交付物 (DoD)
- [ ] 历史行情弱检验账本 `data/runtime/taxonomy_backtest_report.json`
- [ ] 与现有 REQ-038 黄金战法（108张）的对照表（避免数据自相矛盾）
- [ ] 严禁自动写入生产雷达与 HUD 生产真源

---

## 四、 阶段四：人工评审与生产受控引入 (049-D)

1. **并行共存原则**：
   - 现存的 108 张黄金战法（`golden_playbook.json`）依然是四维共振雷达与生产驾驶舱（`/hud`）的唯一加权真源；
   - 049 产出的新标签树作为独立候选层在后台展示，不干扰现有预警；
2. **受控晋级审批**：
   - 仅当人类交易员人工 Review 并明确 Accept 某一子集后，方可另立变更（CHG），将经过双重验证的战术标签引入雷达只读加权。

---

## 五、 四阶段实施路线图

```
[049-A: 分层聚类与稳定性] ──(DoD 验收)──► [049-B: 约束 LLM 形式化]
                                                   │
                                              (DoD 验收)
                                                   ▼
[049-D: 人工 Review 与独立 CHG] ◄──(DoD 验收)─── [049-C: 类型化弱检验回测]
```

**铁律**：每一阶段完成后必须输出完整产物并由 Human 确认，严禁跨阶段自治大跃进。
