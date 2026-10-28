# 10 — HITL 跟单主链活验收与离线认知层演进规划（2026-10）

> **上级索引**：[`README.md`](./README.md) · **开发规划姊妹篇**：[`09-development-plan-contract-20260921.md`](./09-development-plan-contract-20260921.md)  
> **治理对齐声明**：本文档严格遵循 [`AGENTS.md`](../../AGENTS.md) 锁死红线。所有演进方向均受制于 **HITL（人机回环）优先、`AUTO_SUBMIT=false`、L2 参谋层 `REFERENCE_ONLY`（严禁静默拦单）** 三大铁律。  
> **单一真相源原则**：本文件为项目唯一认可的阶段性路线规划，禁止在根目录另设平行路线文档。

---

## 一、 核心架构红线与边界锁死（Governance Gates）

| 架构层级 | 职责定位 | 严格允许（DO） | 绝对禁止（DO NOT） |
| :--- | :--- | :--- | :--- |
| **L1 / HOT 主链**<br>(`ingest_runner` / `tier_poller`) | 极速信号捕获与企微卡片触达 | 轮询抓取 $\rightarrow$ 正则/`zhao_print` $\rightarrow$ 状态拼接 $\rightarrow$ 企微确认卡推送；严控 `t_arrive` 延迟 | ❌ 严禁塞入 DeepTutor、多轮 Agent、重型 Python 或同步图谱检索<br>❌ 严禁因任何 L2 评分低而静默丢弃赵哥口播推送 |
| **L2a 实时语义层**<br>(`ai-router-policy.js`) | 动作槽位提取与双轨台账对齐 | 提取 Ticker / 动作动词 / 仓位比例（1/3、1/6）；结合持仓台账补全省略主语（仅建议） | ❌ 严禁将 `px_zhao`（事后广播价）当作我方必然成交价<br>❌ 严禁将图片 OCR 特征直接作为自动下单触发器 |
| **L2b 离线认知层**<br>(`data/l2b/` / `gex`) | 参谋旁注、盘前剧本与复盘蒸馏 | GEX 矩阵、周哥观点、梯子通道、LightRAG 图谱仅输出 `WARN` / 改分 / 卡片注释 (`hint_only`) | ❌ 严禁写成 Gatekeeper 代码硬拦截（不能让用户收不到卡）<br>❌ 严禁将 `golden_playbook.json` 或负对照参数包装为自动开仓公式 |
| **L3 执行与桥接层**<br>(`brokers/longbridge.js` / `paper_execution_engine.js`) | 人工确认后的合规报单与风控 | 默认 `Intent = PENDING_HITL`；人工点击确认后校验 $\le 40\text{bp}$ 价格保护，满足方可执行 Paper 报单 | ❌ 严禁开启 `AUTO_SUBMIT=true`<br>❌ 严禁未经人工确认自动挂止盈/止损/加仓单 |

---

## 二、 当前系统核心痛点清单（Pain Points Diagnosis）

1. **痛点 P0-1（主链闭环未活验收）**：长桥接口烟测 `FILLED` $\neq$ 真实 `zhao_follow` 链路 `FILLED`。尚未完整走通「盘中真口播 $\rightarrow$ 企微单子确认群出卡 $\rightarrow$ 人工点确认 $\rightarrow$ $\le 40\text{bp}$ 价格保护校验 $\rightarrow$ Longbridge Paper 字面 `FILLED`」的端到端实盘闭环。
2. **痛点 P0-2（自主侧 1s 热区数据债 · DEBT-025）**：1s 级别高频热区数据写入的稳定性、落盘监控与断流自愈尚未彻底夯实，当前缺少非夹具的持续 live 数据。
3. **痛点 P1-1（口播省略主语与 L2a 空包漏抽）**：如 `CHG-064` 离线对账所示，大 V 口播常省略 Ticker（如“到了接一点”、“出第一次”），缺乏与当前活跃持仓台账（`dual_ledger_track2`）的只读上下文关联提示。
4. **痛点 P1-2（关键点位藏在截图中）**：文字多为结论，支撑/阻力位在 `data/media/zhao/` 截图中，离线 L2b 资产缺乏结构化视觉字段合流。
5. **痛点 P2-1（小资金跟单摩擦与仓位映射缺失）**：个人资金体量与大 V 网格不同，HITL 确认卡上缺少直观的「CORE 底仓 vs 做 T 仓」标识、1/3 与 1/6 建议股数换算及长桥 200 股佣金磨损提示。

---

## 三、 分阶段演进开发计划（Phased Engineering Roadmap）

### Phase 1（P0 最高优）：跟单主链活验收与 1s 热区数据债清偿
> **目标**：不加任何花哨复杂模型，100% 跑通真实跟单主链字面 `FILLED`，稳住底层数据流。

* **Task 1.1：`zhao_follow` 端到端活验收（Live Acceptance）**
  * **改动范围**：`paper_wecom_card.js`, `brokers/longbridge.js`, `paper_execution_engine.js`
  * **实施细节**：
    1. 锁定 `AUTO_SUBMIT=false`，确保所有 `zhao_print` 触发的 Intent 状态强制初始化为 `PENDING_HITL`。
    2. 企微确认群卡片回调链路联调：人工点击确认后，实时拉取 Longbridge 最新盘口（Ask/Bid），计算与 `px_zhao`（或卡片生成时刻基准价）的偏离度。
    3. **$\le 40\text{bp}$ 门控**：偏离度 $\le 40\text{bp}$ 则正式下发 Paper 订单并轮询追踪至字面 `FILLED` 状态；若 $> 40\text{bp}$ 则转为 `WARN_SLIPPAGE_EXCEEDED` 并回写企微提示，不盲目追高。
  * **验收标准**：在 `data/runs/` 下产出至少 1~3 笔真实盘中口播驱动的 `zhao_follow` 完整生命周期日志（含 `t_arrive`, `t_card_sent`, `t_human_ack`, `t_paper_filled`）。

* **Task 1.2：1s 热区数据持续写入巡检与守护**
  * **改动范围**：`scripts/market/collect_1s_ohlcv.js`, `tools/ops/`
  * **实施细节**：
    1. 检查 1s K 线/Tick 热区写入进程的存活状态、磁盘增长率与时间戳连续性。
    2. 增加轻量级心跳监控（Heartbeat），若盘中 1s 热区断流超过 15 秒，向运维群发送告警，确保数据债不再累积。

---

### Phase 2（P1 次高优）：HITL 确认卡“参谋旁注”增强（纯只读/不拦单）
> **目标**：把仓位计算、持仓上下文、GEX/梯子状态变成确认卡上的“一眼看懂的辅助小抄”，辅助人脑在 3 秒内做点击决策。

* **Task 2.1：HITL 确认卡集成「仓位状态与佣金预检提示」**
  * **改动范围**：`paper_wecom_card.js`（只读视图层）
  * **实施细节**：
    1. 在生成企微 HITL 确认卡时，读取 `dual_ledger_track2` 当前持仓，在卡片上附加只读提示行：
       * **仓位标签提示**：标注当前标的属于 `[CORE 底仓]` 还是 `[日内做 T 仓]`。
       * **股数与佣金提示**：根据账户预设单笔预算，自动折算 `1/3 常规仓` 与 `1/6 试错仓` 对应股数；若折算股数 $< 200$ 股（如低价杠杆 ETF TSLL），在卡片底部显示 `💡 佣金提示：不足 200 股，建议凑整或评估最小波幅 ($0.30)`。
    2. **严守边界**：仅在卡片文本中展示建议股数，不自动修改报单默认拦截逻辑。

* **Task 2.2：GEX / 梯子通道 / 周哥共振分作为卡片 `hint_only` 旁注**
  * **改动范围**：`data/gex/`, `adapters/gex.js`, `paper_wecom_card.js`
  * **实施细节**：
    1. 读取最新 `data/gex/latest.json` 及基础技术位（如 EMA 梯子位置），计算环境参考分。
    2. 将结果以纯文本 Badge 形式挂载到企微确认卡末尾（例如：`📊 参谋旁注 [REFERENCE_ONLY]: 距 Put Wall +0.8% | 周哥偏多`）。
    3. **单元测试锁死**：编写断言测试，确保无论参谋分是 0 分还是 100 分，确认卡发送函数 `sendPaperConfirmCard()` 的调用率均为 100%，绝不静默拦截。

* **Task 2.3：`l2a_empty_but_has_fill_verb` 持仓上下文候选补全**
  * **改动范围**：`tools/trade/slm_miss_fill.js`（CHG-064 扩展）
  * **实施细节**：
    1. 当检测到明确动作词（如“出第一次”、“出一半”、“急跌买回”）但正则/模型未提取出 Ticker 时，自动查询当前活跃持仓列表。
    2. 生成带 `[候选推断: 疑似针对持仓 TSLL]` 标记的 HITL 确认卡推送给人工确认，消除漏卡盲区。

---

### Phase 3（P2 离线演进）：L2b 视觉结构化与离线知识图谱（脱离实时链路）
> **目标**：利用 Claude API / 本地离线 RAG 工具，在非交易时段（盘后/周末）深挖历史台账与截图资产，反哺知识图谱。

* **Task 3.1：离线截图结构化流水线（Media-to-L2b Pipeline）**
  * **改动范围**：`tools/knowledge/batch_vision_pipeline.js`（严禁被实时 `ingest` 引用）
  * **实施细节**：
    1. 针对历史筛选出的高价值行情截图（`data/media/zhao/`），在盘后批处理提取：`chart_ticker`, `support_resistance_json`。
    2. 将提取出的结构与同时间戳的 `messages` 关联，输出至离线资产表，供离线复盘使用，**绝不进入实时检测器特征与 `place_order`**。

* **Task 3.2：离线战法条件图谱与盘前 Brief 生成（脱离实时主链）**
  * **改动范围**：独立离线工具目录（与线上进程解耦）
  * **实施细节**：
    1. 仅读取历史台账与已有黄金战法，构建只读本地图谱。
    2. 每日盘前运行一次离线脚本，结合隔夜关键价位检索历史大V应对教案，生成一份静态 Markdown 简报推送到企微作为盘前早读。

---

## 四、 里程碑验收检查表（Definition of Done）

- [ ] **M1（主链活验收）**：完成真口播 $\rightarrow$ 企微出卡 $\rightarrow$ 人工点确认 $\rightarrow$ $\le 40\text{bp}$ 校验 $\rightarrow$ Paper `FILLED` 全链路实盘留痕。
- [ ] **M2（数据债清理）**：1s 热区写入连续稳定运行，监控告警就绪。
- [ ] **M3（卡片注释升级）**：HITL 卡展示 1/3·1/6 股数建议、CORE/T 标签及 GEX 旁注，且通过“零拦单”红线回归测试。
- [ ] **M4（离线资产沉淀）**：完成历史截图的离线结构化归档与图文关联。
