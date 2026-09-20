# REQ-049 战法本体无监督流形聚类、大模型形式化归纳与量化回测验证方案
# (Unsupervised Strategy Taxonomy Induction & Empirical Backtest Validation Plan)

> **状态**：`proposed`（待 Human & 外部 AI 交叉审阅）  
> **关联**：`REQ-037`（多模态知识图谱）· `REQ-038`（战法归因）· `REQ-041`（四维共振雷达）  
> **真相源**：[`docs/project/03-requirements.md`](./03-requirements.md) · [`05-wip-board.md`](./05-wip-board.md)  
> **核心目标**：彻底废弃早期人工经验拍脑袋定义的静态“7大战法体系”，采用顶级量化机构与学术界前沿的「无监督聚类 + 大模型本体归纳 + 真实市场因果回测」三阶科学范式，自下而上发现客观、完备、具备真实统计显著性的实战战术体系。

---

## 一、 背景与核心问题（Why We Need This）

### 1.1 现状与痛点
1. **早期分类的主观偏见（Heuristic Bias）**：
   系统早期在仅有少量数据时，人工定义了 7 个静态标签：*【财报战法】、【节日被动减】、【单调减】、【尾盘强平】、【做T】、【弹性股防御】、【规律总结】*。
2. **底层数据资产庞大却未被充分表达**：
   底层通过 3,154 组会话切窗单元（CU）与 432 张大V多模态真图，已经提炼出 **4,156 张本体卡片**（含 2,265 张 pattern、585 张 risk_rule、595 张 macro、595 张 asset_memory），以及 **2,321 笔历史交易审核单**。
   真实数据中高频出现的「开盘单边下跌防接飞刀」、「跳空缺口反转引力」、「均线回踩三三制建仓」等核心模式，在旧的 7 大分类中完全没有对应的严谨位置。
3. **缺乏统计显著性验证**：
   分类如果仅凭语言学描述，而未经真实市场历史行情的收益分布检验，容易把“大V的情绪化口癖”当作“量化战法”。

---

## 二、 三阶科学范式架构（Methodology）

本项目借鉴 Stanford NLP 知识抽取与顶级量化机构（Two Sigma / Citadel）Alpha 因子发现规范，制定三阶段流水线：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 阶段一：纯数学无监督流形发现 (Unsupervised Manifold & Cluster Discovery)    │
│  4,156 张卡片元数据 ───► High-Dimensional Dense Embeddings (向量化)          │
│                       ───► UMAP 非线性流形降维 (保留全局与局部拓扑)         │
│                       ───► HDBSCAN 层次密度聚类 (无预设 K 值，自动发现自然族群)│
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ (输出 N 个纯数学凝聚的自然聚类簇)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 阶段二：前沿大模型形式化归纳 (Formal LLM Inductive Taxonomy Synthesis)      │
│  每个自然簇群的 Exemplars/Medoids ───► Gemini 1.5 Pro / 本地 14B 深度推理    │
│  ↳ 提示词严格约束量化金融本体标准：                                         │
│     • 提取【显式时空触发条件 (Pre-conditions)】                              │
│     • 抽象【操作语义范式 (Action Semantics)】                               │
│     • 提炼【因果逻辑与反脆弱失效准则 (Invalidation Criteria)】               │
│  ↳ 自动演化生成层次本体树 (Hierarchical Taxonomy DAG)                        │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ (输出形式化战法候选族群)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 阶段三：真实美股历史行情因果验证 (Empirical Market Backtest & Gating)       │
│  Yahoo / 券商历史真实 K 线 ───► 对每个战术簇群进行真实交易回放检验           │
│  ↳ 统计指标：3D/5D 胜率 (Hit Rate)、盈亏比 (Profit Factor)、最大不利偏离 (MAE)│
│  ↳ 门禁过滤：                                                               │
│     • 胜率方差极大、接近 50% 随机游走的簇 ──► 标记为【情绪噪点/伪战法】剔除  │
│     • 胜率显著 > 60% 且具备统计显著性的簇 ──► 晋级为【正式实战黄金战法大类】 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 三、 各阶段详细实施规程

### 3.1 阶段一：高维语义表征与无监督流形聚类（Unsupervised Clustering）

1. **输入特征拼接**：
   针对每张卡片 C_i ∈ ontology_card，构建结构化复合文本：
   Doc_i = [Type: card_type] + [Title: title] + [Trigger: trigger_text] + [Action: action_text] + [Theory: theory_text] + [Vision: patterns/levels]
2. **Dense Embeddings 生成**：
   - 采用标准稠密向量模型（Gemini text-embedding-004 或本地 BGE-M3），生成 768 / 1536 维的高精度向量；
   - 沉淀至本地矩阵缓存 data/runtime/ontology_embeddings.npy。
3. **UMAP 降维（保留全局流形与局部近邻）**：
   - 参数配置：n_neighbors=15, min_dist=0.05, metric='cosine', n_components=10；
4. **HDBSCAN 层次密度聚类（严禁人工指定 K 值）**：
   - 参数配置：min_cluster_size=15, min_samples=5；
   - **自动孤立噪点**：离散度过高的无效吹水卡片自动标记为 cluster_id = -1（Noise），不参与后续战术命名。

### 3.2 阶段二：前沿大模型归纳与形式化本体树合成（LLM Taxonomy Induction）

1. **簇群代表样本抽取（Exemplars Extraction）**：
   - 计算每个簇的高维几何中心（Centroid / Medoid），按余弦相似度选取距离中心最近的 10~15 张典型核心卡片；
2. **调用 Gemini 1.5 Pro / 本地 14B 执行金融量化形式化归纳**：
   - 输入：该簇的 15 张代表性卡片与对应的大V原句上下文；
   - **严格的系统 Prompt 约束**，输出标准化 JSON Schema：
     ```json
     {
       "cluster_id": 3,
       "tactical_concept_name": "跳空缺口引力回踩确认战法",
       "market_regime": "震荡或趋势初期 (Pre/Open Market)",
       "trigger_preconditions": {
         "price_structure": "出现未回补跳空缺口，现价向缺口边缘靠拢",
         "volume_orderflow": "回踩缩量，未见大单主动砸盘"
       },
       "execution_action": "克制盘中追高冲动，挂单于缺口下沿支撑分批吸筹",
       "risk_invalidation_rule": "有效跌破缺口底边界 1.5% 且 30 分钟未收回，判定战法失效，无条件离场",
       "causal_mechanism": "缺口区域筹码真空引发技术性回补与共识买盘对冲"
     }
     ```
3. **拓扑分层（Hierarchical Agglomeration）**：
   - 计算各簇群中心之间的 Wasserstein 距离或余弦距离；
   - 自动向上合并为大类（Macro Regime / Structural Pattern / Capital Allocation），向下细化为具体子模式，构建 **Taxonomy DAG**。

### 3.3 阶段三：真实美股历史行情实证回测与门禁过滤（Empirical Backtest & Gate）

**检验真理的唯一标准是市场的真实历史走势。**

1. **回测数据集接入**：
   - 提取每个战法簇中涉及的股票代码与发生时间戳（从 2025-10-06 至今）；
   - 结合已落地的 card_attribution.js 引擎，拉取对应的日K与分K行情；
2. **多维量化回测统计指标**：
   - **Hit Rate (3D/5D)**：T+3 与 T+5 交易日内，价格朝战法预期方向运行达到预定阈值（如 +3% ~ +5%）且未触及止损线的胜率；
   - **Profit Factor（盈亏比）**：Total Gains / Total Losses；
   - **MAE（Maximum Adverse Excursion，最大不利偏离）**：入场后的最大浮亏深度；
   - **簇内方差（Intra-cluster Variance）**：检验同一簇内各个样本胜率的一致性。
3. **门禁剔除与晋级规则**：
   - ❌ **伪战法剔除**：若某簇的胜率在 48% ~ 52% 之间游弋，且盈亏比 < 1.1，说明纯属巧合与无规律市场噪音，强制剔除；
   - ⚠️ **观察降级**：样本数少于 10 例或胜率在 53% ~ 59% 之间的簇，标记为「观察待验证」；
   - ✅ **黄金战术晋级**：胜率 >= 60%、盈亏比 >= 1.8 且具备显著正向偏度的簇群，正式晋级为系统**核心战法分类**。

---

## 四、 交付产物与工程落地清单

| 产物 | 路径 | 说明 |
|---|---|---|
| **向量表征矩阵** | `data/runtime/taxonomy_embeddings.npy` | 4,156 张卡片的稠密向量缓存 |
| **聚类结果与指标** | `data/runtime/unsupervised_clusters.json` | UMAP+HDBSCAN 自然簇群分布与代表样本 |
| **形式化战法本体树** | `data/runtime/formal_strategy_taxonomy.json` | 大模型归纳生成的层次战术树结构 |
| **实战回测统计报告** | `data/runtime/taxonomy_backtest_report.json` | 各战法大类的胜率、盈亏比、回撤统计账本 |
| **聚类与归纳流水线脚本** | `scripts/knowledge/run_taxonomy_discovery.py` / `.js` | 自动化端到端可复现聚类脚本 |
| **Web 驾驶舱适配更新** | `public/radar_hud.html` / `app.js` | 废弃旧 7 大硬编码标签，接入全新战法树 |

---

## 五、 外部 AI 与专家审阅焦点（Review Questions for External AI）

请重点审查以下环节并提出改进建议：
1. **Embedding 选择与特征权重**：在向量化时，纯文本语义（trigger/theory）与具体数值点位（support/resistance）的权重配比是否合理？
2. **聚类超参数偏见**：HDBSCAN 的 min_cluster_size 设在 15~20 是否会导致长尾稀缺高胜率战法被误判为 Noise 噪点？
3. **大模型归纳提示词鲁棒性**：如何避免大模型在归纳战术定义时出现“过度泛化”（Hallucinatory Generalization）？
4. **回测因果偏差（Lookahead Bias & Survival Bias）**：回测时如何确保绝对隔离未来信息，并对未被大V明确止损的单子做保守性结算？
