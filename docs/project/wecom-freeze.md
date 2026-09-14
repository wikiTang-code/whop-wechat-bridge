# 企微能力面冻结清单（REQ-018）

> 权威实现：`tools/local-ops/wecom/commands.js`  
> **扩面必须**：新 `CHG` + 单测 + 威胁说明（C0 即生产侦察面）+ 更新本表。见 REJ-008。

**冻结日**：2026-09-14 · Owner 初稿：`agent:cursor`

## 允许

| 用户命令 | 映射 id | 类 | 备注 |
|----------|---------|:--:|------|
| `/ops help` | — | — | 帮助文本 |
| `/ops whoami` | `ops.whoami` | C0 | |
| `/ops health` | `gcp.health_bundle` | C0 | 生产侦察面 |
| `/ops gex` / `status` / `sum` | `gex.summarize` | C0 | |
| `/ops gex fresh` | `gex.freshness` | C0 | |
| `/ops lm` | `lm.status` | C0 | |
| `/ops tunnel` | `lm.tunnel.status` | C0 | |
| `/ops boards` | `dash.list` | C0 | |
| `/ops pm2` | `gcp.pm2_status` | C0 | 生产侦察面 |
| `/ops resources` | `gcp.resources` | C0 | 生产侦察面 |
| `/ops git` | `gcp.git_head` | C0 | 生产侦察面 |
| `/ops collect` / `/ops gex run` | `gex.collect` | C1 | **唯一**企微 C1；异步+userid 白名单 |

`WECOM_C1_IDS` = `{ gex.collect }` 仅此。

## 明确拒绝（命令词 BLOCKED）

`restart` · `deploy` · `load` · `unload` · `tunnel-start` · `tunnel-stop` · `open` · `skip` · `align`

（以及任何未映射命令 → denied）

## 变更门禁

1. 改 `commands.js` 前先开 `CHG`。  
2. 同步改本表 + `test/test_local_ops_wecom_p4.js`。  
3. 新增 C0 生产类命令须在 CHG 写清侦察风险。  
4. **禁止**企微 C2（REJ-001）。

---

## 业务跟单 HITL（CHG-009 / REQ-029 · 独立通道）

> **物理隔离声明**：本节属于业务跟单人机协同流，**绝对不是** `/ops`，**绝对不是**运维 C2。它不进入 `commands.js`，不接入任何服务器维护指令。

| 通道/动作 | 实现路由/模块 | 鉴权风控与防护 | 备注 |
|-----------|---------------|----------------|------|
| 出站：待确认卡片 | `follow-hitl.js:generateFollowCardPayload` | 包含 90s TTL 倒计时、滑点 bp 提示、HMAC-SHA256 防篡改 Token | 仅限真实实盘决策触发 |
| 入站：确认执行 (`EXECUTE`) | `POST /api/follow/hitl-callback` | 1) `WECOM_FOLLOW_USERIDS` 白名单<br>2) Token 防篡改核验<br>3) 90s 超时判定<br>4) 防重放 (409) | 仅当携带 `isApprovedReal=true` 授权下单 |
| 入站：放弃本次 (`SKIP`) | `POST /api/follow/hitl-callback` | 同上白名单与 Token 校验 | 更新状态为 `SKIPPED_BY_USER`，不产生订单 |
| 入站：解析错误 (`PARSE_ERROR`) | `POST /api/follow/hitl-callback` | 同上白名单与 Token 校验 | 回写信号池为 `rejected`，不入实盘也不计大V持仓 |
| 超时废弃 (`SKIP_MANUAL_TIMEOUT`) | 状态机自动流转 | 超过 90 秒无操作自动销毁并拒单 (408) | 防止盘中因行情剧烈变化追高杀跌 |
