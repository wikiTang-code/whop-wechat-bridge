# P1-11 多进程拆分灰度上线与应急回滚 Runbook

> 对应任务：`docs/gemini-followup-task-split-r3.md` 之 T14。  
> **修订（Cursor 复核）**：禁止 Ingest 与单体并行写库；修正 PM2 环境变量写法。  
> **铁律**：严禁 `pm2 delete all`；合计 RSS &lt; 220MB；异常 30 秒回滚单体。

---

## 0. 关键防护与已补齐能力

1. **绝对禁止**在单体 `whop-wechat-bridge` 仍在跑时启动 `whop-ingest-worker`（会双写 `whop_archive.db`、双轮询 Whop）。必须**先停单体，再启双进程 sample**。
2. PM2 **统一使用 sample 配置**：`pm2 start docs/ecosystem.p1-11.sample.cjs`，确保环境变量正确加载。
3. **已闭环能力清单（Round 4 落地）**：
   - ✅ **T15 自动调度器**：Auto News 与 Auto Persona 已正式迁入 `ingest_runner.js` 同步成功路径。
   - ✅ **T16 公网 Tunnel**：Cloudflare Tunnel 已挂载于 `web_runner.js`，通过 `ENABLE_TUNNEL=1` 受控拉起。
   - ✅ **T17 监控单写探针**：Supervisor、EventLoop 延迟探针与 AI Tunnel 熔断器已迁入 Ingest 独占管理。
   - ✅ **T18 前端契约对齐**：只读路由字段与 `public/app.js` 现网契约 100% 对齐，避免白屏。

---

## 1. 灰度前置

```bash
free -m                    # available 建议 >= 300MB
pm2 list
curl -s http://127.0.0.1:8085/health | jq '{ok,status,rss:.subsystems.process.memoryRssMb}'
cp ecosystem.config.cjs "ecosystem.config.cjs.bak.$(date +%Y%m%d%H%M%S)"
```

代码对齐：`git status` / 部署最新 `feat` 文件（含 `scripts/*_runner.js`、monitoring 心跳）。  
公网确认：若看板依赖 Cloudflare Tunnel 公网访问，切灰前须显式配置 `ENABLE_TUNNEL=1`（或编辑 `docs/ecosystem.p1-11.sample.cjs` 置为 `'1'`）；若使用 SSH 隧道或仅内网访问则保持 `'0'`。  
鉴权红线：必须确认环境已配置 `DASHBOARD_USERNAME` 与 `DASHBOARD_PASSWORD`；**严禁在未配置 Auth 的情况下开启 `ENABLE_TUNNEL=1` 暴露公网**！

---

## 2. Dry-Run（零切换风险）

```bash
cd ~/whop-wechat-bridge
ROLE=ingest_worker node scripts/ingest_runner.js --dry-run
```

验收：Tick ok、心跳 `exists:true`、进程退出 0。

---

## 3. 切换顺序（单写者）

```bash
# A. 先停单体，释放写锁与 8085
pm2 stop whop-wechat-bridge

# B. 用 sample 拉起双进程（推荐，环境变量正确）
pm2 start docs/ecosystem.p1-11.sample.cjs

# 或分步：
# pm2 start docs/ecosystem.p1-11.sample.cjs --only whop-ingest-worker
# sleep 5
# pm2 start docs/ecosystem.p1-11.sample.cjs --only whop-web-dashboard
```

验收：

```bash
pm2 list
curl -s -o /tmp/h.json -w "%{http_code}" http://127.0.0.1:8085/health
cat /tmp/h.json | jq '{ok,status,ingest:.subsystems.ingest}'
curl -s -X POST http://127.0.0.1:8085/api/sync | jq .code   # 期望 ERR_READONLY_PROCESS / 403
```

- HTTP **200**（warn 也可 200）；ingest `status=ok` 且 `delaySec&lt;90`  
- 写接口 **403**  
- 两进程 RSS 合计 **≤ 200MB**（警戒 220）

---

## 4. 观察 15 分钟

```bash
pm2 list
curl -s http://127.0.0.1:8085/api/monitoring/dashboard | jq .overall
tail -n 30 logs/watchdog.log
pm2 logs whop-ingest-worker --lines 40 --nostream
```

看门狗无新 critical；推送链路用业务群抽查一条（若盘中）。

---

## 5. 回滚（禁止 delete all）

```bash
pm2 stop whop-web-dashboard whop-ingest-worker
pm2 delete whop-web-dashboard whop-ingest-worker
pm2 start whop-wechat-bridge
# 若单体已从 PM2 列表消失：
# pm2 start ecosystem.config.cjs
pm2 save
curl -s http://127.0.0.1:8085/health | jq .status
```

---

## 6. 灰度通过后

能力迁入确认：Auto News/Persona、Cloudflare Tunnel、Supervisor/event-loop 探针以及全套只读前端契约均已在 R4/R5 闭环入仓，无需再作为缺口挂起；切灰前仅需核验 `ENABLE_TUNNEL` 开关。
