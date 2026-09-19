# 04 — 遗留 · 开放问题 · 风险 · 技术债

> 上级：[`README.md`](./README.md) · 未立项记本页；成熟后 **Promote → [`03-requirements.md`](./03-requirements.md)**

**快照**：2026-09-18（文档树卫生：闭环债与开放表对齐）

---

## 1. 硬规则（已拍板，同步 [`06`](./06-process.md)）

### 1.1 `data/gex` Git 策略（`REQ-024` + Q-003 已决）

| 路径 | Git |
|------|-----|
| `data/gex/latest.json` | **允许入库，但仅里程碑式提交**（见下） |
| `data/gex/*.html` | **严禁提交** |
| `data/gex/snapshot_*.json` 等大快照 | **严禁提交** |

**里程碑式 `latest.json`（严禁盘中例行 commit）**

- 日常/开盘/定时拉链：结果留**本地盘**；上云看板走 SCP/同步配方（REQ-004），**不要**每次 `git commit`。  
- **仅当**以下之一才允许 commit 一次 `latest.json`：基准打桩更新、版本发版验证、重大结构/schema 变动。  
- 提交前必须 `git status`；禁止 `git commit -a` 夹带 HTML/大文件。

---

## 2. 遗留（滚动）

| 债 ID | 摘要 | 关联 | 严重度 |
|-------|------|------|:------:|
| DEBT-001 | 生产 gcp-vm ff 对齐 | REQ-002 | **Done**（Human 2026-09-19 确认 pull + pm2 restart） |
| DEBT-014 | **CHG-018/023 Supervisor+切流**：CPU `llama-server` + Win bridge 已满血可用；HIP 编译仍缺完整 ROCm | CHG-018/023 | **P3 残留**（HIP） |
| DEBT-015 | **知识资产只在本机、未进生产库**（见 §2.2） | REQ-039 表级 promote **Done**（gcp `ontology_card=4032` / `message_vision_meta=73`，`messages=109159` 仅 ingest 增长） | **Done** |

### 2.2 本机 vs git vs 生产（2026-09-19 Cursor 盘点）

**禁止**把本机 ~294MB `whop_archive.db` 整文件盖掉生产 ~950MB 库（生产 `messages` 109159 > 本机 90456）。

| 资产 | 本机 | git | gcp-vm | 处置 |
|------|-----:|-----|--------|------|
| `ontology_card` | **4032** | 不入库（`*.db` ignore） | **4032**（REQ-039 表级 promote） | 日常蒸馏后 auto-dump，HITL apply |
| `ontology_distill_scanned` | 3154 | 不入库 | **3154** | 同上 |
| `message_vision_meta` | 73 | 不入库 | **73** | VL 仍写本机，跑完 promote（跳过 100.5/120 fixture） |
| `semantic_cu` | 0 | — | 0 | 两边都空 |
| `strategy_assets` | 5 | 不入库 | 0 | 随跟单资产，勿覆盖生产消息 |
| `zhao_positions` | 27 | 不入库 | 0 | 本机账本切片，生产以 ingest 为准 |
| `trade_signals` | 457 | 不入库 | 91 | 生产回放进度不同，禁止覆盖 |
| `messages` | 90456 | 不入库 | **109159（ingest 自然增长）** | **生产为准** |
| `data/media/zhao` | **441** | 近月 untracked | **568**（本机缺图已上；prod-only 127 保留） | SoR=gcp；不 git add |
| `models/zhao_slm_1.5b_lora/*.safetensors` | **17MB** 权重 | **gitignore**（只跟踪 tokenizer/config） | **无权重**（仅 config） | **符合 CHG-026**：SoR=wsl-gpu，不上 gcp |
| `data/gex/latest.json` | 有 | 里程碑可提交 | 有（SCP） | 维持 REQ-024，禁盘中 commit |
| REQ-038-T2 实跑 | candidates=15 / with_level=11 / yahoo_eligible=0（11 mixed） | 口径在 git | 知识表已 promote | 可打分集空因 mixed，不是 Yahoo |

**T2 结论**：Yahoo 通。11 张有点位但方向 mixed 不打分；4 张无点位。等 T1 真 TSLA VL。catalog C2 见 **CHG-027 Done**。

合同见 [`environments.md`](./environments.md)。**自动流**（REQ-039）：知识表/媒体走 promote·rsync；禁止整库覆盖；禁止无门禁「同步 1995 张卡」。盘点：`npm run env:inventory`。

### 2.1 已闭环（勿再当开放债）

| 债 ID | 关闭说明 |
|-------|----------|
| DEBT-001 旧义「未 push」 | REQ-001 Done；`origin/main` 已含 local-ops+docs |
| DEBT-002 | REQ-003 Done；本机 Task `WhopGexOpenSession0940ET` Ready；DST 残留见 DEBT-013 |
| DEBT-003 | REQ-004/022 Done；SCP 脚本 + 安全专节；Q-001 interim=SCP |
| DEBT-004 | REQ-005/006/008 Done |
| DEBT-005 | REQ-015/016/017 Done；runbooks 已入库 |
| DEBT-006 | CHG-005 Done；方案已作废「企微点 C2」 |
| DEBT-007 | REQ-018 Done；见 `wecom-freeze.md` |
| DEBT-008 | REQ-020 Done；gateway 审计 + `runbooks/c2-audit-loop.md` |
| DEBT-009 | REQ-021 Done |
| DEBT-010 | REQ-023 Done；见 06 §3 |
| DEBT-011 | REQ-027～029 Done；031/032 亦 Done |
| DEBT-012 | REQ-031/032 Done |
| DEBT-013 | open_session_run.py 美东时区感知 (America/New_York) 与自适应等待闭环；install_open_session_task.ps1 锚定夏令时最早本地唤醒 (21:38)，免疫每年 DST 切换，单测全部 PASS |

---

## 3. 开放问题

| Q | 问题 | 决策人 | 状态 |
|---|------|--------|------|
| Q-001 | GEX→GCP：SCP / 制品 / 其它？ | human | **interim 已决：SCP**（`sync_latest_to_gcp.js`）；制品通道可再改 |
| Q-002 | 漏重启用何信号发现？ | human+L4 | **Done**（`CHG-020`：`/health` 暴露 `process.gitCommit`，`gcp_health_bundle` 自动计算 `restart_drift` 与 `drift_detail`） |
| Q-003 | 每次拉链是否 commit `latest.json`？ | — | **已决：否；仅里程碑**（§1.1） |
| Q-004 | P5 是否加 CI `place_order` grep？ | L5 | decided：单测+load-catalog 硬拒；catalog 文本禁 place_order |
| Q-005 | 跟单确认通道：企微业务卡片 vs Dashboard 移动页？ | human | **已决：企微业务确认卡片**（盘中 90s 时效；≠ `/ops`） |
| Q-006 | REQ-037 视觉模型：本地 VL vs 云端多模态？ | human | **已决：云端轻量 VL 离线批**（不占本地 14B/OM 显存时分；字段白名单 `ticker/timeframe/levels/pattern_notes`；禁进 L2a actions；磁盘 files=441 / uniq_sha=421 / >15KB=432） |
| Q-007 | CHG-018 门禁达标后是否关闭 Windows LM Studio 切到 WSL llama-server？ | human | **Done**（2026-09-19 Human 确认已关 LMS、切流试用无问题；cursor 本机见 `:8080/v1/models` 仍可列模型） |
| Q-008 | REQ-038-T1 云端 VL 实跑密钥 | human | **Done**（已配置纯 Free Tier 密钥；实测首张真实 K 线图抽取成功：标的 SPY、形态双底、支撑 675.98/阻力 682.44、手绘双红箭头精准识别；纯免费额度，0 扣费） |

---

## 4. 风险

| 风险 | 缓解 | 状态 |
|------|------|------|
| 家宽 IP→60020 | GCP 借道推送 | 已缓解 |
| 企微失陷→C0 侦察 | 白名单 + REQ-018 | 残留 |
| Agent 纸面 HITL | REJ-007 + REQ-015/020 + CHG-006 | **已缓解**（runbook+清单） |
| 多 Agent 改总控撞车 | 05/07 拆分 + REQ-023 | 部分缓解 |
| GEX HTML / 盘中 json 刷爆历史 | REQ-024 + 里程碑策略 | 已拍板 |
| 赵哥仓/跟单仓数据缠绕 + 无盘中确认 | REQ-027～032 | **已缓解** |
| GEX 开盘任务 DST 漂移 | open_session_run.py 美东对齐 + install_open_session_task.ps1 锚定最早唤醒 · DEBT-013 | **已缓解**（DEBT-013 Done） |
