# Runbook：生产 C2 HITL（REQ-015）

> Owner：`agent:gemini` · 状态：草稿骨架（请 Gemini 补全可执行步骤）  
> 关联：REJ-001/007 · CHG-005/006 · REQ-020 · 看板 Ops 行见 [`../05-wip-board.md`](../05-wip-board.md)

## 范围

- **适用**：`gcp.pm2_restart`、`gcp.deploy_align` 等生产 C2。  
- **不适用**：企微 `/ops`（不得确认 C2）；Agent 不得代跑 `human-approve`。

## 待补全清单

1. [ ] 谁有资格执行 `node tools/local-ops/cli.js human-approve <token>`  
2. [ ] 标准步骤：invoke → 出示摘要 → human-approve → confirm → 验证  
3. [ ] token 超时/拒绝/重复使用时怎么办  
4. [ ] 每次完成后：填写 05「Ops 审计行」（时间/human/动作/目标/结果）  
5. [ ] 与 gateway `audit` 字段对齐（REQ-020）  
6. [ ] 禁止事项清单（复制 REJ-007/009）

## 最小命令备忘（实现已存在，勿改语义）

```text
node tools/local-ops/cli.js invoke gcp.pm2_restart '{"name":"whop-web-dashboard"}'
# → human_confirm_required + token
node tools/local-ops/cli.js human-approve <token>   # 仅 human
node tools/local-ops/cli.js confirm gcp.pm2_restart <token> '{}'
```
