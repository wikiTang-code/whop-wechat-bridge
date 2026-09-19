# 运行环境合同（什么处理跑在哪）

> **权威**。其它方案只描述能力，不另写第二套「在哪跑」。  
> 机器可读：[`environments.json`](./environments.json) · 账本：`CHG-026`（冻结）· 产物自动上 SoR：`REQ-039`  
> 上级：[`README.md`](./README.md) · 盘点债：[`04` DEBT-015](./04-leftovers-problems.md)

**原则**：计算可以在 GPU 机上跑；**系统真相源（SoR）必须是规划环境**。GPU 产物留在本机库 ≠ 交付。

---

## 1. 四台角色（禁止混用）

| ID | 角色 | 跑什么 | 不跑什么 |
|----|------|--------|----------|
| **gcp-vm** | 生产服务 | ingest、企微推送、看板、跟单回放、消息/媒体 SoR、知识表 **服务副本** | OpenD、GPU、MCP/Agent 宿主、整库覆盖 |
| **win-host** | 控制面 | Local-Ops `:18789`、GpuArbiter、OpenD、GEX collect、SSH 配方、计划任务 | 生产 ingest、当知识 SoR |
| **wsl-gpu** | GPU 计算 | llama-server、LoRA 飞轮、14B 蒸馏 | 生产消息写入、当消息 SoR |
| **cloud-vl** | 离线视觉 | Q-006 / REQ-038-T1 图→`message_vision_meta` | 聊天原文外送、L2a/下单 |

**git**：代码 + 里程碑 `data/gex/latest.json`。禁 `*.db`、媒体全量、GEX HTML、`*.safetensors`。

---

## 2. 工作负载矩阵

| 处理 | 计算环境 | 真相源 SoR | 产物 | 自动流 |
|------|----------|------------|------|--------|
| 聊天归档 / 附件 | gcp-vm | **gcp-vm** `messages` + `data/media/zhao` | SQLite + 文件 | 已在生产 ingest |
| 企微推送 / 回放 / 看板 | gcp-vm | gcp-vm | pm2 双进程 | 代码 ff（HITL restart） |
| GEX 拉链 | **win-host** + OpenD | win-host `data/gex/latest.json` | json/html | 采集留本机 |
| GEX→看板 | win-host SCP | gcp-vm 副本 | `latest.json` | **已有** `gex:sync-gcp`（REQ-004） |
| Local-Ops / 企微 `/ops` | win-host | win-host | catalog | 本机网关 |
| 14B / 1.5B 推理 | **wsl-gpu** | 运行时（无库） | HTTP `:8080` | 切流 CHG-023 |
| SLM LoRA 飞轮 | **wsl-gpu** | **wsl-gpu** `models/…/lora` | safetensors | **不上 gcp**（生产无 GPU） |
| **知识蒸馏** | **wsl-gpu** | **gcp-vm** 知识表 | `ontology_*` | **已有** `knowledge:promote`（HITL `--allow-prod-write`） |
| 云端 VL 批 | **cloud-vl** | **gcp-vm** `message_vision_meta` | 白名单字段 | 读 gcp 媒体；结果表走 promote |
| 战法卡归因 | win-host（Yahoo） | **gcp-vm** 知识表 | `data/runtime/*.json` | 先有 SoR 卡再打分 |

蒸馏的**输入**也必须是生产 `messages` 只读快照（或正式 replica），禁止长期拿过期本机库当语料还当结案。

---

## 3. 允许 promote / 严禁覆盖

| 允许表级导入 gcp（空则插入 / 按主键幂等） | 严禁从本机覆盖 |
|------------------------------------------|----------------|
| `ontology_card` | `messages` |
| `ontology_distill_scanned` | `trade_signals` |
| `message_vision_meta` | `zhao_positions` |
| `semantic_cu` | `follow_decisions` · `strategy_assets` |

整文件替换生产 `whop_archive.db` = **事故**（本机 messages 90456 < 生产 109157）。

生产写库走 **HITL / 预注册配方**（`REQ-039`），禁止 Agent 随手 `scp` 整库、禁止「无损同步 1995 张卡」的无门禁脚本当正式通道。

---

## 4. 现状（2026-09-19 首次 promote 后）

- 知识表 SoR：**已对齐** gcp `ontology_card=4032` / `ontology_distill_scanned=3154` / `message_vision_meta=38`；`messages=109157` 未覆盖。
- 媒体 SoR：gcp **568**（本机 441 已补上；prod-only 127 保留）。
- 蒸馏/VL 仍先写本机；跑完必须再 `knowledge:promote --remote --apply --allow-prod-write`。
- LoRA：**符合**（不上 gcp）。GEX SCP：**符合**。

盘点：`npm run env:inventory` · 上 SoR：`npm run knowledge:promote`（dry-run）→ `--dump` → `--remote --apply --allow-prod-write`。

---

## 5. Agent 开工检查

新任务先问三句，再写代码：

1. **计算**在 win-host / wsl-gpu / gcp-vm / cloud-vl 哪一个？  
2. **SoR** 是哪一个？产物是否会自动到达 SoR？  
3. 是否误把本机 SQLite / 本机 media 当成生产？

答不出就先改本页，再开跑。
