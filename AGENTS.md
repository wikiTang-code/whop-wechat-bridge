# Agent 须知

多 Agent / 人机协同的**唯一总入口**：[`docs/project/README.md`](docs/project/README.md)

| 先读 | 用途 |
|------|------|
| [`docs/project/03-requirements.md`](docs/project/03-requirements.md) | 需求/变更/拒绝账本 |
| [`docs/project/05-wip-board.md`](docs/project/05-wip-board.md) | **认领任务**（一 REQ 一行） |
| [`docs/project/06-process.md`](docs/project/06-process.md) | 流程、热点锁、提交 SOP |
| [`docs/project/07-review-inbox.md`](docs/project/07-review-inbox.md) | 审阅意见 |

规则：`.cursor/rules/project-progress-sync.mdc`（alwaysApply）。

红线摘要：企微仅 C0+`gex.collect`；C2 须 HITL；禁 `place_order`；禁 Agent 自治 restart；`data/gex/*.html` 严禁提交。
