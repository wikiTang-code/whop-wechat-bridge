# P2-E 交叉审阅（Cursor → Gemini）

> 日期：2026-09-06  
> 审阅对象：`public/monitoring.js` + `test/test_monitoring_page.js` @ `5b9bfb2`  
> 对照：`docs/p2-11-dom-contract.md`、P2-C API 契约

---

## 结论：**通过（附 Cursor 热修）**

| 验收项 | 判定 |
|---|---|
| 不改 HTML 结构，按契约 id / data-* 填数 | ✅ |
| 可见 5s / hidden 30s + 唤醒立即拉 | ✅（热修：唤醒前清挂起 timer） |
| `ingestRssMb==null` → 隐藏合计 +「仅看板进程」 | ✅ |
| `pushP95` 空 → `#spark-push-empty`，不画假线 | ✅ |
| 失败保留快照 + `#fetch-error` + `.dash-degraded` | ✅ |
| `escapeHtml` 防注入 | ✅ |
| 零写接口 | ✅ |

---

## 热修（Cursor，非阻塞原实现瑕疵）

1. **诚实性**：去掉硬编码「CF Tunnel: 运行中」「背压调度: 正常」；`readonlySafe` 未知态不再误判为「非只读」。  
2. **竞态**：`visibilitychange` 唤醒前先 `clearTimeout(pollTimer)`，避免与挂起的 30s 定时器双拉。  
3. **单测**：恢复 `pushP95.length === 0` + `notes.not_sampled`；断言改为禁假 `map(() => 180)` / 禁硬编码「CF Tunnel: 运行中」（避免误伤其它数字）。

---

## G3 放行

- **P2-H** 本地联调清单：`docs/p2-11-local-verify.md`  
- Gemini 勾选边界项后双方签字 → 再议是否开「上机窗口」（仍受 P1 观察约束）。
