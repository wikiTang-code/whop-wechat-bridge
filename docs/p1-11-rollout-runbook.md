# P1-11 多进程拆分灰度上线与应急回滚 Runbook

> 对应任务：`docs/gemini-followup-task-split-r3.md` 之 T14。  
> 适用目标：GCP 生产环境从单体 `server.js` 平滑切换至双进程 (`whop-ingest-worker` + `whop-web-dashboard`)。  
> **核心铁律**：**严禁使用 `pm2 delete all`**；**合计 RSS 严控 < 220MB**；**任何异常 30 秒回滚单体**。

---

## 1. 灰度前置准备与检查

在执行任何变更前，登录 GCP VM 执行以下基线巡检：

```bash
# 1. 检查可用系统内存 (必须 >= 300MB free)
free -m

# 2. 检查当前 PM2 单体状态 (确认运行稳态)
pm2 list
curl -s http://127.0.0.1:8085/health | jq .status

# 3. 备份当前单体 ecosystem 配置
cp ecosystem.config.cjs ecosystem.config.cjs.bak.$(date +%Y%m%d%H%M%S)
```

---

## 2. 第一步：代码就绪与 Ingest Dry-Run 校验（零风险）

在不触碰现有运行中进程的前提下，验证 Ingest 瘦入口与心跳写通路：

```bash
# 1. 本地代码 git pull 对齐最新 commit
git status

# 2. 执行 Ingest 瘦入口 dry-run 单次 tick 验证
ROLE=ingest_worker node scripts/ingest_runner.js --dry-run
```

**验收标准**：
- 控制台打印 `[Dry-Run] 执行 mock 数据拉取与分析 tick 完成`；
- 控制台打印 `Tick 结束 [ok] -> 心跳已落盘`；
- 打印的心跳回查 JSON 中 `status: "ok"`, `exists: true`；
- 进程正常退出（Exit Code 0）。

---

## 3. 第二步：启动 Ingest 独立进程（单向写端）

先拉起 Ingest 进程，使其开始建立心跳并独占写主库：

```bash
# 1. 启动独立 Ingest Worker
pm2 start scripts/ingest_runner.js \
  --name "whop-ingest-worker" \
  --max-memory-restart 180M \
  --time \
  --env ROLE=ingest_worker

# 2. 观察 Ingest 日志与首轮轮询
pm2 logs whop-ingest-worker --lines 30 --nostream
```

**验收标准**：
- `pm2 list` 中 `whop-ingest-worker` 处于 `online` 状态；
- 初始内存 RSS 位于 `60MB ~ 90MB` 区间；
- 能够正常输出 `Tick 结束 [ok] ... -> 心跳已落盘`。

---

## 4. 第三步：平滑切换 Web 进程（端口迁移）

停止旧单体并启动独立的只读 Web 看板服务（接管 `:8085` 端口与 Cloudflare Tunnel）：

```bash
# 1. 停止旧单体服务 (释放 8085 端口)
pm2 stop whop-wechat-bridge

# 2. 启动独立只读 Web 看板进程
pm2 start scripts/web_runner.js \
  --name "whop-web-dashboard" \
  --max-memory-restart 130M \
  --time \
  --env ROLE=web_dashboard,READONLY_MODE=1,PORT=8085

# 3. 立即核验健康接口
curl -s http://127.0.0.1:8085/health | jq .
```

**验收标准**：
- `curl` 响应 HTTP 状态码为 **200**；
- JSON 响应中 `subsystems.ingest.status` 为 `"ok"`；
- `subsystems.ingest.delaySec` 小于 90 秒；
- 尝试调用写接口被 403 拦截：
  `curl -s -X POST http://127.0.0.1:8085/api/sync` 返回 `403 Forbidden`。

---

## 5. 第四步：稳态体征复核与看门狗观察（15 分钟）

```bash
# 1. 检查双进程内存总和 (严禁超过 220MB)
pm2 list

# 2. 测试看板 API 聚合数据
curl -s http://127.0.0.1:8085/api/monitoring/dashboard | jq .overall

# 3. 观察外部每分钟 crontab 看门狗日志
tail -n 20 logs/watchdog.log
```

**通过标准**：
- `whop-ingest-worker` RSS ≤ 120MB；
- `whop-web-dashboard` RSS ≤ 80MB；
- 合计 RSS ≤ 200MB（警戒线 220MB）；
- 看门狗无任何报警推送。

---

## 6. 第五步：应急回滚预案（30 秒单命令，严禁 delete all）

若在灰度过程中出现内存超标（>220MB）、心跳假死超时（503）或抓取异常，**执行以下单命令立即恢复单体**：

```bash
# 1. 停止并移除双进程 (严禁使用 pm2 delete all)
pm2 stop whop-web-dashboard whop-ingest-worker && \
pm2 delete whop-web-dashboard whop-ingest-worker && \
pm2 start whop-wechat-bridge

# 2. 验证单体恢复
curl -s http://127.0.0.1:8085/health | jq .status
```

**回滚说明**：
- 此命令仅靶向启停对应进程名，绝不会清空历史 PM2 进程配置或误删系统其他应用；
- 30 秒内恢复单体 `server.js` 稳态服务。
