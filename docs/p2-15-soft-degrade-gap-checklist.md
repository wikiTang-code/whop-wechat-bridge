# P2-15A 软降级缺口清单（Cursor）

> 日期：2026-09-06  
> 对应：[`docs/p2-15-task-split-parallel.md`](./p2-15-task-split-parallel.md)  
> 红线：R2/R5 — 只允许白名单软降级；严禁进程重启类硬自愈。

---

## 1. 已落地碎片（可收编，勿重造）

| 动作候选 id | 实现位置 | 触发 | 恢复 | `/health` 可见？ | 缺口 |
|---|---|---|---|---|---|
| `backpressure_throttle_poll` | `monitoring/backpressure-controller.js` → `getEffectivePollIntervalSec` | event-loop p99 / httpOk | healthyStreak≥3 阶梯回退 | 间接（若 ingest 暴露 bp） | 统一 `softDegrade.activeActions` 登记缺失 |
| `backpressure_pause_secondary` | 同文件 `shouldPauseSecondaryWorkers`；**已接线** `monitor.js` | L1/L2 | 回 NORMAL | **弱**（无独立 softDegrade 格） | 需收编进 `activeActions`；勿重复发明第二套 pause |
| `ai_tunnel_suspend_probe` | `monitoring/ai-tunnel-circuit.js` | 连续失败 | 冷却/成功探测 | 有 circuit 字段痕迹 | 与统一钩子表对齐 |
| `offline_sync_spawn_weekend` | `supervisor.tryTriggerOfflineAutoSync` | 资产 critical + 周末/节假 + `ENABLE_AUTO_OFFLINE_SYNC=1` + 24h cooldown | 一次性 spawn | health_events `healing_triggered` | 属「派生离线脚本」非重启；须在白名单明示；默认关闭 |
| 告警边沿 | `alert-sink` / watchdog bash | 状态翻转 | 恢复通知 | alert_history | 告警 ≠ 降级动作，勿混 |

---

## 2. 计划宣称但未统一的能力

| 计划原文（Q5 / 项15） | 现状 | 建议 |
|---|---|---|---|
| AI 断线暂停队头消费 | AI circuit 挂起**探针**；未见通用「暂停队头消费」开关 | 15B 明确：本轮是否扩展到 queue consumer pause，或仅登记现有 circuit |
| 日志/临时文件定期清理 | 依赖 pm2-logrotate 等 OS 侧；应用内无受控 `log_tmp_cleanup` 钩子 | **P2-15E 可选**：仅清明确路径（如 `/tmp/whop_*`、超龄 `logs/*.log`），配额+干跑标志；禁止碰 `data/` 与 `*.db` |
| Supervisor「钩子」一等公民 | Supervisor 调度探针+告警，无 `softDegrade` 子系统快照 | 新增只读快照聚合器（15C），由 15D 挂 health/看板 |

---

## 3. 误报 / 越权边界

| 风险 | 规则 |
|---|---|
| 把 overall warn 当成要重启 | 文档+告警文案必须写「告警不重启」 |
| 把 consistency/routeCoverage warn 自动触发清理 | **禁止**；一致性偏差只告警（P2-13 已定） |
| 盘中 spawn 离线同步 | 保持日历门闩；默认 `ENABLE_AUTO_OFFLINE_SYNC` 关 |
| 清理钩子误删媒体 | 白名单路径；单测断言拒绝 `data/media`、`*.db` |
| 假绿 | `activeActions` 非空则 status 至少 `warn`；未知实现 → `unknown` + note |

---

## 4. 建议本轮必做 / 可延后

**必做（15C/D）**
1. `softDegrade` 只读快照：聚合背压 tier、AI circuit、（若开启）最近一次 offline heal  
2. 审计并文档化 `pauseSecondaryWorkers` 真实调用点；若无调用方 → 15C 最小接线 **或** 契约标注 `not_wired`（禁止假绿）  
3. health 聚合：只抬 warn，不 503  

**可延后（15E）**
- 应用内 log/tmp 清理钩子  
- 真正的「暂停队头消费」通用闸（若超出 AI circuit）

**明确不做**
- P2-14 RUM  
- DB vacuum/归档（P2-16）  
- 任何 pm2 硬自愈  

---

## 5. 给 Gemini（15B）的输入要点

- 动作枚举用稳定 `id` 字符串（上表候选）  
- `forbidden` 必须含 `pm2_restart` / `pm2_stop` / `process_kill` / `db_destructive`  
- `activeActions[]` 上限建议 ≤8，防打爆 `/health`  
- 与 `backpressure` / `aiTunnel` 现有字段：可并存；`softDegrade` 做总览，旧字段可保留兼容  

**审阅结论（Cursor 自检）**：清单可作为 15B 契约输入；无阻塞。
