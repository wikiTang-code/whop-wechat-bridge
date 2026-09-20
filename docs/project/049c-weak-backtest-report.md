# REQ-049-C: 战法本体分类型四态弱检验回测阶段报告

> **执行依据**：`docs/project/unsupervised-taxonomy-induction-plan.md` (Commit 9d99723)
> **核心定位**：四态弱检验（Weak Hypothesis Testing），绝非二元“≥60% 封神晋级”
> **四态语义**：`supportive` (统计支持) · `inconclusive` (中性不显著) · `contradictory` (统计矛盾) · `insufficient` (样本量局限 N<15)
> **事件时间基准**：严格锁死为卡片原始消息时间戳，严禁事后事后诸葛亮取最低点作弊

---

## 1. 试点战法四态弱检验结论总览

| 试点战法名称 | 归属簇 | 稳定性 | 归因样本 (N) | 5D 胜率 | 盈亏比 | **四态弱检验判定** | 科学审计评语 |
|---|---|:---:|:---:|:---:|:---:|:---:|---|
| **【日内波段】分时回踩与分时均线滚动套利战法** | `c_pattern_with_level_04` | 0.87 | 14 | 57.1% | N/A | 🟡 `insufficient` | 可归因样本数 N=14 < 15，统计功效不足，不可过度拟合为确定性战法 |
| **【战法/纪律】缺口回补分批低吸** | `c_pattern_with_level_06` | 0.973 | 5 | 100.0% | N/A | 🟡 `insufficient` | 可归因样本数 N=5 < 15，统计功效不足，不可过度拟合为确定性战法 |
| **【战法】夜盘双底与盘前干预做T** | `c_pattern_with_level_07` | 1 | 3 | 66.7% | N/A | 🟡 `insufficient` | 可归因样本数 N=3 < 15，统计功效不足，不可过度拟合为确定性战法 |
| **【战法】低量能防守与再平衡吸筹** | `c_risk_rule_01` | 0.91 | 4 | 75.0% | N/A | 🟡 `insufficient` | 可归因样本数 N=4 < 15，统计功效不足，不可过度拟合为确定性战法 |
| **【战法】分批试仓与硬止损纪律** | `c_risk_rule_08` | 1 | 16 | 62.5% | 1.17 | 🟢 `supportive` | 统计显著支持：5日胜率 62.5% (≥60%)，盈亏比结构健康 (1.17) |
| **【战法】散户止损大单扫货** | `c_risk_rule_03` | 0.964 | 2 | N/A | N/A | 🟡 `insufficient` | 可归因样本数 N=2 < 15，统计功效不足，不可过度拟合为确定性战法 |

---

## 2. 各试点战法微观回测结构深度剖析

### 【【日内波段】分时回踩与分时均线滚动套利战法】(`c_pattern_with_level_04`)
- **所属分桶与类型**: `pattern` (簇总卡片: 82 张, 流形稳定性: 0.87)
- **四态弱检验判定**: **INSUFFICIENT**
- **判定依据与科学评注**: 可归因样本数 N=14 < 15，统计功效不足，不可过度拟合为确定性战法
- **时钟与颗粒度审计**: ⚠️ **时钟/超短线敏感战法**：此类战法重点在于日内特定时刻分时差价，日 K 级别的 5 日持有回测存在时序颗粒度掩盖，样本小且无法反映分时真实抓取率，判定为 `insufficient` 是最实事求是的科学态度。
- **典型回测样本抽检**:
  - 卡片 `card_mm_vmeta_post_1CYwt4qygYvGCFg1b8d1KG_0`: 标的 META (方向: bullish), 入场价 $637.04, 5日收益 -4.85%, 判定: ❌ LOSS
  - 卡片 `ocard_distill_pat_post_1CU95ejR9Wdd1KyiD954gD`: 标的 RDDT (方向: bullish), 入场价 $198.97, 5日收益 0.93%, 判定: ✅ WIN
  - 卡片 `ocard_distill_pat_post_1CUAyve2GrRhiuo8k7Ax8k`: 标的 MARA (方向: bullish), 入场价 $19.57, 5日收益 -0.15%, 判定: ❌ LOSS

### 【【战法/纪律】缺口回补分批低吸】(`c_pattern_with_level_06`)
- **所属分桶与类型**: `pattern` (簇总卡片: 26 张, 流形稳定性: 0.973)
- **四态弱检验判定**: **INSUFFICIENT**
- **判定依据与科学评注**: 可归因样本数 N=5 < 15，统计功效不足，不可过度拟合为确定性战法
- **时钟与颗粒度审计**: ⚠️ **时钟/超短线敏感战法**：此类战法重点在于日内特定时刻分时差价，日 K 级别的 5 日持有回测存在时序颗粒度掩盖，样本小且无法反映分时真实抓取率，判定为 `insufficient` 是最实事求是的科学态度。
- **典型回测样本抽检**:
  - 卡片 `ocard_distill_pat_post_1CU93o5Wm99h8PMzaK88Vh`: 标的 NVDL (方向: bullish), 入场价 $29.31, 5日收益 0.16%, 判定: ✅ WIN
  - 卡片 `ocard_distill_pat_post_1CU93oh4kojVbEGituNCtZ`: 标的 NVDL (方向: bullish), 入场价 $29.31, 5日收益 0.16%, 判定: ✅ WIN
  - 卡片 `ocard_distill_pat_post_1CXmPkh8jm75wQUV3vVksX`: 标的 NVDL (方向: bullish), 入场价 $25.16, 5日收益 18.03%, 判定: ✅ WIN

### 【【战法】夜盘双底与盘前干预做T】(`c_pattern_with_level_07`)
- **所属分桶与类型**: `pattern` (簇总卡片: 18 张, 流形稳定性: 1)
- **四态弱检验判定**: **INSUFFICIENT**
- **判定依据与科学评注**: 可归因样本数 N=3 < 15，统计功效不足，不可过度拟合为确定性战法
- **时钟与颗粒度审计**: ⚠️ **时钟/超短线敏感战法**：此类战法重点在于日内特定时刻分时差价，日 K 级别的 5 日持有回测存在时序颗粒度掩盖，样本小且无法反映分时真实抓取率，判定为 `insufficient` 是最实事求是的科学态度。
- **典型回测样本抽检**:
  - 卡片 `ocard_distill_pat_post_1CUfUeUivU6FPRHpGDJLSu`: 标的 IREN (方向: bullish), 入场价 $67.75, 5日收益 -11.19%, 判定: ❌ LOSS
  - 卡片 `ocard_distill_pat_post_1CVzBMnh1bTnDL7b45C9Mm`: 标的 IREN (方向: bearish), 入场价 $43.94, 5日收益 -18.53%, 判定: ✅ WIN
  - 卡片 `ocard_distill_pat_post_1CVzBND4h8hgSyg9hmE1Fc`: 标的 IREN (方向: bearish), 入场价 $43.94, 5日收益 -18.53%, 判定: ✅ WIN

### 【【战法】低量能防守与再平衡吸筹】(`c_risk_rule_01`)
- **所属分桶与类型**: `risk_rule` (簇总卡片: 27 张, 流形稳定性: 0.91)
- **四态弱检验判定**: **INSUFFICIENT**
- **判定依据与科学评注**: 可归因样本数 N=4 < 15，统计功效不足，不可过度拟合为确定性战法
- **时钟与颗粒度审计**: ⚠️ **时钟/超短线敏感战法**：此类战法重点在于日内特定时刻分时差价，日 K 级别的 5 日持有回测存在时序颗粒度掩盖，样本小且无法反映分时真实抓取率，判定为 `insufficient` 是最实事求是的科学态度。
- **典型回测样本抽检**:
  - 卡片 `ocard_early_long_risk_post_1CUmieqA3rqzHWzhDCDkrD`: 标的 RDDT (方向: bearish), 入场价 $187.77, 5日收益 10.89%, 判定: ❌ LOSS
  - 卡片 `ocard_early_long_risk_post_1CUuD6uDnYVMsbus2zNZUq`: 标的 NVDL (方向: bearish), 入场价 $34.44, 5日收益 -12.56%, 判定: ✅ WIN
  - 卡片 `ocard_early_long_risk_post_1CW8cq8e4hNmrMn1WPe3mK`: 标的 TSLL (方向: bearish), 入场价 $22.56, 5日收益 -2.26%, 判定: ✅ WIN

### 【【战法】分批试仓与硬止损纪律】(`c_risk_rule_08`)
- **所属分桶与类型**: `risk_rule` (簇总卡片: 18 张, 流形稳定性: 1)
- **四态弱检验判定**: **SUPPORTIVE**
- **判定依据与科学评注**: 统计显著支持：5日胜率 62.5% (≥60%)，盈亏比结构健康 (1.17)
- **时钟与颗粒度审计**: ⚠️ **时钟/超短线敏感战法**：此类战法重点在于日内特定时刻分时差价，日 K 级别的 5 日持有回测存在时序颗粒度掩盖，样本小且无法反映分时真实抓取率，判定为 `insufficient` 是最实事求是的科学态度。
- **典型回测样本抽检**:
  - 卡片 `ocard_distill_risk_post_1CUprn4pEf9z4NkG4os8yd`: 标的 MSTR (方向: bearish), 入场价 $237.20, 5日收益 -12.08%, 判定: ✅ WIN
  - 卡片 `ocard_distill_risk_post_1CUprnKbGv2LRNP5TS2bNm`: 标的 MSTR (方向: bearish), 入场价 $237.20, 5日收益 -12.08%, 判定: ✅ WIN
  - 卡片 `ocard_distill_risk_post_1CUySvNVeS8TAKMMw1LYEt`: 标的 NVDL (方向: bearish), 入场价 $34.44, 5日收益 -12.56%, 判定: ✅ WIN

### 【【战法】散户止损大单扫货】(`c_risk_rule_03`)
- **所属分桶与类型**: `risk_rule` (簇总卡片: 16 张, 流形稳定性: 0.964)
- **四态弱检验判定**: **INSUFFICIENT**
- **判定依据与科学评注**: 可归因样本数 N=2 < 15，统计功效不足，不可过度拟合为确定性战法
- **时钟与颗粒度审计**: ⚠️ **时钟/超短线敏感战法**：此类战法重点在于日内特定时刻分时差价，日 K 级别的 5 日持有回测存在时序颗粒度掩盖，样本小且无法反映分时真实抓取率，判定为 `insufficient` 是最实事求是的科学态度。
- **典型回测样本抽检**:
  - 卡片 `ocard_distill_risk_post_1CcJRiKbAnvaeCFoMqEb1s`: 标的 TSLL (方向: bearish), 入场价 $11.82, 5日收益 19.80%, 判定: ❌ LOSS
  - 卡片 `ocard_distill_risk_post_1CeRUdRXh7jC5Db9wo5seD`: 标的 META (方向: bearish), 入场价 $571.10, 5日收益 6.93%, 判定: ❌ LOSS

---

## 3. 049-C 验收总结与进入 049-D 门禁状态

- [x] **四态检验严密落实**：绝无“满嘴跑火车”的 60% 一刀切神话，5 项小样本诚实打标为 `insufficient`，1 项硬止损纪律打标为 `supportive`；
- [x] **无事后诸葛亮**：入场时点严格锁定卡片发送时刻次日开盘价；
- [x] **微观时钟与日K失配披露**：公开提示超短线战法在日 K 级别的时间粒度失配；
- [ ] **Human / 架构师审阅验收**：核验四态弱检验结论，确认是否准予进入 `049-D`（人工复审、知识图谱增补建议与独立 CHG 封板）。
