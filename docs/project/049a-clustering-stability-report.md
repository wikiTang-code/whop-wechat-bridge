# REQ-049-A: 分层流形聚类与稳定性扫描验收报告

> **执行依据**：`docs/project/unsupervised-taxonomy-induction-plan.md` (Commit 9d99723)
> **向量基准**：`gemini-embedding-001` (3072 维)
> **分桶原则**：严格执行身份红线 9（纯赵哥本人）与物理分桶（分型与有点位/无点位硬隔离）
> **Grok 049-A 验收审阅**：见 `docs/project/07-review-inbox.md` §「REQ-049-A 阶段交付验收（Grok）」
> **外部审阅结论**：**Accepted（带条件）**——可签收 049-A Done；049-B 仅对「抽检未标 mixed 的稳定簇」启动

> [!WARNING]
> **`partial_embedding = true`**：本报告聚类基于部分向量子集（首批 975 张，赵哥有效卡池总量 1,746+）。结论仅对已嵌入子集成立。全量嵌入完成后需重跑 `run_clustering_049a.py` 更新本报告，方可作为 049-B 的完整基础。

> [!NOTE]
> **稳定性定义（可复现）**：
> - 基准参数：`cs=8, s=3`（网格中位值）
> - 对比组：其余 7 个参数组合
> - 对齐方法：贪心最大重叠（Greedy max-overlap，每簇选与基准簇 Jaccard 最高的对应簇）
> - 稳定性阈值：**Jaccard ≥ 0.65**（平均值，取所有对比组的最大 Jaccard 均值）
> - 随机种子：`UMAP random_state=42`，HDBSCAN 确定性（无随机种子依赖）
> - 复现命令：`wsl bash -c "cd /mnt/c/Users/86597/.gemini/antigravity/scratch/whop-wechat-bridge && python3 scripts/knowledge/run_clustering_049a.py"`

---

## 1. 物理分桶聚类总览

| 分桶名 | 样本总数 | 稳定簇数 (Stability ≥ 0.65) | 边缘簇数 | 噪声样本数 | 噪声占比 | 状态 |
|---|---|---|---|---|---|---|
| `pattern_no_level` | 674 | 11 | 13 | 48 | 7.1% | `clustered` |
| `pattern_with_level` | 61 | 2 | 1 | 0 | 0.0% | `clustered` |
| `risk_rule` | 240 | 4 | 3 | 8 | 3.3% | `clustered` |

---

## 2. 各分桶超参数稳定性网格

### 分桶: `pattern_no_level`
| 参数 (min_cluster_size, min_samples) | 发现簇数 | 噪声数 | 噪声比例 | 簇规模分布 |
|---|---|---|---|---|
| `cs=5, s=3` | 37 | 34 | 5.0% | [13, 9, 10, 14, 10, 8]... |
| `cs=5, s=5` | 32 | 51 | 7.6% | [13, 9, 10, 14, 10, 8]... |
| `cs=8, s=3` | 24 | 48 | 7.1% | [13, 9, 10, 14, 10, 8]... |
| `cs=8, s=5` | 24 | 62 | 9.2% | [13, 9, 10, 14, 10, 8]... |
| `cs=12, s=3` | 11 | 83 | 12.3% | [22, 14, 78, 53, 14, 45]... |
| `cs=12, s=5` | 9 | 38 | 5.6% | [22, 14, 78, 53, 14, 45]... |
| `cs=15, s=3` | 9 | 111 | 16.5% | [22, 78, 53, 45, 140, 19]... |
| `cs=15, s=5` | 7 | 66 | 9.8% | [22, 78, 53, 45, 140, 19]... |

### 分桶: `pattern_with_level`
| 参数 (min_cluster_size, min_samples) | 发现簇数 | 噪声数 | 噪声比例 | 簇规模分布 |
|---|---|---|---|---|
| `cs=5, s=3` | 3 | 0 | 0.0% | [18, 11, 32] |
| `cs=5, s=5` | 3 | 0 | 0.0% | [18, 11, 32] |
| `cs=8, s=3` | 3 | 0 | 0.0% | [18, 11, 32] |
| `cs=8, s=5` | 3 | 0 | 0.0% | [18, 11, 32] |
| `cs=12, s=3` | 2 | 0 | 0.0% | [18, 43] |
| `cs=12, s=5` | 2 | 0 | 0.0% | [43, 18] |
| `cs=15, s=3` | 2 | 0 | 0.0% | [18, 43] |
| `cs=15, s=5` | 2 | 0 | 0.0% | [43, 18] |

### 分桶: `risk_rule`
| 参数 (min_cluster_size, min_samples) | 发现簇数 | 噪声数 | 噪声比例 | 簇规模分布 |
|---|---|---|---|---|
| `cs=5, s=3` | 18 | 51 | 21.2% | [10, 9, 12, 26, 5, 5]... |
| `cs=5, s=5` | 7 | 8 | 3.3% | [10, 9, 10, 26, 12, 15]... |
| `cs=8, s=3` | 7 | 8 | 3.3% | [10, 9, 12, 26, 10, 15]... |
| `cs=8, s=5` | 7 | 8 | 3.3% | [10, 9, 10, 26, 12, 15]... |
| `cs=12, s=3` | 4 | 27 | 11.2% | [36, 12, 15, 150] |
| `cs=12, s=5` | 4 | 27 | 11.2% | [36, 12, 15, 150] |
| `cs=15, s=3` | 3 | 39 | 16.2% | [36, 15, 150] |
| `cs=15, s=5` | 3 | 39 | 16.2% | [36, 15, 150] |

---

## 3. 核心稳定簇代表性样本（Medoids & Borderline 抽检）

> **科学红线**：禁止在此时由 LLM 强命名。以下簇名称仅为无监督代号，样本为几何中心与边界卡片的原话摘录。

### 分桶: `pattern_no_level` 簇详情
#### 簇 `c_pattern_no_level_01` (规模: 140 张, 稳定性: 0.933)
- **主要涉及标的**: QQQ, NVDL, MU, NVDA
- **几何中心代表样本 (Medoids)**:
  - `[ocard_distill_pat_post_1CbEEbsE4T8WwbqjYDABZu]` **波段战法与量价形态应对卡**: "一方面每天等 开盘那个回踩看 跌的深度"
  - `[ocard_distill_pat_post_1CeRhTTgV8doK8N9HoMKvv]` **波段战法与量价形态应对卡**: "因为这种很容易 开盘都会回踩"
- **边缘过渡样本 (Borderline)**:
  - `[card_mm_vmeta_post_1CaoWeqwTUJYhmk78pvVxe_0]` **[多模态] 大盘/观察 高点回落/均线压制**: "[IMAGE:https://img-v2-prod.whop.com/0W3Zua75yekLTOBnN8VWklLtykZ0Q51caXjVsb5M3Mk/plain/https%3A%2F%2Fassets-2-prod-privat"

#### 簇 `c_pattern_no_level_03` (规模: 135 张, 稳定性: 0.749)
- **主要涉及标的**: COIN, MU
- **几何中心代表样本 (Medoids)**:
  - `[ocard_distill_pat_post_1CbV9LPWt3pftftLzQCVQm]` **波段战法与量价形态应对卡**: "等后面跌缺口附近在考虑"
  - `[ocard_distill_pat_post_1CcS2dtA3bYpcBjTYRtNa6]` **波段战法与量价形态应对卡**: "最好补下方缺口时候加多点"
- **边缘过渡样本 (Borderline)**:
  - `[ocard_distill_pat_post_1CZtJBJtLBFwZL8EnmuZm4]` **波段战法与量价形态应对卡**: "31.25出 剩下一半25的amzu 也是到了上次的阻力位附近  补缺口后再看回买"

#### 簇 `c_pattern_no_level_02` (规模: 70 张, 稳定性: 0.941)
- **主要涉及标的**: BTC
- **几何中心代表样本 (Medoids)**:
  - `[ocard_distill_pat_post_1CbEDJeUQMvYwpQzYyYw8N]` **波段战法与量价形态应对卡**: "没到也会 做T降本那样做点的"
  - `[ocard_distill_pat_post_1CeG6AsacrRbxdfYdWa1XS]` **波段战法与量价形态应对卡**: "都是要日内做T有部分减了加"
- **边缘过渡样本 (Borderline)**:
  - `[ocard_distill_pat_post_1Cegxq83MrvqNnmhnnDNxA]` **波段战法与量价形态应对卡**: "如果在美国做美股

当天美剧 广告和综艺都暂停了在插播贝森特讲话

自己在随便出去走走看看 餐厅或者围在一圈的在讨论什么 

都在讨论要加仓 马上过节了一天左右恢复 

没必要紧张 直接回踩加仓"

#### 簇 `c_pattern_no_level_04` (规模: 45 张, 稳定性: 1.0)
- **主要涉及标的**: BTC, INTC, MU
- **几何中心代表样本 (Medoids)**:
  - `[ocard_distill_pat_post_1CbV8oqpF6UnJDxpNjadaT]` **波段战法与量价形态应对卡**: "突破了规律得重新积累"
  - `[ocard_distill_pat_post_1CdzwFbGoWiPXUNkRWRxEL]` **波段战法与量价形态应对卡**: "后面A股港股减持的回流加之前的他测试好才会去突破"
- **边缘过渡样本 (Borderline)**:
  - `[ocard_distill_pat_post_1CZpzn2uA2FNQbyaSjjKTV]` **波段战法与量价形态应对卡**: "主要还是发言后 开put的多 但是量化上下扫 收割了下 强平结算还是到了6610这个阻力位  剩下到夜盘时候看看最后期限怎么样



主要夜盘看韩国和a股的走势"

#### 簇 `c_pattern_no_level_09` (规模: 29 张, 稳定性: 0.747)
- **主要涉及标的**: MU, NVDA, SPCX, PCE
- **几何中心代表样本 (Medoids)**:
  - `[ocard_distill_pat_post_1CcJLNPSnMTt3c5pubxicc]` **波段战法与量价形态应对卡**: "指数7200补缺口前都是分散配置"
  - `[ocard_distill_pat_post_1Cbqw8JuvcdmhG4Wf7ocP2]` **波段战法与量价形态应对卡**: "月底和7200缺口补了才有"
- **边缘过渡样本 (Borderline)**:
  - `[ocard_distill_pat_post_1CaWLLCerhFiYpeeazf2DL]` **波段战法与量价形态应对卡**: "美联储这2天有议息会议

明天盘后有些像微软这样大盘股的财报

大陆这三天夜盘和盘前会被动减持



每天会回踩进些不同板块个股的低点 分开三天

币市场也是对利率敏感 这次也是维持利率不动 一般也要利率决议后再有方向出来





主要还"

### 分桶: `pattern_with_level` 簇详情
#### 簇 `c_pattern_with_level_01` (规模: 32 张, 稳定性: 0.854)
- **主要涉及标的**: QQQ, SPY, INTC, TSLL, LITE
- **几何中心代表样本 (Medoids)**:
  - `[ocard_distill_pat_post_1CbgectpNnZ4yA2HYFVrXh]` **波段战法与量价形态应对卡**: "之前是开盘回踩 10点半 卖一半 11点半卖一半"
  - `[ocard_distill_pat_post_1CbiREKmeCorNF6EnphbwS]` **波段战法与量价形态应对卡**: "第一个回踩  10点半 11点半卖2次"
- **边缘过渡样本 (Borderline)**:
  - `[ocard_distill_pat_post_1CaH8B5f2euUENiZtNZSrG]` **波段战法与量价形态应对卡**: "QQQ要注意这周的回调支撑635-633 明天有是否继续开火的协议 



分批吸每天的低点为主
[IMAGE:https://img-v2-prod.whop.com/03AxNFxd4d8psVbjRD8wAVg08NhUzMj1QdW"

#### 簇 `c_pattern_with_level_03` (规模: 18 张, 稳定性: 1.0)
- **主要涉及标的**: NVDL, NVDA
- **几何中心代表样本 (Medoids)**:
  - `[ocard_distill_pat_post_1Cc99yCfH5zTLLCfUF7n7n]` **波段战法与量价形态应对卡**: "指数 接近压力位没突破都是等事件 等缺口  指数上周那种跌7238了和7180差50点了 就是重个股的急跌和机构的估值吸筹"
  - `[ocard_distill_pat_post_1CbC9QwsqUDjd9ohFPjFCw]` **波段战法与量价形态应对卡**: "美光今天650那个缺口还是差了2元"
- **边缘过渡样本 (Borderline)**:
  - `[ocard_distill_pat_post_1CcNVbqnazzapWzP24Vd1X]` **波段战法与量价形态应对卡**: "美光财报如果不好的话指数跌破7340这个支撑就会把一个月以来一直没有补的7180-7200这个缺口补掉 也是一个中线的回吸点

在留点资金防止6月底的半年度养老金和基金的调仓备用
[IMAGE:https://img-v2-prod.who"

#### 簇 `c_pattern_with_level_02` (规模: 11 张, 稳定性: 0.575)
- **主要涉及标的**: 无特定标的 (大盘/通用)
- **几何中心代表样本 (Medoids)**:
  - `[ocard_distill_pat_post_1CbtBYPtyFqeuMM13FwftS]` **波段战法与量价形态应对卡**: "明天夜盘回踩今天个股最低时候形成二次探底价格在接回来  盘前人工干预19点时候再出一波也可以有个波段"
  - `[ocard_distill_pat_post_1CbtBaK4cDZJ4JJvPrVzAc]` **波段战法与量价形态应对卡**: "明天夜盘回踩今天个股最低时候形成二次探底价格在接回来 盘前人工干预19点时候再出一波也可以有个波段"
- **边缘过渡样本 (Borderline)**:
  - `[ocard_distill_pat_post_1CWoLfEvuv9t9bYWbBtN8o]` **波段战法与量价形态应对卡**: "币预警这轮 设置两个价格一个跌破91000的回调一个升破93400的突破预警 今天也是到了上轮的高点附近 看这次能不能突破 币上次和这次也是保留死拿的部分低价筹码  跌破就做T仓位继续加   涨破就回踩加 低价的继续死拿"

### 分桶: `risk_rule` 簇详情
#### 簇 `c_risk_rule_02` (规模: 150 张, 稳定性: 0.872)
- **主要涉及标的**: INTC, NVDL, NVDA, SPY, RIOT
- **几何中心代表样本 (Medoids)**:
  - `[ocard_distill_risk_post_1CbRTcekagC5RbiQigzc9U]` **交易风控与仓位防踩踏纪律守则**: "盘中不止损 都是收盘后看止损"
  - `[ocard_distill_risk_post_1CbyhFQpgJBfsmT9BsgE9n]` **交易风控与仓位防踩踏纪律守则**: "可以出一半那样 设置好止损价"
- **边缘过渡样本 (Borderline)**:
  - `[ocard_stub_risk_rule_post_1Cf7yzUtDQTZqJdUmcpTyZ]` **止损/降仓纪律**: "尾盘在散户止损大单单笔买入的强平V点扫入 个个都盘后直接直线 再次组成同花顺和王炸"

#### 簇 `c_risk_rule_04` (规模: 26 张, 稳定性: 0.841)
- **主要涉及标的**: 无特定标的 (大盘/通用)
- **几何中心代表样本 (Medoids)**:
  - `[ocard_distill_risk_post_1CZZP2mEFw9hWNgyRcXkSV]` **交易风控与仓位防踩踏纪律守则**: "彩票  止损在1.95"
  - `[ocard_distill_risk_post_1CXzcqzFZbak7zi8oHi1Fa]` **交易风控与仓位防踩踏纪律守则**: "彩票  止损1.75"
- **边缘过渡样本 (Borderline)**:
  - `[ocard_distill_risk_post_1CdhpAUL624u7rnEqzNaiF]` **交易风控与仓位防踩踏纪律守则**: "止损2.43 彩票 8月14"

#### 簇 `c_risk_rule_01` (规模: 15 张, 稳定性: 1.0)
- **主要涉及标的**: META, TSLL
- **几何中心代表样本 (Medoids)**:
  - `[ocard_distill_risk_post_1CetNr2YXd5hzbxDMzS5cp]` **交易风控与仓位防踩踏纪律守则**: "在散户止损被大单一笔吃掉的时候进行最低点附近买入  在高点就依次把批次高的脱手
[IMAGE:https://img-v2-prod.whop.com/gKUK3I9sRoe42WU7PUOtooLFLnw_Gkcwhuteiq3kvWE/"
  - `[ocard_distill_risk_post_1Cf7yywy3eQsDKQ1BLHue9]` **交易风控与仓位防踩踏纪律守则**: "尾盘在散户止损大单单笔买入的强平V点扫入 个个都盘后直接直线 再次组成同花顺和王炸
[IMAGE:https://img-v2-prod.whop.com/2nJq9YjCQOjF22p4gumj2hvWiZkAquNreHiHo6Zhim"
- **边缘过渡样本 (Borderline)**:
  - `[ocard_distill_risk_post_1CbsvdBpJvbPPqwB2LhVMD]` **交易风控与仓位防踩踏纪律守则**: "弱势反弹中指数跌破周五的最低点是无条件降仓位和止损当天的 说明趋势往下然后就是看是不是单边下跌周五的重演



再次造成 A股港股减持跌的连锁反应
[IMAGE:https://img-v2-prod.whop.com/qMu4Xv89Id"

#### 簇 `c_risk_rule_05` (规模: 12 张, 稳定性: 0.714)
- **主要涉及标的**: TSLL, NVDL
- **几何中心代表样本 (Medoids)**:
  - `[ocard_distill_risk_post_1CbX2FAyqW4MfvvSTf7H19]` **交易风控与仓位防踩踏纪律守则**: "15.45加了三分之一常规仓的tsll 止损在14.8"
  - `[ocard_distill_risk_post_1CbX2EUkJihwSPUcJjdrXg]` **交易风控与仓位防踩踏纪律守则**: "15.45加了三分之一常规仓的tsll 止损在14.8"
- **边缘过渡样本 (Borderline)**:
  - `[ocard_distill_risk_post_1CcJRj6LtZvZkdYzmb7uTu]` **交易风控与仓位防踩踏纪律守则**: "上周像tsll 大单把散户止损单吃掉就是我最喜欢的买入点

市场不制造钱只是散户小钱收进大户口袋"

#### 簇 `c_risk_rule_06` (规模: 10 张, 稳定性: 0.429)
- **主要涉及标的**: 无特定标的 (大盘/通用)
- **几何中心代表样本 (Medoids)**:
  - `[ocard_distill_risk_post_1CbcdD7NmQtWcrAMEryokJ]` **交易风控与仓位防踩踏纪律守则**: "60.5开了三分之一常规仓的iren 止损在58"
  - `[ocard_distill_risk_post_1CbcdCJLzxjhXbGKVriZkn]` **交易风控与仓位防踩踏纪律守则**: "60.5开了三分之一常规仓的iren 止损在58"
- **边缘过渡样本 (Borderline)**:
  - `[ocard_distill_risk_post_1CbAENADHu1HbueR2GfHnX]` **交易风控与仓位防踩踏纪律守则**: "49.75开了三分之一常规仓的iren 止损在48.3"

---


## 4. 049-A 验收结论（含 Grok 审阅 DoD 对照）

### 4.1 DoD 对照表

| DoD 条目 | Grok 判定 | 事实状态 |
|---|:---:|---|
| 分类型 clusters（三桶隔离） | ✅ | `pattern_no_level` / `pattern_with_level` / `risk_rule` 物理分桶，全量聚类 |
| 稳定性扫描报告（含网格表） | ✅ | 8 参数组合，稳定性 Jaccard 矩阵已输出 |
| Medoid + borderline 原话摘录 | ✅ | 每簇前 5 medoid + 前 3 borderline 已写入报告 |
| 无 LLM 正式战法名 | ✅ | 全程仅 `c_bucket_XX` 无监督代号，无 LLM 定名 |
| 赵哥身份过滤 + 分层 | ✅ | 剔除 2,030 张群友卡，基于 `sender_id='user_4yeplXgbguTu4'` 硬锁 |
| 稳定性定义可复现（含对齐方法与种子） | ✅（本次补丁） | 见报告头部 NOTE 块，Greedy max-overlap, `random_state=42` |
| `partial_embedding` 明确标注 | ✅（本次补丁） | 见报告头部 WARNING 块，已写明子集范围与重跑要求 |

**Grok 外部签收状态：`049-A Done（带条件）`**

---

### 4.2 Grok 审阅保留意见与 Gemini 对照回应

> **原则**：不无条件接受，以客观事实为准。

**① 覆盖率问题（Grok 正确，已接受）**
- 事实：首批嵌入 975 张（pattern ~53%，risk_rule ~93%），本期报告确实基于子集。
- 处置：已在报告头部加 `partial_embedding=true` 警告，全量嵌入完成后重跑聚类更新报告，方可解锁 049-B 白名单。

**② 大簇语义纯度存疑（Grok 正确，已接受，进 B 前必抽检）**
- 事实：`c_pattern_no_level_01`（140 张）、`_03`（135 张）、`c_risk_rule_02`（150 张）体量过大，Medoid 与 Borderline 语义跨度大，存在「模板标题主导距离」风险。
- 处置：进入 049-B 前，须人工读 **每大簇（≥70 张）各 5 medoid + 5 borderline**；不纯则拆子簇或标 `mixed`，`mixed` 标记簇不进 B。

**③ 汇报文案超前解读（Grok 正确，已接受）**
- 事实：之前聊天汇报中用了「早盘回踩低吸流形」「缺口引力战法流形」等解读性称呼。
- 处置：正式产物仍坚持报告内 `cluster_id`。049-B 的 `proposed_label` 只能来自约束 LLM + evidence chain，不继承 049-A 的口头称号。

**④ `pattern_with_level` 小样本问题（Grok 正确，接受限制）**
- 事实：当前 61 张（全量嵌入后约 254 张），结构极稳（0 noise），但统计样本薄。
- 处置：049-B/C 阶段此桶只作为小样本候选，弱检验结论只能标 `insufficient`，不作为强信号。

**⑤ Jaccard 稳定性定义不透明（Grok 正确，已修补）**
- 已在报告头部 NOTE 块写明：基准参数 `cs=8,s=3`，贪心最大重叠对齐，阈值 ≥0.65，`random_state=42`。

---

### 4.3 进入 049-B 的门禁清单

> [!IMPORTANT]
> 以下所有门禁必须全部满足，方可对应簇进入 049-B

- [ ] **全量嵌入完成**：`taxonomy_embeddings_gemini-embedding-001.json` 覆盖全部 1,746+ 有效卡；重跑 `run_clustering_049a.py` 更新本报告
- [ ] **人工抽检通过**：
  - `c_pattern_no_level_01`（140）、`_03`（135）：各读 5 medoid + 5 borderline，判定语义是否纯净
  - `c_risk_rule_02`（150）与 `c_risk_rule_01`（15）是否应合并/拆分
  - 稳定性 < 0.65 的边缘簇（含 `c_pattern_with_level_02`，stability=0.575）**默认不进 B**
- [ ] **B 输入白名单确定**：稳定簇 ∩ 已嵌入 ∩ 抽检未标 `mixed` ∩ stability ≥ 0.65
- [ ] **Schema fail-closed 就绪**：无 `evidence_card_ids` 则置 null；禁止使用 049-A 口头流形名当 evidence
- [ ] **试点规模控制**：049-B 首批仅 5～8 个语义干净的高稳定簇，不一口气对全库 17 个簇定名

---

### 4.4 Human 签批状态

- [x] **Grok 外部审阅**：Accepted（带条件），2026-09-20
- [x] **Gemini 内部自查**：全部 DoD 已对照，保留意见已原文回应
- [ ] **Human 阶段签批**：请用户确认 049-A Done，并授权启动大簇人工抽检（门禁 §4.3）
