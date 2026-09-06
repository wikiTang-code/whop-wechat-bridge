# P2-12d / P2-12e 交叉审阅（Cursor）

> 审阅对象：`76f96bb` on `feat/p1-attachments-and-ratelimiter`  
> 依据：`docs/p2-12-p2d-selfcheck.md` + `docs/p2-12-task-split-parallel.md`  
> 日期：2026-09-06  

---

## 判定

| 项 | 结论 |
|---|---|
| P2-12d page_smoke | **通过** |
| P2-12e tunnel 落盘 + `/health.subsystems.tunnel` | **通过** |
| 可进入 P2-12g | **批准** |

本地复跑：`test_page_smoke_watchdog` / `test_tunnel_launcher` / `test_route_coverage_probe` 全部 **PASS**。

---

## 核对要点

| 检查 | 结果 |
|---|---|
| 8 路径与 `DEFAULT_ROUTE_COVERAGE_PATHS` 一致 | ✅ |
| `page_smoke.sh` 无 `pm2 restart` / `pm2 stop` | ✅ |
| 告警文案含「页壳假绿/路由漏挂」 | ✅ |
| 边缘触发 + 恢复告警 | ✅ |
| 未改 `route-coverage-probe.js` / 未扩 web 告警职责 | ✅ |
| `data/runtime/` 已 gitignore | ✅ |
| `ENABLE_TUNNEL=0 → off`；`=1` 无 URL → `warn` 抬 overall warn 不 503 | ✅ |
| 与 R2 一致：硬告警交给 page_smoke，health 只观测 | ✅ |

---

## 非阻断备注（不挡 12g）

1. **`getTunnelStatus()` 内存命中时**可能不带 `port`/`description`，与自检样例略有出入；看板应容错缺字段。  
2. **进程刚重启 + 磁盘 stale URL**：fallback 读盘可能短暂显示旧 URL（quick tunnel 已换域）；12g 展示可加「以落盘时间为准 / 重启可能换域」提示。  
3. **401 当挂载成功**：与 routeCoverage「非 404 即挂上」语义一致，正确。  

无需 Gemini 返工；可选后续 polish。

---

## 下一步

- Cursor **P2-12g**：monitoring 页增加 `routeCoverage` + `tunnel` 格，dashboard-api 透传。  
- 合入后双方可签 P2-12h 联调清单；crontab 挂 page_smoke **须用户确认**后再上生产。
