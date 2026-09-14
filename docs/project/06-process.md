# 06 — 开发流程框架 · 文档维护 · 提交 SOP

> 上级：[`README.md`](./README.md)

---

## 1. 需求生命周期

```
发现 → 04 记债/问题（可选）→ 03 登记 REQ/CHG/REJ
    → human/联审 accepted
    → 05 认领（一人一 REQ）
    → 实现 + 自测
    → 07 如需审阅
    → commit（带 REQ-NNN）→ 03 done + 05 Done + 02 刷新
```

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
