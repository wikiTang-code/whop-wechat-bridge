# Runbook：GEX → GCP 只读同步安全专节（REQ-022 / 支撑 REQ-004）

> Owner：`agent:cursor` · 2026-09-14 · 关联 [`04`](../04-leftovers-problems.md) Q-001 · [`gex-sidecar.md`](../../gex-sidecar.md)

## 1. 允许同步的产物

| 路径 | 可否上云 | 说明 |
|------|:--------:|------|
| `data/gex/latest.json` | ✅ | 结构摘要；可 SCP/制品到 GCP 看板消费 |
| `data/gex/*.html` | ❌ | 禁止提交与禁止上云（体积/噪声） |
| `data/gex/snapshot_*.json` | ❌ | 大快照留本机 |
| OpenD 会话 / 密钥 / `.env` | ❌ | 永不随快照或同步包 |

## 2. 铁律

1. **永不在 GCP / gcp-vm 跑 OpenD 或 GEX 拉链**（`REJ-006`）。  
2. 同步通道只传**只读产物**；目标目录权限只读给 dashboard。  
3. 同步脚本不得嵌入 API Key；使用本机已有 SSH/SCP 配方或制品仓。  
4. Git：`latest.json` **仅里程碑**入库；盘中拉链结果勿例行 commit（`REQ-024`）。

## 3. 推荐同步形态（Q-001）

**已决（interim）**：本机 **SCP** `data/gex/latest.json` → gcp-vm 约定路径（Human 仍可改制品通道）。

```powershell
# 仅校验
node tools/gex-sidecar/sync_latest_to_gcp.js --dry-run

# 真实 SCP（需本机已配置 ssh Host gcp-vm）
node tools/gex-sidecar/sync_latest_to_gcp.js
# 或
npm run gex:sync-gcp
```

环境变量（可选）：`GEX_SYNC_SSH_HOST`（默认 `gcp-vm`）、`GEX_SYNC_REMOTE_PATH`。

备选：CI 制品上传（仍禁止 HTML/大快照）。

## 4. 验收清单

- [x] 同步前 `validateGexPayload`（REQ-022）  
- [x] 仅允许 basename=`latest.json`；禁 HTML / snapshot_*  
- [ ] 联调：看板读到新鲜 `generated_at`（人工一次）  
- [x] 失败仅返回错误，不触发生产 C2 / 跟单  

## 5. 与 REQ-004 关系

本专节 + `sync_latest_to_gcp.js` 落地 **REQ-004** 默认 SCP 通道；安全约束仍以 REQ-022 为准。
