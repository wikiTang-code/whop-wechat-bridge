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

## 3. 推荐同步形态（Q-001 仍可由 Human 最终点名）

默认建议：**本机定时 SCP** `latest.json` → gcp-vm 约定路径（如 `data/gex/latest.json`），dashboard 只读 API 已存在则直接消费。

备选：CI 制品上传（仍禁止 HTML/大快照）。

## 4. 验收清单

- [ ] 同步包内无 `.env` / 密钥 / HTML / snapshot_*  
- [ ] GCP 侧无 OpenD 进程与 futu 依赖安装  
- [ ] 看板能读到新鲜 `as_of` / 时间戳字段  
- [ ] 失败时仅告警，不触发生产 C2 / 跟单  

## 5. 与 REQ-004 关系

本专节满足 **REQ-022** 安全约束；REQ-004 的具体通道选型（SCP vs 制品）在 Q-001 Human 拍板后另开实现任务。
