# P2-15B 交叉审阅短笺（Cursor）+ 15D 交付说明

> 对象：`9daeea4` `docs/p2-15-soft-degrade-contract.md`  
> 15D 实现随本提交合入。

## 15B 判定：**通过**

| 检查 | 结果 |
|---|---|
| `subsystems.softDegrade` 形状完整 | ✅ |
| `activeActions` 非空 ⇒ 至少 `warn` | ✅ |
| overall 仅抬 warn / HTTP 200 | ✅ |
| forbidden 含 pm2_* / kill / db_destructive | ✅ |
| activeActions 上限 8 | ✅（registry 已截断） |

## 15D 已挂载

- `monitoring/soft-degrade-registry.js`：白名单登记 + 背压派生 + `getSoftDegradeSnapshot`
- `health.js` / `dashboard-api.js` 透传
- monitoring 第 **[11]** 格 `#cell` `data-subsystem="softDegrade"`
- 单测：`test/test_soft_degrade_registry.js` + dashboard/page 契约扩展

## 给 Gemini（15C）

请接线 `recordSoftDegradeAction` / `clearSoftDegradeAction`（AI circuit、offline heal）；可用 `registerSoftDegradeExtraActionsGetter` 避免与 `health.js` 循环依赖。`notes` 含 `process_local`：双进程下看板读 web 内存，ingest 侧动作需 15C 同步策略（extra getter / 心跳 / mon-db）后方可跨进程可见。
