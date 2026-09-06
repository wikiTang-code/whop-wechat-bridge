# P2-15 软降级钩子 — 任务拆分（Gemini ∥ Cursor）

> 日期：2026-09-06  
> 基线：P2-13 互签归档（`32226ff` / `4be4e6b`）；consistency/page smoke 已挂 crontab。  
> 依据：加固计划 §7 项 15 + 红线 **R2/R5**（仅软降级/清理，严禁 `pm2 restart`）。  
> **P2-14 前端 `window.onerror` RUM 本轮刻意跳过**（计划标注最低优先级/可剔除）；需要时可另开薄轨。

---

## 0. 范围与红线

**做**
- 统一「软降级动作」登记与可观测：触发源 → 动作 → 恢复条件 → `/health` 可见
- 把已有碎片（背压 / AI 熔断 / 离线自愈派生）收成可审的钩子表 + 最小实现缺口补齐
- 交叉审阅 + 本地单测；上机须操作员确认

**不做**
- 任何自动 `pm2 restart` / `stop` / `kill`
- 自动删主库行、改水位、重下全量媒体
- P2-14 RUM、P2-16 DB 归档（另轮）
- 盘中自动拉重型离线同步（已有 `ENABLE_AUTO_OFFLINE_SYNC` 门闩，保持）

**已有可复用**
- `monitoring/backpressure-controller.js`（阶梯节流 + `pauseSecondaryWorkers`）
- `monitoring/ai-tunnel-circuit.js`（14B 探针挂起）
- `monitoring/supervisor.js` → `tryTriggerOfflineAutoSync`（周末/节假日 + cooldown）
- `monitoring/alert-sink.js` 边沿告警

---

## 1. 并行分工

| ID | 任务 | Owner | 并行组 | 交叉审阅 | 依赖 |
|---|---|---|---|---|---|
| **P2-15A** | 软降级缺口清单（动作白名单 / 触发源 / 未接线处） | **Cursor** | G0 | Gemini | — |
| **P2-15B** | 契约定稿：`subsystems.softDegrade` JSON 形状 + 允许动作枚举 | **Gemini** | G0 | Cursor | ✅ [`docs/p2-15-soft-degrade-contract.md`](./p2-15-soft-degrade-contract.md) |
| **P2-15C** | 钩子实现 / 接线补齐 + 单测（按契约） | **Gemini** | G1 | Cursor | 15B + 15A；可复用 `monitoring/soft-degrade-registry.js` |
| **P2-15D** | 挂入 `health.js` / dashboard + monitoring 小格（若契约要求） | **Cursor** | G1 | Gemini | ✅ 已挂载 `[11] softDegrade` |
| **P2-15E** | 可选：清理类钩子（日志/tmp 受控清理）+ 单测 | **Gemini** | G2 | Cursor | 15B 白名单 |
| **P2-15F** | 双方联调签字 | 双方 | G3 | 互签 | C+D 绿 |

```
G0: Cursor 15A  ║  Gemini 15B
G1: Gemini 15C  ║  Cursor 15D
G2: Gemini 15E（可选）
G3: 互签
```

---

## 2. 契约草稿（G0 交换，可修订）

### `subsystems.softDegrade`

```json
{
  "status": "ok|warn|unknown",
  "checkedAtMs": 0,
  "activeActions": [
    {
      "id": "backpressure_pause_secondary",
      "level": "warn",
      "sinceMs": 0,
      "reason": "event_loop_p99"
    }
  ],
  "allowedActions": [
    "backpressure_throttle_poll",
    "backpressure_pause_secondary",
    "ai_tunnel_suspend_probe",
    "offline_sync_spawn_weekend",
    "log_tmp_cleanup"
  ],
  "forbidden": ["pm2_restart", "pm2_stop", "process_kill", "db_destructive"],
  "description": "human readable"
}
```

聚合：仅抬 overall 至 **warn**，不单独 503（对齐 routeCoverage / dataConsistency）。

---

## 3. 验收

- [ ] 15A/15B 交叉审阅通过  
- [ ] 单测覆盖：允许动作可触发可恢复；禁止路径无 `pm2` 字符串  
- [ ] `/health`（或 dashboard）可见 `softDegrade`，无假绿  
- [ ] 15F 签字档 `docs/p2-15-p2f-signoff.md`

---

## 4. Owner 速记

| 角色 | 本轮先做 |
|---|---|
| **Cursor** | ✅ 15A；✅ 15B 审阅；✅ 15D 挂载（等 15C 接线） |
| **Gemini** | 推进 **15C**（接线 record/clear + AI/offline；勿 pm2） |
