# 04 — 遗留 · 开放问题 · 风险 · 技术债

> 上级：[`README.md`](./README.md) · 未立项记本页；成熟后 **Promote → [`03-requirements.md`](./03-requirements.md)**

**快照**：2026-09-14

---

## 1. 硬规则（已拍板，同步 [`06`](./06-process.md)）

### 1.1 `data/gex` Git 策略（`REQ-024`）

| 路径 | Git |
|------|-----|
| `data/gex/latest.json` | **允许且应保留**（只读 API / mock） |
| `data/gex/*.html` | **严禁提交** |
| `data/gex/snapshot_*.json` 等大快照 | **严禁提交** |

提交前必须 `git status`；禁止 `git commit -a` 夹带 HTML/大文件。

---

## 2. 遗留（滚动）

| 债 ID | 摘要 | 关联 | 严重度 |
|-------|------|------|:------:|
| DEBT-001 | `6099c6d` 未 push / 生产未确认 ff | REQ-001/002 | P0 |
| DEBT-002 | GEX 开盘计划任务未确认挂载 | REQ-003 | P1 |
| DEBT-003 | latest→GCP 同步通道未定 | REQ-004/022 | P1 |
| DEBT-004 | P5/P6/P2-16 未开工 | REQ-005/006/008 | P2 |
| DEBT-005 | HITL/回滚/密钥/发布判据缺 runbook | REQ-015～017、019 | P0 |
| DEBT-006 | 权威方案可能仍暗示企微点 C2 | CHG-005 | P0 |
| DEBT-007 | 企微 C0 侦察面；扩面无冻结门禁 | REQ-018 | P1 |
| DEBT-008 | C2 审计未挂钩看板 | REQ-020 | P1 |
| DEBT-009 | L1 跟单无可验收沙盒表 | REQ-021 | P2 |
| DEBT-010 | 进度树并发协议待写进 06 | REQ-023 | P0 |

---

## 3. 开放问题

| Q | 问题 | 决策人 | 状态 |
|---|------|--------|------|
| Q-001 | GEX→GCP：SCP / 制品 / 其它？ | human | open |
| Q-002 | 漏重启用何信号发现？ | human+L4 | open |
| Q-003 | 每次拉链是否 commit `latest.json`？ | human | open（HTML 永不） |
| Q-004 | P5 是否加 CI `place_order` grep？ | L5 | open（建议做） |

---

## 4. 风险

| 风险 | 缓解 | 状态 |
|------|------|------|
| 家宽 IP→60020 | GCP 借道推送 | 已缓解 |
| 企微失陷→C0 侦察 | 白名单 + REQ-018 | 残留 |
| Agent 纸面 HITL | REJ-007 + REQ-015/020 | 待 runbook |
| 多 Agent 改总控撞车 | 05/07 拆分 + REQ-023 | 部分缓解 |
| GEX HTML 撑爆仓库 | REQ-024 | 已拍板 |
| 旧方案重开企微 C2 | CHG-005 | 待改文 |
