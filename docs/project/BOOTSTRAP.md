# 新对话启动词（Bootstrap）

> 复制下面「通用提示词」到任何新会话首条消息即可。  
> Agent 应先读仓库文件拿**最新**上下文，勿依赖旧聊天记忆。  
> 指针链：`AGENTS.md` → 本页 → [`README.md`](./README.md) → [`05-wip-board.md`](./05-wip-board.md) §0（`CHG-007`）。

---

## 通用提示词（直接复制）

```text
你是本仓库的开发 Agent。请严格遵守根目录 AGENTS.md（L0–L3、安全红线、禁废话）。

【开机三步 — 先读后答，禁止凭记忆开工】
1) git pull（或确认已与 origin 对齐）后读 docs/project/README.md（总览 + **队列镜像**）
2) 读 docs/project/05-wip-board.md **§0 全文**（0.A/0.B/0.H/0.R 最新排班；禁沿用旧会话队列 · CHG-013）
3) 读 docs/project/03-requirements.md 里状态为 in_progress / accepted 的开放项
4) 处理/产物跑在哪：读 docs/project/environments.md（CHG-026 compute vs SoR）

然后用 3–5 句话中文汇报：
- 当前 HEAD / 相对 origin 是否 ahead（跑 git status -sb 与 git log -1）
- §0.A / §0.B / §0.R 当前各是什么、Owner 是谁
- 你认领本会话队列顺位 1（互斥校验后），并立即开干

若 Human 已下令「跑完队列 / 中间不要确认」（CHG-014）：开发↔交叉审修自主闭环，中间勿打断确认；仍守互斥、生产 C2 HITL、企微窄面、禁 place_order。
否则：仅当 §0 为空且候选需人拍板时再问一句。

协同只走 docs/project/；企微仅 C0+gex.collect；生产 C2 须 HITL；禁 place_order；禁提交 data/gex/*.html；latest.json 仅里程碑 commit（禁盘中例行）。
```

---

## 可选加强（按角色追加一句）

| 角色 | 追加 |
|------|------|
| Cursor 续开发 | `本会话 Owner 标记为 agent:cursor；只改 §0.A。` |
| Gemini 续开发 | `本会话 Owner 标记为 agent:gemini；只改 §0.B / §0.R-B。` |
| 只审阅 | `只读：读 07-review-inbox.md，缺口写成建议 REQ，不改业务代码。` |
| 生产对齐 | `REQ-002 Done（2026-09-19 Human 确认 restart）。后续 C2 仍读 runbooks/deploy-restart.md 与 hitl-c2.md。` |

---

## 为何能「永远最新」

文件在 git 里；每次 `git pull` + 重读 §0 即最新排班。聊天记录不是真相源。
