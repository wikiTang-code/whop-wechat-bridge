# Runbook：发布 go/no-go 与重启判据（REQ-019）

> Owner：`agent:cursor` · 与 REQ-015/016 交叉引用  
> 默认：**只对齐代码、不重启**；例外见下表。

## 1. 对齐后是否 restart？

| 变更类型 | ff / deploy_align 后 | 谁判定 |
|----------|----------------------|--------|
| 仅 `docs/**`、规则、注释 | **不重启** | 默认 |
| 仅 dashboard 静态/只读 API | 通常 **只重启 `whop-web-dashboard`**（若需加载） | human |
| ingest / 推送 / 写库 / 跟单逻辑 | **必须**考虑 `whop-ingest-worker` restart | human + HITL |
| `catalog`/local-ops 本机栈 | 影响本机 `ops:http`，**非**生产 pm2 | 本机 |
| 依赖/原生模块/环境变量语义变 | **倾向双进程均 restart** | human |

漏重启发现（Q-002 已决闭环·`CHG-020`）：
- `/health` 根子系统 `subsystems.process.gitCommit` 暴露进程启动时加载的代码 SHA；
- `gcp_health_bundle.sh`（或本机监控）自动对比当前磁盘 `git rev-parse HEAD` 与 `gitCommit`，直接产出 `restart_drift: true/false` 与 `drift_detail`。若 `restart_drift: true` 则代表代码已更新但进程尚未重启。

## 2. Go / No-Go 最小清单

**Go 对齐前**

- [ ] SHA 已在 `origin/main`（40 hex）
- [ ] 无未提交生产密钥
- [ ] 相关测试已绿（若动 L4：`npm run test:local-ops`）

**Go 对齐后**

- [ ] `gcp.git_head` / 现场 `git rev-parse HEAD` 匹配
- [ ] 若重启：HITL `human-approve` → 具名 `pm2 restart` → `/health` 与关键冒烟

**No-Go**

- Agent 要求代跑 approve / 企微确认 C2
- 告警链触发 restart
- 目标 SHA 不在 origin 或不明确

## 3. 与其它 Runbook

- 步进 HITL：`runbooks/hitl-c2.md`（Gemini）
- 事故回滚：`runbooks/incident-rollback.md`（Gemini）
