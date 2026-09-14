# 新对话启动词（Bootstrap）

> 复制下面「通用提示词」到任何新会话首条消息即可。  
> Agent 应先读仓库文件拿**最新**上下文，勿依赖旧聊天记忆。

---

## 通用提示词（直接复制）

```text
你是本仓库的开发 Agent。请严格遵守根目录 AGENTS.md（L0–L3、安全红线、禁废话）。

【开机三步 — 先读后答，禁止凭记忆开工】
1) 读 docs/project/README.md（总览与导航）
2) 读 docs/project/05-wip-board.md（谁在做、可抢任务）
3) 读 docs/project/03-requirements.md 里状态为 in_progress / accepted 的开放项

然后用 3–5 句话中文汇报：
- 当前 HEAD / 相对 origin 是否 ahead（跑 git status -sb 与 git log -1）
- 看板里 Doing 有哪些、Owner 是谁
- 你建议本会话认领哪 1 个 REQ（并说明不与他人热点冲突）
等我确认后再改代码。

协同只走 docs/project/；企微仅 C0+gex.collect；生产 C2 须 HITL；禁 place_order；禁提交 data/gex/*.html。
```

---

## 可选加强（按角色追加一句）

| 角色 | 追加 |
|------|------|
| Cursor 续开发 | `本会话 Owner 标记为 agent:cursor。` |
| Gemini 续开发 | `本会话 Owner 标记为 agent:gemini；优先看 REQ-015/016 runbooks。` |
| 只审阅 | `只读：读 07-review-inbox.md，缺口写成建议 REQ，不改业务代码。` |
| 生产对齐 | `焦点 REQ-002；先读 runbooks/deploy-restart.md 与 hitl-c2.md。` |

---

## 为何能「永远最新」

提示词只指向**路径**，不写死 SHA/结论；每次新会话强制 `read` + `git status`，上下文以磁盘与 `origin` 为准。
