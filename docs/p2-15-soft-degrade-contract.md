# P2-15B：软降级钩子契约（定稿）

> **所属阶段**：P2-15 软降级钩子（G0 契约定稿）  
> **责任方**：Gemini（起草定稿）∥ Cursor（交叉审阅并消费）  
> **依据**：`docs/p2-15-task-split-parallel.md` / `docs/p2-15-soft-degrade-gap-checklist.md` (15A)  
> **红线**：R2/R5 — 只允许安全可控的软降级/轻量清理；**绝对禁止任何形式的 `pm2 restart` / `stop` / 进程重启硬自愈**。  
> **日期**：2026-09-06  

---

## 1. 目标与定位

软降级（Soft Degrade）用于在系统遭遇局部过载、网络抖动或上游依赖断线时，通过**减载、降频、挂起非关键后台任务**来维持主干业务链路可用，而不是简单粗暴地重启进程（这会导致任务重做、内存震荡与假死）。

本契约对全系统现存与新增的软降级动作建立统一的**状态注册、白名单约束与可观测视图**：
- 聚合进入 `/health` 系统的 `subsystems.softDegrade`；
- 向 monitoring 看板提供一等公民级别的动作感知；
- 建立严格的白名单与禁令表，防止越权硬自愈。

---

## 2. 动作白名单与禁令枚举（White / Black List）

### 2.1 允许的动作白名单（`allowedActions`）

| 动作 ID (`id`) | 所属模块 / 现有基础 | 触发条件 | 软降级行为 | 恢复条件 |
|---|---|---|---|---|
| `backpressure_throttle_poll` | `monitoring/backpressure-controller.js` | event-loop p99 高 / HTTP 响应慢 | 阶梯式拉长 Ingest 轮询等待间隔（减载） | 连续健康检查达标（`healthyStreak >= 3`）阶梯恢复 |
| `backpressure_pause_secondary` | `monitoring/backpressure-controller.js`<br>（`shouldPauseSecondaryWorkers`） | 背压等级进入 `TIER_1` 或 `TIER_2` | 暂时挂起次要 Worker（如 Persona 定时分析、图片离线回填），保障主干入库 | 背压回退至 `NORMAL` 状态即刻自动解冻恢复 |
| `ai_tunnel_suspend_probe` | `monitoring/ai-tunnel-circuit.js` | 14B 本地/云端 AI 连续失败熔断 | 挂起对 AI 服务的探测与推理消费，走快速旁路或暂存 | 熔断冷却期过后单次探测探活成功，熔断器闭合恢复 |
| `offline_sync_spawn_weekend` | `monitoring/supervisor.js`<br>（`tryTriggerOfflineAutoSync`） | 资产 critical + 周末/节假日 + `ENABLE_AUTO_OFFLINE_SYNC=1` + 24h cooldown | 派生（spawn）一次性离线补录子进程（非重启当前服务） | 子进程执行完毕退出；具有 24 小时硬冷却防重入 |
| `log_tmp_cleanup` (可选 15E) | 独立受控清理钩子 | 临时文件积压（如 `/tmp/whop_*`）或超龄日志过大 | 仅清空指定匹配的无害临时文件；**严禁碰 `data/` 与 `*.db`** | 清理后释放空间，重置状态 |

### 2.2 绝对禁止的行为（`forbidden`）

在任何软降级场景下，系统必须在代码与契约中明确禁止以下高危动作：
- `pm2_restart`（严禁自动调用 `pm2 restart` 重载服务）
- `pm2_stop`（严禁自动停止服务）
- `process_kill`（严禁杀父进程或杀死常驻守护进程）
- `db_destructive`（严禁自动删除数据库行、清空表或修改同步水位）

---

## 3. `/health` 与 Dashboard 契约 JSON 格式

挂载路径：`subsystems.softDegrade`

```json
{
  "status": "ok",
  "checkedAtMs": 1757143000000,
  "activeActions": [],
  "allowedActions": [
    "backpressure_throttle_poll",
    "backpressure_pause_secondary",
    "ai_tunnel_suspend_probe",
    "offline_sync_spawn_weekend",
    "log_tmp_cleanup"
  ],
  "forbidden": [
    "pm2_restart",
    "pm2_stop",
    "process_kill",
    "db_destructive"
  ],
  "description": "System operating normally with no soft-degrade actions active",
  "notes": "safe_soft_degrade_only, zero_pm2_restart"
}
```

### 当发生软降级动作时的快照示例：
```json
{
  "status": "warn",
  "checkedAtMs": 1757143000000,
  "activeActions": [
    {
      "id": "backpressure_pause_secondary",
      "level": "warn",
      "sinceMs": 1757142990000,
      "reason": "event_loop_lag_p99_tier1",
      "detail": "Secondary workers paused due to event-loop lag (p99 > 150ms)"
    },
    {
      "id": "ai_tunnel_suspend_probe",
      "level": "warn",
      "sinceMs": 1757142950000,
      "reason": "ai_tunnel_circuit_open",
      "detail": "AI tunnel probe suspended in open state (consecutive failures >= 3)"
    }
  ],
  "allowedActions": [
    "backpressure_throttle_poll",
    "backpressure_pause_secondary",
    "ai_tunnel_suspend_probe",
    "offline_sync_spawn_weekend",
    "log_tmp_cleanup"
  ],
  "forbidden": [
    "pm2_restart",
    "pm2_stop",
    "process_kill",
    "db_destructive"
  ],
  "description": "2 soft-degrade action(s) active: backpressure_pause_secondary, ai_tunnel_suspend_probe",
  "notes": "safe_soft_degrade_only, zero_pm2_restart"
}
```

---

## 4. 评级与健康聚合规则

### 4.1 探针状态判定（禁止假绿）
- **`ok`**: `activeActions.length === 0`，所有子系统正常全速运行；
- **`warn`**: `activeActions.length > 0`。**铁律**：只要有任何降级动作处于激活状态，`status` 必须至少为 `warn`，绝不允许呈现假绿 `ok`！
- **`unknown`**: 探针无法连接或获取降级状态（如跨进程句柄未就绪）。

### 4.2 `/health` 整体聚合影响（软降级）
- 当 `subsystems.softDegrade.status === 'warn'` 时：
  - 仅将整体 `/health.status` 提升至 `'warn'`；
  - **HTTP 状态码必须保持 200**；
  - **绝不**因为有软降级动作而返回 503，确保外部监控（如看门狗）不会将其误判为宕机。

---

## 5. 跨进程与可观测实现指南（供 15C / 15D）

1. **统一注册器（Registry）**：
   - 在 `monitoring/soft-degrade-registry.js`（或 `soft-degrade-controller.js`）维护内存中生效的动作集合 `activeActionsMap`；
   - 暴露 `recordSoftDegradeAction({ id, reason, detail, nowMs })`；
   - 暴露 `clearSoftDegradeAction(id)`；
   - 暴露 `getSoftDegradeSnapshot()`（同步返回当前安全快照，适配 sync health 模式）。
2. **容量保护**：
   - `activeActions` 数组上限截断为 **8 项**，防止异常循环注册无限撑大 payload。
3. **安全防护**：
   - 注册时校验 `id` 是否属于 `allowedActions` 白名单，若传入未知操作直接拦截并告警。
