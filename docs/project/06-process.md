# 06 — 开发流程框架 · 文档维护 · 提交 SOP

> 上级：[`README.md`](./README.md)

---

## 1. 需求生命周期

```
发现 → 04 记债/问题（可选）→ 03 登记 REQ/CHG/REJ
    → human/联审 accepted
    → 05 入列本 Agent 高优队列（§0.A/§0.B）/认领
    → 实现 + 自测
    → commit（带 REQ-NNN）→ 03 done + 05 出队 + 接续
    → （累计≥N 或专题包关闭）移交对方 §0.R 审修 → 07 意见 → 修复闭环
```

### 1.1 高优队列流转与接续 SOP（双 Agent · 长期固定）

[`05-wip-board.md`](./05-wip-board.md) §0 设立 **两条** Priority In-Flight 队列：

| 队列 | Owner 前缀 | 容量 | 说明 |
|------|------------|:----:|------|
| **§0.A** | `agent:cursor` | 1～2 | Cursor 会话只改本队列行 |
| **§0.B** | `agent:gemini` | 1～2 | Gemini 会话只改本队列行 |
| **§0.H** | `human` | 按需 | 生产 ff / HITL；不占 Agent 名额 |

**互斥（强制）**

1. 同一 `REQ`/`CHG` **不得**同时出现在 §0.A 与 §0.B。  
2. 同一**热点路径**（见 §2）同时仅允许一个队列项为 `Doing`。  
3. 入队前勾选 05 §0「互斥检查清单」；冲突则改拉候选池下一项或切片并行（须 Human 批）。

**接续**

1. 本队列任务 Done 出队后，该 Agent **必须**从共享候选池评估下一项；  
2. 互斥校验通过后，**主动问 Human**是否入本队列并开工；  
3. 确认后：05 §0 本队列翻牌 + 主看板 Owner/`Doing` + 03=`in_progress`；  
4. **禁止**静默改另一 Agent 的队列行（REJ-010 / 认领协议）。

**文档树感知**：`README` 一页总览必须镜像 §0.A / §0.B / §0.R；聊天结论不算数。

### 1.2 交叉 Review+修复队列（Peer Review · `CHG-012`）

作者 Agent 的开发队列与对方的 **审修队列** 分离：

| 队列 | 审修方 | 审谁的产物 |
|------|--------|------------|
| **§0.R-A** | `agent:cursor` | Gemini 已 Done 出队包 |
| **§0.R-B** | `agent:gemini` | Cursor 已 Done 出队包 |

**触发条件（满足任一）**

1. **计数阈值**：作者自「上次成功移交」起，累计 Done 出队 Task **≥ 5**（默认；Human 可在 05 改阈值）；  
2. **专题/特性包**：同组关联 Task 全部关闭（例：follow-HITL Phase A～D；安全 runbook 包 REQ-015～020）。可提前触发，不必等满 5。

**移交 SOP**

1. 作者在 05 更新「移交计数」表，将本批 ID 列表写入对方 §0.R，状态 `Queued`；计数清零。  
2. 向 Human 简报：「【交叉审修】已将 `[IDs]` 移交对方 §0.R」。  
3. 审修方：读 diff / 相关 runbook → 写 [`07-review-inbox.md`](./07-review-inbox.md) → 必要修复（热点互斥仍生效）→ 状态 `Reviewing`/`Fixing`→`Done`。  
4. 重大缺陷：开新 `REQ`/`CHG` 或打回作者开发队列（须 Human 可见）；**禁止**审修方静默改对方正在 Doing 的热点。  
5. `README` 同步镜像 §0.R 非空批次。

**与 07 的关系**：07 收意见；§0.R 管「谁在审哪一批、是否在修」；落地修复仍须进 03。

---

## 2. 热点路径锁

| 热点 | 默认车道 | 规则 |
|------|----------|------|
| `tools/local-ops/**` | L4 | 同时 1 个 Doing Owner |
| **`tools/local-ops/catalog.yaml`** | L4 | **独占**；变更必须独立 REQ/CHG（REQ-025） |
| `tools/gex-sidecar/**` | L3 | collector 改动独占 |
| `monitoring/**` | L2 | 契约变更喊 L1 |
| ingest / `server.js` 写路径 | L1 | 最高冲突区 |
| `brokers/**` | L1 或 L5 | P5 优先新文件 |
| `docs/project/05*.md` | L0 | 高频；只追加/改自己的行 |
| `docs/project/07*.md` | L0 | 审阅专用；与 05 解耦 |
| `docs/project/03*.md` | L0 | 追加新行优先；少改历史行 |
| **`test/**`** | 各车道 | **测试隔离**：新特性优先新建独立文件（如 `test/test_local_ops_p5.js`）；**严禁**两 Agent 同时改同一公共大单测（如 `test_readonly_api_routes.js`） |
| 生产 HITL / `.env` | human | Agent 不得代行 approve（REJ-007） |

---

## 3. 进度文档并发协议（`REQ-023`）

1. **禁止**无认领大段重排/重写整树。  
2. 多 Agent 默认可并行：**各改各的文件**（05 vs 07 vs 03 追加）。  
3. 同文件：只改自己负责的表格行；冲突时 **后写方 rebase，保留双方新增行**。  
4. 大重构 `docs/project/**`：先在 05 认领 `REQ`（如 meta），完成前他人只追加。  
5. REJ-010：无协议大段并行改总控 = 拒绝。

---

## 4. `data/gex` 提交 SOP（`REQ-024`）

- 允许入库：`data/gex/latest.json`（**仅里程碑**，见下）  
- 禁止：`*.html`、`snapshot_*.json`、其它大快照  
- **严禁盘中/定时拉链每次 commit**（污染历史）；日常产物留本地，上云走同步配方（REQ-004）  
- **可 commit 的时机**：基准打桩、发版验证、重大结构/schema 变动  

**每次提交前**：

```text
git status
# 确认无 data/gex/*.html
# 确认本次若含 latest.json，属于里程碑而非例行采集
# 禁止习惯性 git commit -a
```

---

## 5. 测试最低线

| 车道 | 最低验证 |
|------|----------|
| L4 | `npm run test:local-ops` |
| L3 | OpenD 可达时 collect；或只读 API |
| L2 | 相关 smoke 无新假阳性 |
| L1 | 不破坏双进程只读边界 |
| L5 | 无下单符号；建议 CI grep |
| L6 | 仅 `127.0.0.1` |

---

## 6. 发布 / HITL 可执行清单（`CHG-006`）

> 细则与超时/失败分支：[`runbooks/hitl-c2.md`](./runbooks/hitl-c2.md)（REQ-015）  
> 对齐后是否重启：[`runbooks/deploy-restart.md`](./runbooks/deploy-restart.md)（REQ-019）  
> 事故回滚：[`runbooks/incident-rollback.md`](./runbooks/incident-rollback.md)（REQ-016）

### 6.1 分层（勿混用）

| 层 | 门禁 | 谁执行 |
|----|------|--------|
| 本机 C2（lm / tunnel 等） | `confirm_token`（约 60s） | 本机操作者；非生产 |
| 生产 C2（`gcp.deploy_align` / `gcp.pm2_restart`） | invoke → **human** `human-approve` → confirm | **仅 human**；Agent 禁代跑（`REJ-007`） |
| 企微 `/ops` | 仅 C0 + `gex.collect` | **不承载** C2 / 不消耗 token（`REJ-001`） |

### 6.2 标准四步（对齐 → 验证 → 具名 restart → 记录）

按序勾选；默认 **只对齐、不重启**（例外见 REQ-019 表）。

**A. 对齐前**

- [ ] 目标 SHA 已在 `origin/main`（40 hex）
- [ ] 相关测试已绿（动 L4：`npm run test:local-ops`）
- [ ] 无密钥 / `.env` / GEX HTML 夹带进将要对齐的提交
- [ ] 窗口可接受（开盘活跃期非紧急：慎动 ingest worker）

**B. 对齐**

- [ ] 执行生产对齐：`ff` 或 HITL `gcp.deploy_align`（参数含目标 SHA）
- [ ] **禁止** Agent 代跑 `human-approve`；禁止企微确认 C2

**C. 验证（对齐后）**

- [ ] `gcp.git_head` 或现场 `git rev-parse HEAD` = 目标 SHA
- [ ] 按 REQ-019 判定：docs-only → **不重启**；否则 human 决定具名进程

**D. 具名 restart（仅当 C 判定需要）**

- [ ] HITL：`invoke` → human `human-approve` → `confirm`（白名单进程名）
- [ ] 告警 / 看门狗 / Agent **不得**触发 restart（`REJ-004` / `REJ-009`）
- [ ] 重启后：`/health` + 相关冒烟；异常走 REQ-016

**E. 记录**

- [ ] human 在 [`05` Ops 审计行](./05-wip-board.md) 填写：时间 / human / 动作 / 目标 / 结果 / 备注（对齐 REQ-020 字段）
- [ ] Agent 仅可提醒填表，**不得**声称「已 approve」除非 05 行已由 human 写入（`REJ-007`）

### 6.3 No-Go（任一条即停）

- 目标 SHA 不在 origin 或不明确  
- Agent / 告警要求代跑 approve 或企微点 C2  
- 无具名进程、或拟重启名单超出白名单  
- human 未在维护窗口确认  

---

## 7. 文档维护 SOP

| 何时 | 改什么 |
|------|--------|
| 新需求/变更/拒绝 | 03 |
| 发现坑未立项 | 04 |
| 认领/进度 | 05 |
| 联审结论 | 07 → 再落 03 |
| 主线事实变化 | 02 |
| 背景/展想变化 | 01 |
| 流程变化 | 06 + CHG |

专题方案（local-ops / hardening / gex）保持原位；03 必须有指针。

---

## 8. 提交说明格式

```
docs(project): REQ-014 land docs/project tree

feat(local-ops): REQ-018 wecom freeze table
```

独立文档 commit：**不夹带** GEX HTML、`.env`、`scratch` 草稿（除非明确 REQ）。

**默认收工 Git（人已授权为长期自动任务）**：REQ/CHG 落地且自检通过 → 回写 `docs/project/` → commit → `git push origin HEAD`。勿等用户再催；生产 ff / C2 HITL 除外。
