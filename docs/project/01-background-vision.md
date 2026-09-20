# 01 — 背景 · 目标 · 展想 · 非目标

> 上级索引：[`README.md`](./README.md) · 相关：[`02-current-state.md`](./02-current-state.md)

---

## 1. 背景（为什么有这个仓库）

本项目起源于 **Whop 社群情报 → 本机/云端 AI 提炼 → 企业微信触达 →（可选）券商跟单** 的个人量化辅助闭环。

现实约束：

- **生产**跑在资源紧张的 **gcp-vm**（双进程：ingest 写路径 + dashboard 只读），不宜再堆 Agent/MCP 宿主。
- **本机 Windows** 承担富途 OpenD GEX 拉链、LM Studio、企微回控反向隧道等「重活」。
- **手机企微**是最高频的移动观察入口，但处于公网与丢失风险面，**不能**当全能控制台。
- 多模型 / 多 Agent（Cursor、Gemini、Grok…）并行改同一仓库时，若无统一账本，极易 **重复、冲突、遗漏、聊天里的结论丢失**。

因此需要：**一套能力分层 + 一份可协同的文档树 + 一条可重复的开发流程**。

---

## 2. 核心目标（要达成什么）

| # | 目标 | 成功样子 |
|---|------|----------|
| G1 | 业务闭环稳定 | 大V消息可归档、可推送、可 AI 提取；跟单受规则/沙盒约束 |
| G2 | 可观测可止血 | `/health`、`/monitoring`、冒烟、软降级；告警≠自动破坏性重启 |
| G3 | 结构雷达可用 | GEX King/Floor/Regime 人本机可采、看板/企微可看摘要；**不下单** |
| G4 | 安全运维面 | Local-Ops catalog；MCP/Skill/CLI/企微都是适配器；生产 C2 HITL |
| G5 | 多 Agent 不互踩 | 需求/WIP/遗留/审阅同一文档树；热点路径有锁 |

---

## 3. 展想（中期方向，非当前承诺）

按优先级递进，**不等于已排期开工**：

1. **P5 券商只读**：账户/持仓/订单只读进 catalog（`REQ-005`）。  
2. **P6 本机运维页**：浏览器看网关/隧道/健康（`REQ-006`）。  
3. **GEX 开盘自动化 + 产物同步 GCP 看板**（`REQ-003`/`REQ-004`）——同步方式待定，**永不在 GCP 跑 OpenD**。  
4. **主库治理**（`REQ-008`）：FTS/归档，控制 SQLite 体积。  
5. **NL 只读 Copilot**（`REQ-007`）：仅无 `/` 的闲聊走模型调 C0；`/ops` 仍秒级直达。  
6. **远期业务**：uSMART、Python 回测（`REQ-009`/`REQ-010`）。  
7. **L1 跟单 HITL + 三账本 + Paper 状态机**（`REQ-027`～`029`）——方案见 [`follow-hitl-plan.md`](./follow-hitl-plan.md)；对齐既有 `follow_execution_spec.md`。  
8. **更完整的事故手册**：回滚判据、密钥轮换、企微 IP 变更（见遗留 [`04`](./04-leftovers-problems.md)）。

---

## 4. 非目标 / 明确不做（展想反面）

| 不做 | 原因 |
|------|------|
| 企微开放 C2（restart/deploy/load） | 手机攻击面；`REJ-001` |
| Agent 自治闭环运维 | 幻觉与雪崩；`REJ-002` |
| catalog 出现 `place_order` | 资金红线；`REJ-003` |
| 告警/看门狗调用 C2 | R2；`REJ-004` |
| 在 gcp-vm 部署 MCP/Agent 宿主 | 资源与边界；`REJ-006` |
| GCP 上跑 GEX OpenD 拉链 | 同上 |
| 用自然语言替换 `/ops` 作为主路径 | 延迟与不确定；伤害盘中体验 |
| 把 CHG-050 / 转弯检测器当发令枪或 `AUTO_SUBMIT` | 未过置换；`CHG-051` |
| 把赵哥口播价写成我方成交价 | 成交后广播；评估必须用 `t_arrive` |

---

## 5. 架构心智模型（给所有 Agent）

```
[业务守护面]  常驻进程，不是「调用一下」的 RPC
     │
[本机能力网关] catalog.yaml → gateway → adapters
     │              ▲
     │     MCP / Skill / CLI / HTTP / 企微 只是适配器
     │
[企微窄面]   文本 /ops → 白名单映射（C0 + collect）
```

原则：**Skill 负责何时解读；MCP/CLI 负责动手；网关 ACL 才是强制点；Hook 是加防。**

---

## 6. 核心数据源与双大V定位架构（不可违背）

系统确立「核心主线实盘大V」与「自研量化参考参谋」双轨定位：

1. **核心主线实盘大V：赵哥 (`xiaozhaolucky`)**
   - 物理 ID 绝对硬锁：`sender_id = 'user_4yeplXgbguTu4'`，严禁模糊匹配；
   - 知识与发言：**全频道采集**（提炼多模态K线卡片、大盘时空预期、三三法则）；
   - **实盘交易单 (Trade Signals / 跟单流水)**：**目前严格仅限两大专属频道**：
     - ① **「历史股票期权记录区」** (`forum_feed_1CTr7SqVMzFfuFiiRJLEHN`)
     - ② **「不用翻墙期权」** (`chat_feed_1CTrCEx44dP13jW3RVkYiS`)  
     其他任何频道的消息一律不得作为正式交易单。

2. **客观量化参考参谋：周哥 (`Mrzhoulucky`)**
   - 物理 ID：`user_HnSG7BJWMTfDz`；
   - 阵地：**「美股工具箱」**（「日内波段信号检测」`chat_feed_1CaEnj8...`、「股票分析」`chat_feed_1CaPyASf...` 等）；
   - 定位：持续播 QQQ（及选股）**模拟仓**——短/中线批次、买入卖出价、累计盈亏、自报胜率。这是可验证的 L2b 参考频道（`hint_only`），**不是**赵哥实盘跟单，**禁止**写入 `trade_signals` / L2a。
   - 已有隔离回放：`data/runs/mrzhou_strategy/QQQ_HINT_REPLAY.md`（须带牛市窗声明）。

3. **自研参考播报（CHG-051 · 不是第三条大V）**
   - 角色对齐周哥**模拟仓频道**（持续播、可回测、默认为 `REFERENCE_ONLY`），不是对齐赵哥成交后广播；
   - 特征只许 OHLCV / 波动 / 量能；禁止把大V文本写进检测器；
   - **不替代**赵哥跟单执行链。次序与禁令见 [`dual-track-operating-contract.md`](./dual-track-operating-contract.md)。

---

## 7. 文档在体系中的位置

- **本文树** = 项目「项目管理 + 协同」层。  
- **专题方案**（local-ops / hardening / gex）= 设计真相。  
- **代码与 catalog** = 运行真相。  
冲突时：运行与红线代码 > 专题方案 > 本文树状态表；但 **状态表必须尽快回写**，避免人/Agent 读到过期叙事。
