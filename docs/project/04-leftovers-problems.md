# 04 — 遗留 · 开放问题 · 风险 · 技术债

> 上级：[`README.md`](./README.md) · 未立项记本页；成熟后 **Promote → [`03-requirements.md`](./03-requirements.md)**

**快照**：2026-09-14（post-push `9751226+`）

---

## 1. 硬规则（已拍板，同步 [`06`](./06-process.md)）

### 1.1 `data/gex` Git 策略（`REQ-024` + Q-003 已决）

| 路径 | Git |
|------|-----|
| `data/gex/latest.json` | **允许入库，但仅里程碑式提交**（见下） |
| `data/gex/*.html` | **严禁提交** |
| `data/gex/snapshot_*.json` 等大快照 | **严禁提交** |

**里程碑式 `latest.json`（严禁盘中例行 commit）**

- 日常/开盘/定时拉链：结果留**本地盘**；上云看板走 SCP/同步配方（REQ-004），**不要**每次 `git commit`。  
- **仅当**以下之一才允许 commit 一次 `latest.json`：基准打桩更新、版本发版验证、重大结构/schema 变动。  
- 提交前必须 `git status`；禁止 `git commit -a` 夹带 HTML/大文件。

---

## 2. 遗留（滚动）

| 债 ID | 摘要 | 关联 | 严重度 |
|-------|------|------|:------:|
| DEBT-001 | **生产 gcp-vm 尚未 `git merge --ff-only` 对齐**（push 已完成） | REQ-002 | P0 |
| DEBT-002 | GEX 开盘计划任务未确认挂载 | REQ-003 | P1 |
| DEBT-003 | latest→GCP 同步通道未定 | REQ-004/022 | P1 |
| DEBT-004 | P5/P6/P2-16 未开工 | REQ-005/006/008 | P2 |
| DEBT-005 | HITL/回滚/密钥 runbook 未写完（015/016/017；019 已有初稿） | REQ-015～017 | P0 |
| DEBT-008 | C2 审计未挂钩看板 | REQ-020 | P1 |
| DEBT-009 | L1 跟单无可验收沙盒表 | REQ-021 | P2 |

### 2.1 已闭环（勿再当开放债）

| 债 ID | 关闭说明 |
|-------|----------|
| DEBT-001 旧义「未 push」 | REQ-001 Done；`origin/main` 已含 local-ops+docs |
| DEBT-006 | CHG-005 Done；方案已作废「企微点 C2」 |
| DEBT-007 | REQ-018 Done；见 `wecom-freeze.md` |
| DEBT-010 | REQ-023 Done；见 06 §3 |

---

## 3. 开放问题

| Q | 问题 | 决策人 | 状态 |
|---|------|--------|------|
| Q-001 | GEX→GCP：SCP / 制品 / 其它？ | human | open |
| Q-002 | 漏重启用何信号发现？ | human+L4 | open |
| Q-003 | 每次拉链是否 commit `latest.json`？ | — | **已决：否；仅里程碑**（§1.1） |
| Q-004 | P5 是否加 CI `place_order` grep？ | L5 | open（建议做） |

---

## 4. 风险

| 风险 | 缓解 | 状态 |
|------|------|------|
| 家宽 IP→60020 | GCP 借道推送 | 已缓解 |
| 企微失陷→C0 侦察 | 白名单 + REQ-018 | 残留 |
| Agent 纸面 HITL | REJ-007 + REQ-015/020 | 待 runbook |
| 多 Agent 改总控撞车 | 05/07 拆分 + REQ-023 | 部分缓解 |
| GEX HTML / 盘中 json 刷爆历史 | REQ-024 + 里程碑策略 | 已拍板 |
| 旧方案重开企微 C2 | CHG-005 | **已缓解** |
