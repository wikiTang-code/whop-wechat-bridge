# P1-11 多进程拆分灰度上线与应急回滚 Runbook

> 对应任务：`docs/gemini-followup-task-split-r3.md` 之 T14。  
> **修订（Cursor 复核）**：禁止 Ingest 与单体并行写库；修正 PM2 环境变量写法。  
> **铁律**：严禁 `pm2 delete all`；合计 RSS &lt; 220MB；异常 30 秒回滚单体。

---

## 0. 切勿踩的坑

1. **禁止**在单体 `whop-wechat-bridge` 仍在跑时启动 `whop-ingest-worker`（会双写 `whop_archive.db`、双轮询 Whop）。  
2. PM2 **不要**用 `--env ROLE=...`（那是 ecosystem 里 `env_production` 这类命名环境，不是设变量）。用 sample ecosystem 或 `ecosystem` + `env:`。  
3. 当前 `web_runner` **尚未**拉起 Cloudflare Tunnel；灰度前需确认公网入口方案（临时保留 tunnel 在别处，或补代码后再切）。  
4. 当前 ingest **未**内嵌 Auto News / Auto Persona 调度（与差异文档表述不一致）——灰度前须补齐或接受功能缺口。

---

## 1. 灰度前置

```bash
free -m                    # available 建议 >= 300MB
pm2 list
curl -s http://127.0.0.1:8085/health | jq '{ok,status,rss:.subsystems.process.memoryRssMb}'
cp ecosystem.config.cjs "ecosystem.config.cjs.bak.$(date +%Y%m%d%H%M%S)"
```

代码对齐：`git status` / 部署最新 `feat` 文件（含 `scripts/*_runner.js`、monitoring 心跳）。

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

`pm2 save`；保留 bak；记录 commit SHA 与 RSS 峰值。  
正式长期运行前关闭清单：Tunnel、Auto News/Persona、Supervisor/event-loop 是否已迁入 ingest。
