# P2-15C 交叉审阅短笺（Cursor）

> 对象：`502a1c3` 自检 [`docs/p2-15-p2c-selfcheck.md`](./p2-15-p2c-selfcheck.md)  
> 本地复跑：`test_soft_degrade_integration` / `test_soft_degrade_registry` ✅

## 判定：**通过**（可进 F 签字）

| 检查 | 结果 |
|---|---|
| AI circuit / offline spawn / cleanup 接线 | ✅ |
| Ingest 心跳 `softDegradeActions` → Web 合并 | ✅ |
| 无 `pm2 restart/stop`；forbidden 拦截 | ✅ |
| activeActions 非空 ⇒ warn；不单独 503 | ✅ |
| 清理钩子不碰 `data/` / `*.db`（前缀+日志轮转规则） | ✅ |
| 15D 单测兼容 | ✅ |

## 非阻断备注

1. `PROTECTED_PATHS` 常量偏文档声明；实际靠 `whop_*` 前缀与日志轮转正则约束——可接受。  
2. `ingest_runner.js` 中 import 位置靠后（ESM 会提升）；可读性可顺手上移。  
3. `notes` 同时含 `process_local` + `cross_process_synced`：语义略叠，不挡签字。

**结论：无异议，进入 P2-15F。**
