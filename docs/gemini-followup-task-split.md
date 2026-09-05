# 后续任务拆分（给 Gemini 先行）

> 准则：可观测 ≠ 业务闭环；PM2 restarts 看会话/unstable；本地/云端脚本双向对称。  
> 当前基线：`feat/p1-attachments-and-ratelimiter` @ `2075832`；周末 News 休市免检已上机。

---

## T1 — 文档快照同步（小、先做）

**目标**：把方案 `docs/system-hardening-and-monitoring-plan.md` §10 更新到与 `2075832` 一致。  
**交付**：
- 文首状态写明 News 休市空窗免检已落地
- P1-9/运维行注明 `run_offline_asset_sync.js` 已入仓 + 周末 cron
- 验收红线补三条准则短段  
**不做**：改生产代码、改 crontab  
**验收**：文档与远端 commit 描述一致，无「100% 闭环」夸大

---

## T2 — P1-11 方案设计稿（只设计不写拆分代码）

**目标**：产出可评审的多进程拆分设计，**禁止直接改 `ecosystem.config.cjs` 上生产**。  
**必须回答**：
1. 进程清单：`whop-ingest-worker` vs `whop-web-dashboard` 各自职责（谁轮询/推送/跟单/`task_queue`/media）
2. **958MB 内存预算**：两进程稳态 RSS 上限（建议合计 &lt;220MB）与超限砍刀清单
3. 数据面：web 全只读 `better-sqlite3({ readonly:true })`；写路径仅 ingest
4. 看门狗：`/health` 挂在 web 后，ingest 假死如何另探（端口/心跳文件/独立轻量 endpoint）
5. 部署对称：本地/GCP 同一 `ecosystem` + 启动顺序 + 回滚一步命令  
**交付物**：`docs/p1-11-multiprocess-design.md`（或方案 § 新节）  
**验收**：Cursor/人工评审通过后再开实现 PR

---

## T3 — 交易日 News 期望窗口（设计+可选小改）

**目标**：休市免检之外，明确**交易日**何时应对「从未生成 / 滞后」告警。  
**交付**：
- 对照 Auto News Scheduler 触发时段，写清期望窗口（例如盘中/收盘）
- 若易改：探针在交易日按窗口判断；难改则只出设计  
**约束**：不要用整天 `isOffMarketHours` 豁免（会误免工作日盘后）  
**验收**：交易日缺 News → warn；周末 → ok（免检文案）

---

## T4 — 健康看板（P2-11）草图（可与 T2 并行）

**目标**：一页红黄绿 + 最近告警 + 资产/队列/推送，只读 `monitoring.db` + `/health`。  
**交付**：路由/页面草图 + 数据源表；**不**引入重型前端框架，除非现有栈已有。  
**依赖**：P1-7 已有；不依赖 P1-11 必完成，但若 web 拆分则看板挂 web 进程。

---

## 建议 Gemini 顺序

1. **T1**（文档，10–20 分钟）  
2. **T2**（P1-11 设计，重点）  
3. **T3**（News 交易日窗口）  
4. **T4**（看板草图，可并行）

实现与上机由 Cursor 在设计验收后再做。
