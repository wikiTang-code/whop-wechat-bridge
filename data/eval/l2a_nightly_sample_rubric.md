# 📋 L2a 广播频道夜跑 50 条三层抽检表头与打分标准 (Sample Rubric)

## 一、分层抽样结构 (3 层共 50 条，确定性哈希)
1. **随机日常窗 (30 条)**：由 `cu_id` 确定性哈希取样，覆盖早盘、盘中、尾盘日常交易指令；
2. **多标的/复杂窗 (10 条)**：`actions.length >= 2`，检验分批出场、跨标的加减仓是否正确展开；
3. **疑似漏抽边界窗 (10 条)**：源对话包含「买/卖/加/出/吸/止损/止盈」但抽取 `actions == []`，核实是否为纯分析误判。

---

## 二、抽检记录明细表头 (50 条核查字段)

| 字段名 | 说明与要求 | 取值规范 |
| :--- | :--- | :--- |
| `cu_id` | Context Unit 唯一标识 | `cu_trade_00001` ~ `cu_trade_01195` |
| `layer` | 所属抽样分层 | `random_30` / `multi_10` / `empty_trade_keyword_10` |
| `source_text` | 源对话原文关键片段 | 截取对话核心句子 |
| `pred_speech_act` | 模型预测语用分类 | `trade_action` / `market_view` / `position_update` / `inquiry` / `noise` |
| `pred_actions` | 抽取并经后处理的 Action 列表 | `[{ ticker, action, price, status, instrument_type }]` |
| `ground_truth_judgement` | 人工/规则核验结论 | `PASS` / `MISS_ACTION` / `WRONG_TICKER` / `WRONG_PRICE` / `FALSE_ACTION` |
| `error_category` | 误差归因分类 | `区间拆单错误` / `成本当成交价` / `幻觉标的` / `保守漏抽` / `无错误` |
| `reconcile_ready` | 是否具备实盘对账资格 | `YES` / `NO` (有合法 ticker 与 action 即可对账) |

---

## 三、合格验收红线 (Acceptance Gates)
1. **解析成功率 `count(parse_ok)`**：$\ge 99.5\%$；
2. **幻觉/无效 Ticker 比例**：$0.0\%$（严格为 0）；
3. **多标的展开准确率 (Multi-10)**：$\ge 80.0\%$；
4. **疑似漏抽误判率 (Empty-10)**：真实有单漏抽 $\le 2$ 条（其余 8 条应为纯口诀/无单分析）。
