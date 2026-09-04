# 系统加固 + 监测机制 实施方案（P0 已落地，P1/P2 待做）

> **临时说明（2026-09-04）**：完整 §10 稿正在写回；勿以本页为终稿。
>
> - P0 代码已合入 `main`：PR [#7](https://github.com/wikiTang-code/whop-wechat-bridge/pull/7)（squash `c5b57ae`），含 `monitoring/*` 与 `scripts/watchdog/run_from_env.sh`。
> - 计划全文（含 §10 实施状态快照）见分支 [`cursor/hardening-monitoring-plan-fd06`](https://github.com/wikiTang-code/whop-wechat-bridge/blob/cursor/hardening-monitoring-plan-fd06/docs/system-hardening-and-monitoring-plan.md)（原 PR #6，已关闭因冲突）。
> - 生产 gcp-vm：`/health` 正常、看门狗 crontab 已装、企微 webhook RTT 正常；下一步从 P1-5 attachments 回填起。
