# R6 / T23 复核结论（Cursor，`f66f6b3`）

> 日期：2026-09-05。本地核心套件 PASS。

## 判定

| 项 | 结论 |
|---|---|
| T23 只读铁律 | **通过** |
| T20 契约形状 | **仍通过**（未回退） |
| T22 Basic Auth | **仍通过** |
| 生产切灰 | **条件批准**（须按 Runbook 人工执行，Cursor/Gemini 均不得擅自切） |

## 证据摘要

1. `readonly-api-router.js` 无 `getDb`；查询一律 `getReadOnlyArchiveDb()` + `dbInstance`。  
2. `database.js` / `trading.js` 读函数支持 `dbInstance`；默认仍兼容单体。  
3. `db-readonly.js` 注册 `has_image` / `has_link` / `is_text_only` / `cosine_dist`。  
4. 单测：静态零 `getDb` + 动态 `SQLITE_READONLY`；无 `[initDb]` 于只读路由请求路径。  
5. Runbook §1 含 Auth + Tunnel 红线。

## 切灰前人工检查（运维）

按 `docs/p1-11-rollout-runbook.md`：

1. `free -m` available ≥ 300  
2. 确认 `.env` 有 `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`  
3. 决定 `ENABLE_TUNNEL`（公网依赖则 `1`，否则 `0`）  
4. 部署本分支最新代码到 GCP（含 runners / monitoring / database.js）  
5. `ROLE=ingest_worker node scripts/ingest_runner.js --dry-run`  
6. **先** `pm2 stop whop-wechat-bridge`，**再** `pm2 start docs/ecosystem.p1-11.sample.cjs`  
7. 验收：`/health` 200、ingest ok、POST 写接口 403、RSS 合计 ≤200MB  
8. 观察 15 分钟；异常则 Runbook §5 回滚（禁 `pm2 delete all`）

## 残余观察（不阻断，切灰后盯）

- Web 仍 import `database.js` / `trading.js` 模块图 → 关注双进程 RSS。  
- `MOCK_TRADING_MODE=false` 时 quant 只读路由会打长桥 API（不写主库，但增加 web 外呼）。  
- `.gitignore` 增补 `data/gex/` 与 sidecar bin（与 T23 无关，可接受）。
