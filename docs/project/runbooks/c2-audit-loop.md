# Runbook：C2 审计与看板闭环规范（REQ-020）

> **责任与归属**：Owner: `agent:gemini` · 审阅基准：2026-09-14  
> **核心关联**：[`tools/local-ops/gateway.js`](../../../tools/local-ops/gateway.js) · [`docs/project/05-wip-board.md`](../05-wip-board.md) · [`runbooks/hitl-c2.md`](./hitl-c2.md)  
> **红线约束**：`REJ-007`（严禁 Agent 纸面冒充「已 HITL」）· `REJ-001`（企微严禁涉足 C2）

---

## 1. 为什么需要 C2 审计与看板闭环？

生产 C2 操作（如 `gcp.pm2_restart`、`gcp.deploy_align`）直接影响线上生产业务与服务可用性。为杜绝以下高危隐患：
1. **Agent 虚假回执（Paper Approval）**：Agent 在回复中谎称已完成人类审批，导致非受控变更；
2. **操作不可溯**：运维人员执行了热重启或代码对齐，但未留痕，引发后续排障混乱；
3. **参数篡改或重放**：执行参数与批准参数不一致。

系统设计了 **「本地网关自动留痕（Machine Audit）」 + 「项目看板手工闭环（Human Board）」** 的双向证据链。

---

## 2. 字段映射模型（Schema Alignment）

网关内部结构化日志（`tools/local-ops/audit/audit.log`）与项目协同看板（`docs/project/05-wip-board.md` §3 Ops 审计行）字段严格一一映射：

| 05 看板 Ops 审计行字段 | 网关 Audit 字段 | 含义与示例 |
|------------------------|-----------------|------------|
| **时间 (UTC+8)** | `ts` | 操作发生时间（网关存 ISO 8601，看板换算为本地 UTC+8），如 `2026-09-14 19:42 (UTC+8)` |
| **human** | `actor` / `human_acked` | 真实人类操作者标识（如 `@wikitang`，严禁填写 Agent 名称） |
| **动作** | `id` | 调用的能力 ID（如 `gcp.pm2_restart`、`gcp.deploy_align`） |
| **目标** | `target` | 操作目标实体（进程名 `whop-web-dashboard` 或 40 位小写 SHA） |
| **结果** | `ok` / `error` | 执行结果状态（`ok` 或具体错误原因 `bad_args` 等） |
| **备注** | `token_prefix` + 说明 | Token 前缀（如 `token:3i7G613N`）及本次变更意图说明 |

---

## 3. 网关审计日志机制（Gateway Audit Logging）

### 3.1 自动捕获与脱敏
本地网关在每一次 C2 关键生命周期事件触发时，自动以 JSON Lines 格式追加写入 `tools/local-ops/audit/audit.log`（该文件已被 `.gitignore` 排除，杜绝代码泄露）：
- **`issue_confirm_token`**：生成 C2 执行凭据时记录（含目标、入参哈希与脱敏参数）；
- **`human_approve`**：人类在本地终端签署审批时记录（含 Token 前缀与签署时间）；
- **`execute_c2`**：凭据消费与生产 SSH 配方执行后记录（含是否有人类门禁 `human_gated: true` 与执行状态）。

### 3.2 审计查询工具（CLI）
运维人员或 Agent 可通过 CLI 工具快速查阅最近的 C2 审计流水：
```powershell
node tools/local-ops/cli.js audit 10
```

**输出示例**：
```json
[
  {
    "ts": "2026-09-14T11:42:20.217Z",
    "event": "issue_confirm_token",
    "id": "gcp.pm2_restart",
    "class": "C2",
    "token_prefix": "3i7G613N",
    "requires_human": true,
    "target": "whop-web-dashboard",
    "args": { "name": "whop-web-dashboard" }
  },
  {
    "ts": "2026-09-14T11:42:20.218Z",
    "event": "human_approve",
    "id": "gcp.pm2_restart",
    "token_prefix": "3i7G613N",
    "ok": true
  },
  {
    "ts": "2026-09-14T11:42:20.219Z",
    "event": "execute_c2",
    "id": "gcp.pm2_restart",
    "class": "C2",
    "token_prefix": "3i7G613N",
    "human_gated": true,
    "target": "whop-web-dashboard",
    "args": { "name": "whop-web-dashboard" },
    "ok": true,
    "error": null
  }
]
```

---

## 4. 人工看板闭环 SOP（10 分钟闭环）

在生产 C2 执行完毕后，操作人必须完成最后一道人机协同闭环：

### 步骤 1：获取审计凭证
从 CLI 执行输出或通过 `node tools/local-ops/cli.js audit 1` 获得刚执行的 `token_prefix` 与状态。

### 步骤 2：编辑看板
打开 [`docs/project/05-wip-board.md`](../05-wip-board.md)，定位到 **§3 Ops 审计行**，在表格底部追加一行：

```markdown
| 2026-09-14 19:42 (UTC+8) | @wikitang | gcp.pm2_restart | whop-web-dashboard | ok | token:3i7G613N 发布看板只读修复 |
```

### 步骤 3：提交文档记录
将该看板更新随日常任务一同提交（或独立提交 docs commit）。

---

## 5. 绝对红线与合规审查（REJ-007）

1. **防纸面审批（No Phantom HITL）**：
   - Agent **绝对不得**代跑 `node tools/local-ops/cli.js human-approve`；
   - 任何 Agent 在审阅代码或推动流程时，**只有在 05 看板已存在对应行且网关 audit 记录匹配**的情况下，方可认定生产变更已合法生效。
2. **防参数篡改**：
   - 网关强制校验 `args_hash`。若 confirm 时参数与提议时不符，网关直接阻断并产生报警审计。
3. **定期核对**：
   - 迭代复盘时，管理员可对比 `git log` 中的生产版本发布记录与 `05-wip-board.md` 审计行，确保 100% 对应。