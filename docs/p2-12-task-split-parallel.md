# P2-12 双进程路由覆盖 / 自动检测 — 任务拆分（Gemini ∥ Cursor）

> 日期：2026-09-06  
> 基线：`6a67348` 已修 L2 漏挂 + page smoke 单测；已推远端并部署 GCP。  
> 依据：`docs/p2-12-dual-process-gap-and-autofix.md`  
> 红线：R2/R5 — **只告警/软降级，禁止自动 `pm2 restart`**；本地↔GCP 脚本对称。

---

## 0. 范围

**做**
- 运行时 `routeCoverage` 探针进入 `/health`（及可选 dashboard）
- 看门狗扩展：本机关键页 API 冒烟，失败告警
- Tunnel URL 可观测（状态文件 / health 字段）
- 交叉审阅对方交付

**不做（本轮）**
- 不自动硬自愈 / 不改生产 ecosystem 根文件  
- 不重开 P2-11 UI 大改（仅消费新字段）  
- 不决定工作台 POST 白名单（P2-12f 产品另议）

---

## 1. 并行分工

| ID | 任务 | Owner | 并行组 | 交叉审阅 | 依赖 |
|---|---|---|---|---|---|
| **P2-12a/b** | L2 挂载 + page smoke（已合入） | Cursor | — | — | ✅ |
| **P2-12c** | `routeCoverage` 探针模块 + 挂入 `/health` | **Cursor** | G0 | Gemini | 12b |
| **P2-12d** | `scripts/watchdog/page_smoke.sh` + 告警文案 + README | **Gemini** | G0 | Cursor | ✅ `76f96bb` 审过 |
| **P2-12e** | Tunnel URL 落盘 + health/dashboard 字段 | **Gemini** | G1 | Cursor | ✅ `76f96bb` 审过 |
| **P2-12g** | monitoring 页展示 routeCoverage 格（小改） | **Cursor** | G1 | Gemini | ✅ 本提交 |
| **P2-12h** | 联调清单 + 互签 | 双方 | G2 | 互签 | ✅ `docs/p2-12-p2h-signoff.md` |

```
G0:  Cursor 12c  ║  Gemini 12d（按下方契约草稿写脚本）
G1:  Gemini 12e  ║  Cursor 12g
G2:  交叉审阅 → 12h 签字 → 再议是否上机（本轮允许 GCP，但改动须先合入再 pull）
```

---

## 2. 契约草稿（G0 交换用）

### `subsystems.routeCoverage`（进 `/health`）

```json
{
  "status": "ok|warn|critical|unknown",
  "checkedAtMs": 0,
  "baseUrl": "http://127.0.0.1:8085",
  "failCount": 0,
  "paths": [
    { "path": "/api/l2a/dates", "httpStatus": 200, "ok": true, "ms": 12 }
  ],
  "description": "human readable"
}
```

规则（初版）：
- 任一路径 **Express 未挂载**（body 含 `Cannot GET` 或 status 404 且非「业务空」约定）→ 该 path `ok:false`
- `failCount >= 1` → `warn`；`failCount >= 2` 关键路径失败 → `critical`
- 探针失败（连不上本机）→ `critical`
- **TTL 缓存** 默认 30s，避免每次 `/health` 打爆自己
- 只打 `127.0.0.1`，不走 Tunnel

关键路径最小集与 `docs/p2-12-dual-process-gap-and-autofix.md` §3.2 一致。

### 看门狗 `page_smoke.sh`（Gemini）

- 输入：`BASE_URL`（默认 `http://127.0.0.1:8085`）
- 对最小路径集 curl；失败调用现有 `watchdog_alert.sh`（文案含「页壳假绿/路由漏挂」）
- **禁止** `pm2 restart`
- 可选 cron：可先文档说明，不强制改生产 crontab（须用户确认）

### Tunnel（Gemini 12e）

- `tunnel-launcher` 将当前 URL 写入 `data/runtime/tunnel_url.json`（或现有约定路径）
- health 增加 `subsystems.tunnel: { status, url, updatedAtMs }`
- URL 缺失且 `ENABLE_TUNNEL=1` → `warn`

---

## 3. 文件所有权（防撞车）

| 文件 | Owner |
|---|---|
| `monitoring/route-coverage-probe.js` | Cursor |
| `scripts/web_runner.js`（仅接 routeCoverage） | Cursor |
| `monitoring/health.js`（注入点，尽量薄） | Cursor |
| `test/test_route_coverage_probe.js` | Cursor |
| `scripts/watchdog/page_smoke.sh` | Gemini |
| `scripts/watchdog/README.md` | Gemini |
| `monitoring/tunnel-launcher.js` | Gemini |
| `public/monitoring.js` / html 小改展示格 | Cursor（12g） |
| `docs/p2-12-*-review.md` | 审阅方 |

---

## 4. 验收

- [x] `node test/test_route_coverage_probe.js` PASS  
- [x] 本地 `/health` 含 `subsystems.routeCoverage`  
- [x] 人为卸挂 L2 后 probe → warn/critical（单测 mock）  
- [x] `page_smoke.sh` dry-run 文档完整  
- [x] Tunnel URL 文件与 health 字段一致  
- [x] 交叉审阅两份 `docs/p2-12-*-review.md` 签字  
- [x] P2-12h 联调清单互签归档（`docs/p2-12-p2h-signoff.md`）  

---

## 5. 给 Gemini 的即时指令（复制即用）

1. 拉取 `feat/p1-attachments-and-ratelimiter` @ `6a67348`+  
2. 按本文 §2 实现 **P2-12d**（page_smoke）与 **P2-12e**（tunnel URL）  
3. 勿改 `route-coverage-probe.js` / 勿扩大 `web_runner` 职责到告警  
4. 完成后发 PR 或同分支提交，并写 `docs/p2-12-p2d-selfcheck.md` 自检清单供 Cursor 审  
