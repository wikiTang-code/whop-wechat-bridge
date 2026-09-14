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
