# P2-15C：软降级钩子接线与跨进程可见性自检报告（Gemini）

> **所属阶段**：P2-15 软降级钩子（G1 交付）  
> **责任方**：Gemini（15C 接线与单测）∥ Cursor（15D 挂载已就绪）  
> **依据**：`docs/p2-15-soft-degrade-contract.md` (15B) / `docs/p2-15-soft-degrade-gap-checklist.md` (15A)  
> **红线**：R2/R5 — 严格白名单软降级；杜绝任何 `pm2 restart` / `stop` / 硬杀进程。  
> **日期**：2026-09-06  

---

## 1. 交付概况与接线清单

| 动作 ID | 接线位置 | 触发源 | 恢复机制 | 跨进程表现 | 验收结论 |
|---|---|---|---|---|---|
| `backpressure_throttle_poll` | `monitoring/soft-degrade-registry.js` (内置 derive) | 背压 `TIER_1` / `TIER_2` | `healthyStreak >= 3` 降回 `NORMAL` | Ingest 心跳带入 `detail.softDegradeActions`，Web 端自动感知 | ✅ **通过** |
| `backpressure_pause_secondary` | 同上 (内置 derive) | `pauseSecondaryWorkers === true` | 背压恢复 `NORMAL` | 同上 | ✅ **通过** |
| `ai_tunnel_suspend_probe` | `monitoring/soft-degrade-registry.js` (内置 derive) | `isAiTunnelSuspended()` (open 状态) | 探活成功进入 closed | 单体/双进程通过 `getAiTunnelStatus` 感知 | ✅ **通过** |
| `offline_sync_spawn_weekend` | `monitoring/supervisor.js` | 资产 critical + 周末/节假 + `ENABLE_AUTO_OFFLINE_SYNC=1` | 子进程 exit 事件触发 `clearSoftDegradeAction` | 派生自愈动作实时注册并释放 | ✅ **通过** |
| `log_tmp_cleanup` (15E) | `monitoring/cleanup-hooks.js` | `executeControlledLogTmpCleanup` | 清理完毕后在 `finally` 块内即刻 clear | 受控清理 `/tmp/whop_*`，绝不碰 `data/` 与 `*.db` | ✅ **通过** |

---

## 2. 关键架构改进：双进程跨进程可见性闭环

在 Cursor 15B 审阅短笺中指出：
> `notes 含 process_local：看板读 web 进程内存，ingest 侧动作需你补跨进程同步后才稳定可见`

本次 15C 实现了无侵入的跨进程同步闭环：
1. **Ingest 侧（单向写）**：
   在 `scripts/ingest_runner.js` 中，每个轮询 tick（无论是正常处理还是防重入跳过）落盘心跳时，自动调用 `getSoftDegradeSnapshot()` 将本进程生效的 `softDegradeActions` 存入 `ingest_heartbeat` 表的 `detail_json`；
2. **Web 侧（只读读）**：
   在 `monitoring/soft-degrade-registry.js` 注册系统默认 getter：读取 `getIngestHeartbeat('primary')`，若检测到新鲜心跳中含有降级动作，自动合并进快照并标记 `[ingest]` 来源；
3. **去重与容量防护**：
   `getSoftDegradeSnapshot` 内部统一基于 action `id` 做 `seen` 集合去重，并严格截断上限为 8 条（`ACTIVE_ACTIONS_CAP`）；
4. **恪守 R3 只读铁律**：
   无需建立新表、无需引入 IPC，Web 进程仅使用已有的只读 SQLite 连接读取心跳，零写锁竞争。

---

## 3. 自动化回归实录（9 组全绿）

```text
node test/test_soft_degrade_integration.js     PASS (静态红线/AI联动/离线派生/跨进程心跳/清理钩子)
node test/test_soft_degrade_registry.js        PASS (Cursor 15D 原生单测兼容)
node test/test_dashboard_api.js                PASS (含第 11 格 softDegrade 透传)
node test/test_monitoring_page.js              PASS (前端第 11 格 DOM 契约)
node test/test_data_consistency_probe.js       PASS (P2-13 一致性探针)
node test/test_consistency_smoke_watchdog.js   PASS (P2-13 看门狗冒烟)
node test/test_route_coverage_probe.js         PASS (P2-12 路由覆盖探针)
node test/test_page_smoke_watchdog.js          PASS (P2-12 关键页冒烟)
node test/test_tunnel_launcher.js              PASS (Tunnel 状态与落盘)
```

---

## 4. 红线核验总结

- **R2 严禁自动重启**：
  静态文本与正则审查确认，`soft-degrade-registry.js`、`cleanup-hooks.js` 绝对未调用 `pm2 restart` / `pm2 stop` / `process.kill`；
  外部传入 `pm2_restart` 等动作时被白名单强力拦截（返回 `forbidden_action`）；
- **R5 软降级保障**：
  `activeActions` 非空时状态严格置为 `warn`（杜绝假绿），但向 `/health` 聚合时保持 HTTP 200，绝不单独 503；
- **文件保护**：
  清理钩子通过 `PROTECTED_PATHS` 严格保护 `data/`、`data/media/` 与所有 `*.db` 数据库文件。
