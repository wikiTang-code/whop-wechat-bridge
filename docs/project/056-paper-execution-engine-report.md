# REQ-056: 长桥模拟盘 (Paper Trading) 执行闭环与 TradeIntent 状态机工程落地报告

> **需求编号**：REQ-056 (Phase 0 Week 1 交付)  
> **关联规划**：三域分立架构 (Ingestion / Decision / Execution+Ledger)  
> **执行状态**：`done-eng` (accepted-with-gap · 挂单/查验/撤单/风控/对账全绿；首单撮合成交锁定周一夜盘)  
> **测试覆盖**：19 项单元测试通过 (0 失败) · 端到端真实柜台测试通过

---

## 1. 核心工程落地全景

按照架构评审与 Grok 终审意见，本项目彻底消除了将“驾驶舱展示”伪装成“量化执行”的结构性缺陷，建立了独立的 **Execution & Ledger 域**：

### 1.1 模块落地清单
1. **执行引擎核心 (`tools/trade/paper_execution_engine.js`)**:
   - 建立不可变 `TradeIntent` 状态机 (`PENDING_HITL` $\rightarrow$ `SUBMITTED` $\rightarrow$ `FILLED` / `CANCELLED` / `REJECTED`)；
   - 严格安全门禁：`AUTO_SUBMIT_ENABLED = false`（硬锁定默认须人工 HITL 确认）；
   - 超时自动撤单与竞态防御（超时触发撤单前先终查 `getTodayOrders` 确认是否已成，避免误撤已成交订单）。
2. **长桥原生经纪商驱动加固 (`brokers/longbridge.js`)**:
   - 强制环境断言：`assertPaperMode()`（`BROKER_MODE !== 'paper'` 时硬阻断并报错，物理隔离实盘）；
   - 官方原生字段契约：严格使用 `orderType: OrderType.LO`, `submittedQuantity: Decimal`, `submittedPrice: Decimal`, `outsideRth: OutsideRTH.Overnight / AnyTime`；
   - 订单状态与买卖方向标准化归一 (`normalizeOrderStatus` 映射底层整数枚举 1, 5, 14, 15 等；`normalizeOrderSide` 映射 1=BUY, 2=SELL)；
   - 完善撤单 (`cancelOrder`)、终态轮询 (`pollOrderStatus`) 与持仓同步 (`syncPaperPositions`)。
3. **事前硬风控引擎 (`tools/trade/paper_risk_guard.js`)**:
   - 规则 1：单笔名义金额上限 $\le \$5,000$（超额直接硬阻断）；
   - 规则 2：期权代码 OCC 正则拦截（Phase 0 仅限正股/ETF，期权一律拒绝）；
   - 规则 3：限价盘口偏离度超过 $\pm 10\%$ 拦截（防手抖挂单与极端滑点穿仓）；
   - 规则 4：总持仓标的上限 $\le 8$ 只；
   - 规则 5：单日提交流控 $\le 30$ 笔。
4. **三方对账哨兵 (`tools/ops/paper_reconciliation_sentinel.js`)**:
   - 本地 Intent 账本 vs 柜台当日委托 (`todayOrders`) vs 柜台第一真源持仓 (`stockPositions`) 交叉核验；
   - 发现差异产生预警报告，每日定时与盘前自动运行。
5. **HUD 决策驾驶舱持仓双轨改造 (`public/radar_hud.html`)**:
   - 左轨：原启发式持仓追踪；
   - 右轨：柜台模拟盘真实持仓第一真源（`broker_paper_positions`）与意图流转统计看板。
6. **夜盘专用首发点火自检工具 (`scripts/trade/night_market_kickoff.js`)**:
   - 时钟感知：自动判定 `OVERNIGHT_TRADING` 时段；
   - 资产检查：自动读取长桥可用现金与购买力；
   - 一键报单：装配合规 Intent，走过风控，推往柜台，跟踪撮合，自动触发三方对账。

---

## 2. 真实长桥模拟盘端到端实测凭证

在美股休市与全时段测试中，发起长桥真实模拟柜台连通性实测：
- **模拟账户资金查验**：
  - 可用现金：**$102,640.00**
  - 总购买力：**$718,490.26**
- **委托挂单流转实测**：
  - 真实柜台生成订单号：`order_id = 1286248324139069440`
  - 柜台初态确认：状态码 `1` (`SUBMITTED` / 未报/已报)
  - 柜台撤单流转：调用 `cancelOrder`，状态成功更新至 `15` (`CANCELLED`)
  - 持仓同步：成功查询柜台持仓 0 标的，无虚假幻觉数据。

---

## 3. 单测全景

运行 3 大核心套件（`test_paper_execution_engine.js`, `test_paper_risk_guard.js`, `test_paper_api_endpoints.js`）：
```
# tests 19
# suites 7
# pass 19
# fail 0
# duration_ms 247.5299
```
全部 19 项测试 100% 绿灯通过。

---

## 4. 周日夜盘正式点火 SOP (周一 08:00 CST / 美东周日 20:00 ET)

为确保夜盘鸣锣时第一时间上线点亮，制定以下标准化操作规程：

1. **T - 10 分钟 (周一 07:50 CST)**:
   - 运行环境自检：
     ```bash
     node scripts/trade/night_market_kickoff.js --check-only
     ```
   - 确认输出 `安全断言通过: BROKER_MODE=paper`，可用现金与购买力正常。
2. **T + 0 分钟 (周一 08:00 CST 夜盘开盘)**:
   - 执行首发点火（买入 1 股 TSLA，带当前夜盘市价或保护性限价）：
     ```bash
     node scripts/trade/night_market_kickoff.js --ticker TSLA --qty 1 --price <最新夜盘买一价>
     ```
   - 脚本将自动完成：风控验证 $\rightarrow$ HITL 提交 $\rightarrow$ 柜台撮合轮询 $\rightarrow$ 持仓真源写入 $\rightarrow$ 触发三方对账。
3. **T + 5 分钟 (周一 08:05 CST)**:
   - 访问 Web 驾驶舱 `:8085/hud`，查看右侧「长桥模拟盘持仓 (第一真源)」是否已点亮 TSLA 1 股真实持仓与浮盈。

---

## 5. 战略目标与实战对账单 (Strategic Gap Audit · 强制红线)

> 依据《Agent 通用治理与执行规范》第 6 条与第 12 条红线，必须对本 REQ 的战略成效与实战差距进行严格事实对账，严禁浮夸宣称“圆满完成”。

| 维度 | 原始 North Star 战略目标 | 当前工程落地事实 | 关键差距与系统盲区 (Gap Analysis) |
|---|---|---|---|
| **执行域闭环** | 独立于驾驶舱与消息流，具备真实券商账户级委托、撮合、持仓与日终对账能力 | `done-eng`：长桥模拟盘驱动、`TradeIntent` 状态机、事前硬风控、撤单与三方对账已全通 | **尚未点亮首笔真实撮合成交**：当前仅在周末完成“挂单 $\rightarrow$ 查验 $\rightarrow$ 撤单”连通性测试，真实撮合 (`FILLED`) 与持仓落地必须在夜盘开盘后以真实可撮合价格成交验证。 |
| **风控与权限** | 绝对防止程序穿仓、防止错单、防止误报实盘、严禁无底仓卖出与日内巨额回撤 | `done-eng`：`assertPaperMode` 物理锁死，`AUTO_SUBMIT=false` 门禁，事前 $5k/10% 拦截，**已补齐卖单无底仓硬拦截 (RULE-007) 与账户日内千刀亏损熔断** | **已闭环**：单笔静态风控与账户日内动态最大回撤熔断已全部合流并单测通过。 |
| **策略决策规则 (Gap 3)** | 摒弃 MFE 幻想，从 388 笔真实成交反推提纯少而硬的交易规则集 | `done-eng`：**`hard_rules_engine.js` 落地 8 大实战硬规则集**（RULE-001 早盘低吸试探、RULE-002 尾盘防追高、RULE-003 半仓锁利、RULE-004 差价做T、RULE-005 保本损、RULE-006 正股压舱、RULE-007 底仓守卫、RULE-008 周哥/GEX分歧客观提示） | **已闭环并符合用户裁决**：采纳用户定案，周哥量化/GEX 分歧在 RULE-008 中输出 WARN 参谋预警，严禁代码越权直接硬拦截，将最终决断权完全交付人工（HITL）。 |
| **Alpha 与 SLM** | 大V言论意图语义分类与置信度打分进入决策前门 | `doing`：首轮 10% 黄金样本已提纯 (90 组)，待 GPU 物理微调 | **模型打分尚未挂入在线流**：当前意图生成仍依赖规则和正则前置过滤，SLM 意图置信度打分待模型微调后合流。 |

### 下一步决策推进顺序
1. **P0 (周一 08:00 CST 夜盘)**：运行 `night_market_kickoff.js`，报入 1 股 TSLA 限价单，验证首笔 `FILLED` 与持仓第一真源入库；
2. **P0.5 (周一盘中)**：卖出平掉该试仓，验证出场对账与底仓扣减闭环；
3. **P1 (首单走通后)**：开启赵哥喊单 $\rightarrow$ `TradeIntent` 流转通道，全面受控于 8 大硬规则引擎与 HITL 审核；
4. **P2 (周一白天)**：启动 WSL2 GPU 运行 SLM 飞轮重训，将意图语义置信度接管前门过滤。
