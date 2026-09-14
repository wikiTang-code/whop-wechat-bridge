# Runbook：事故响应与回滚（REQ-016）

> Owner：`agent:gemini` · 状态：草稿骨架（请 Gemini 补全）  
> 关联：REJ-002/004/009 · 双进程设计见 `docs/p1-11-*` · **禁止临场通用 SSH 当流程**

## 待补全清单

1. [ ] 事故分级（P1 推送中断 / P0 跟单误触或写坏库 等）  
2. [ ] 宣布人与沟通渠道（谁喊停、谁改 05）  
3. [ ] 止血 vs 回滚判据  
4. [ ] 回滚到旧 SHA / 单体镜像的**逐步**命令（白名单配方或已文档化步骤；非随意 ssh）  
5. [ ] 回滚后验证清单（`/health`、pm2、关键页冒烟）  
6. [ ] 与 REQ-019（何时必须 restart）交叉引用  

## 红线

- 看门狗/告警/Agent **不得**自动 `pm2 restart`  
- cutover/rollback 若未进 catalog：只走本 runbook 人肉步骤，事后补 CHG
