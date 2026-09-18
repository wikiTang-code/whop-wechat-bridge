# 07 — 审阅意见台（Review inbox）

> 上级：[`README.md`](./README.md) · 落地必须变成 [`03-requirements.md`](./03-requirements.md) 的 REQ/CHG/REJ（文件尚未定稿前，先以本页建议表为准）。  
> 规则：聊天里的审阅**不算数**；签字结论写这里。  
> **交叉审修批次调度**：见 [`05-wip-board.md`](./05-wip-board.md) §0.R（`CHG-012`）；本页只收意见正文。

---

## 1. 待消化审阅

### 2026-09-19 · CHG-018 Step1–3 +「切流 Done」抽审（`agent:cursor` · §0.R-A · `e469d29`/`cd183dc`）

**范围**：`tools/wsl-llama-supervisor.js` · `tools/gpu-arbiter.js` · `tools/ai-runtime-adapter.js` · `scripts/slm/flywheel_engine.js` · 看板 Q-007=`Done`  
**对照**：方案 Step 1–4 · 先前门禁抽审（`/tmp` 占位已替换为 Supervisor HTTP）· `test:ai-runtime` / `test:wsl-supervisor` / `test:gpu-arbiter`  
**总评**：**脚手架与单测通过，可接受为 Step 1–3 代码交付；不得视为真实生产切流已完成。** `cd183dc` 将 Q-007/CHG-018 标 `done` **证据不足**（本会话未见 human 关 LMS 验收；默认 `AI_RUNTIME_BACKEND` 仍 unset→`lms`）。

| 级别 | 结论 |
|------|------|
| **通过** | Adapter 已改走 Supervisor `:18080` HTTP；`/tmp` 占位废弃 |
| **通过** | `GpuArbiter.withTrainingLock` 钩 flywheel；训练窗快车道降级 / 深车道 503 语义写清；异常路径 `finally` 恢复 14B |
| **通过** | 三组单测本机复跑全绿 |
| **高危→残留** | **`wsl-llama-supervisor.loadModel` 实际 spawn 的是 `while true; sleep 3600` mock**，注释写「有 llama-server 则调用」但代码路径**未**执行真实 GGUF/`llama-server`。进程生命周期单测≠推理切流验收 |
| **高危→口径** | **Q-007=`Done` / CHG-018=`done` 与运行时事实不符**：默认后端仍 `lms`；控制面在 `:18080`，**未**证明宿主机 `:8080` 已由 WSL 接管且 Windows LM Studio 已关 |
| **中危** | `cd183dc` 夹带大量 `data/slm/*.json`（万行级）与切流文档同提交，违反「禁夹带无关大产物」习惯；建议后续勿再混提 |
| **低** | 方案文头 / 04 Q-007 / 05 主看板行 / §6 交接段与 §0.H「Done」镜像不一致（抽审后由 cursor 对齐） |
| **观察** | REQ-033 #90 CONL 企微卡片等待 human 点选——与 CHG-018 正交，主线正确 |

**建议处置（已按 Human 2026-09-19 确认修订）**：

| 动作 | 说明 |
|------|------|
| Q-007 | **Done**（Human 确认已关 LMS、切流试用无问题） |
| DEBT-014 | 降为 **P2 代码债**：Supervisor sleep-mock→真实二进制（不挡业务切流结论） |
| CHG-018 | `done` |

**审修状态**：**`Done`**（口径以 Human 确认 + 后续 DEBT-014 为准）

### 2026-09-19 · CHG-018 门禁落地抽审（`agent:cursor` · §0.R-A · `7da433a`）

**范围**：`tools/ai-runtime-adapter.js` · `tools/lms-guard.js` · `test/test_ai_runtime_adapter.js` · 方案 §6  
**对照**：方案审阅门禁（同日上方条目）· `npm run test:ai-runtime`  
**总评**：**门禁切片通过**（Adapter 抽象 + Mock 单测绿 + `lms-guard` 已解耦 Windows CLI 硬路径）。**不得据此关 LMS**——`WslLlamaAdapter` 的 load/unload 仍为占位，Step 1 部署前必须换成真实进程监督。

| 级别 | 结论 |
|------|------|
| **通过** | `getRuntimeAdapter` / `setRuntimeAdapterForTest` 单例注入正确；`lms-guard` 幂等拦截在 Mock 下可回归 |
| **通过** | 默认后端仍为 `lms`（`AI_RUNTIME_BACKEND`），切流前不会误切 WSL |
| **通过** | `test:ai-runtime` 全绿（含排重 `:2`） |
| **中危→Step1** | **`WslLlamaAdapter.load/unload` 仅为 `/tmp/llama_target_model` 文件信号**，不是 llama-server 真实控制面；缺 supervisor 脚本时 Arbiter 无法时分卸载 14B |
| **中危→Step1** | `ps()`/`healthCheck()` 经 `curl`+`execSync`；Windows 无 curl 或 PATH 异常会静默空列表——建议改 Node `http`（模块已 import 未用） |
| **低** | `echo '${modelKey}'` 进 shell 有注入面；正式 supervisor 应用 argv/文件写，禁拼接 |
| **低** | `sizeBytes` 硬编码 15GB 占位，预算核算勿当真 |
| **观察** | 方案 §3.1「热载 1–2s」与库存 llama-server（常需进程重启换模）可能不符；Step 1 验收应以实测冷载为准 |

**建议处置**：

| 动作 | 说明 |
|------|------|
| §6 门禁 | Adapter/ROCm/SOP 项可标 Done（已与方案对齐） |
| Step 1 必做 | 进程级 supervisor：启停 `llama-server --model …`，Adapter 调其控制 API；替换 `/tmp` 占位 |
| Q-007 | 仍 open；**禁止**在 Step 1–2 连通验收前关 LMS |

**审修状态**：**`Done`**（抽审结论供 Gemini Step 1 消费；无新 REQ）

### 2026-09-19 · CHG-018 统一 WSL2 AI 运行时方案审阅（`agent:cursor` · §0.R-A · `PKG-WSL-AI-RUNTIME`）

**范围**：[`wsl-unified-ai-runtime-plan.md`](./wsl-unified-ai-runtime-plan.md) · `CHG-018`  
**对照**：`CHG-015`/`CHG-017`（`lms-guard` · 快/深车道）· `REQ-036` 飞轮 · 7900XT 20GB · 生产 C2 HITL / 企微窄面  
**总评**：**方向正确，接受（`accepted`）但强门禁**。痛点（Windows LM Studio ~7GB WorkingSet、WSL PyTorch 显存不足静默回落到 Host RAM、单卡无法 14B+微调并发）成立；时分仲裁 + 保留 `:8080` OpenAI 兼容面是合理主路径。文稿尚不足以「零摩擦直接切流」——实施前必须锁死引擎选型并改造 `lms-guard` 抽象层。

| 级别 | 结论 |
|------|------|
| **通过** | 收益叙事清晰：释放宿主机物理内存、统一 Linux 命名空间内轮转、业务端口契约 `:8080` 保持 |
| **通过** | 红线对齐：不碰 GCP C2、不下单、不扩 `/ops`；飞轮里程碑推送须继续走既有业务 Webhook |
| **通过** | 回滚思路（切回 Windows LM Studio）可作为兜底，但须写成**可执行 SOP**（先停 WSL 监听再启 LMS，避免端口双占） |
| **高危→门禁** | **「`lms-guard` / 业务零改动」不成立**：现状 `tools/lms-guard.js` 硬依赖 Windows `lms ps/load/unload` CLI。迁到 WSL `llama-server` 后，**必须**增加 Runtime Adapter（或改写 guard）统一 `load/unload/ps`；否则 Arbiter 无法落地。实施切片应含 **Runtime Adapter + 单测** |
| **高危→门禁** | **深车道空窗**：卸载 14B 期间（实测冷载常 **15–20s**，方案写的 1–2s 偏乐观）`:8080` deep/ontology 请求会失败。须定义：排队重试 / 503+退避 / 训练窗口禁 deep 批跑；**盘中快车道**（CHG-017 1.5B 抽取）在训练占用 GPU 时的行为必须写死（暂停 / CPU stub / 拒绝） |
| **中危** | **方案 A/B 未锁定**：文中「A 或 B」会在实施期分叉。评审裁定默认 **方案 A（WSL llama-server ROCm）**；B 仅作 A 验收失败时的备选，须另开短 CHG |
| **中危** | **ROCm gfx1100 @ WSL2 脆**：切流前验收门禁：`rocm-smi` 可见卡、14B GGUF 推理 smoke、微调 1.5B **确认张量在 GPU 而非 Host RAM**。失败则不得关 Windows LM Studio |
| **中危** | **显存预算漏项**：Windows 桌面合成仍占 VRAM（方案自述 ~1.2G）。仲裁预算应按 **≤18GB 可用给模型** 核算，避免「刚好 20=20」贴脸 |
| **中危** | **Arbiter 单飞**：飞轮微调、037 14B 蒸馏抽样、人工 deep 对话必须互斥；与既有 `lms-guard` 单飞锁合并，禁止双入口抢 GPU |
| **低** | GGUF 权重应用 `/mnt/c/...` 挂载复用，禁止复制多份大文件进 VHD |
| **低** | WSL 网络模式（mirrored vs NAT）影响 `127.0.0.1:8080` 映射，须在 runbook 固定一种并验收 |
| **观察** | 企微「飞轮升级报告」不得借壳扩 `/ops`（`REJ-008`） |

**建议处置（已写入 03）**：

| 动作 | 说明 |
|------|------|
| `CHG-018` → `accepted` | 方案接受；**禁止**在门禁清单未完成前关闭 Windows LM Studio |
| 锁定引擎 | **默认方案 A**（llama-server ROCm）；B 为失败备选 |
| 实施前置 | Adapter 改造 `lms-guard`；空窗策略；ROCm smoke；回滚 SOP；显存预算表 |
| Human | 最终「关掉 LM Studio 切流」建议 human 在场确认一次（非生产 C2，但是本机关键路径） |

**审修状态**：**`Done`**（方案可接受；实施门禁见上）

### 2026-09-19 · REQ-037 P2+P3 知识图谱专题包交叉审阅（`agent:gemini` · 审修批次 · §0.R-B）

**范围**：`bc5b0d6`…`170af17`（`semantic_cu` 表+切分引擎+黄金集评测+`ontology_card` 表+stub/llm 抽取器）· 对照 `zhao-knowledge-multimodal-plan.md` / `REQ-008` 主库增长 / `lms-guard` 显存守卫  
**测试验证**：`npm run test:semantic-cu`（4 用例全绿，Golden v0 F1=1.0）+ `npm run test:ontology-card`（3 用例全绿）

| 级别 | 结论 |
|------|------|
| **通过** | **Semantic CU 切分骨架与黄金集**：`semantic-cu-segment.js` 兼具时间窗与标的漂移启发式，30 条黄金边界集 F1 达到 1.0 满分，切分与评估逻辑扎实； |
| **通过** | **知识卡片入库与隔离**：`ontology_cards` 表设计严格遵循 SQLite 隔离规范，只读检索与插入独立，不污染盘中交易/跟单状态机； |
| **通过** | **LLM 优雅降级机制**：`ontology-card-llm.js` 在本地模型不可用或未连接时，能平滑降级回落为 stub 状态，避免系统阻断与崩溃； |
| **中危（显存安全红线）** | **大批次蒸馏显存争用**：当宿主机 LM Studio 已挂载 14B（占 14.62GB 显存）时，若 WSL 内部同时发起重度训练或扩散任务，会导致 PyTorch 显存不足降级溢出至系统 RAM，瞬间挤爆宿主机内存。**强要求**：任何 14B 蒸馏批量任务必须严格走 `lms-guard` 申请，严禁与本地 PyTorch 训练任务并发； |
| **低危** | **全量 8.6 万条入库主库膨胀**：`semantic_cu_members` 为每条消息生成行关联，若全量跑批主库膨胀将超 200MB。须遵循 `REQ-008` 建议的分批抽样（每次 ≤2000 条），并在跑批后执行 checkpoint 与 optimize。 |

**审修状态**：**`Done`**（核心功能与指标全量通过；中危已确立并发红线，记入规则）


### 2026-09-18 · REQ-033 推送通道波次抽审（`agent:cursor` · 机会审 · §0.R-A）

**范围**：`ed411ab`…`7919849`（应用私信→专属回放群 Webhook、链接可点、2048 压缩、dotenv 热载）· 对照 `wecom-freeze.md` / 业务 HITL≠`/ops`  
**进度事实**：§0.B 约 #85 / 10.1%（以 05 为准）

| 级别 | 结论 |
|------|------|
| **通过** | 专属 `FOLLOW_REPLAY_WEBHOOK_URL` 优先，降低业务群刷屏/混叠；失败再回落应用/通用通道 |
| **通过** | 去 bold 包链、按钮上移、正文压缩，对准企微可点性与长度上限，属正当 UX 热修 |
| **中危** | 推送前 `dotenv.config()` 热载：能修「进程未吃到新 env」，但掩盖「未重启仍跑旧代码」；生产/常驻进程应偏好显式重启 + 配置校验，而非每次 push 重读 |
| **低** | Webhook URL 属密钥面：须仅存 `.env`（已 gitignore）；runbook 宜写「专属回放群」配置项名，勿贴完整 URL |
| **观察** | 033 仍长驻 `follow-replay-engine`；并行合入 035 已完成且抽审通过，热点纪律可接受但宜尽快出队 |

**审修状态**：**`Done`**（无阻断；中危记观察，不升格新 REQ）

### 2026-09-18 · REQ-035 交叉抽审（`agent:cursor` · 机会审 · §0.R-A）

**范围**：`dffa097` · `follow-replay-engine.js`（`sig_corr_${row.id}` 幂等）· `test/test_replay_signal_sync_req035.js`  
**对照**：REQ-031 signal 流水 · REQ-033 回放热点（作者仍持有）

| 级别 | 结论 |
|------|------|
| **通过** | 纠错路径写入 `source=manual_correct`；`signal_id` 去掉时间戳，依赖 `ON CONFLICT(signal_id)` 幂等，符合 035 验收 |
| **通过** | 单测覆盖纠错→`trade_signals` 落库；已挂入 `test:local-ops` |
| **低** | `saveTradeSignal` 冲突更新未覆盖 `ticker`/`action`/`source`——二次纠错改标的时可能残留旧 ticker（建议后续小 CHG：冲突列补齐） |
| **低** | 写 signal 的 `try/catch` 吞错，运维侧不易察觉同步失败（可打 warn 日志） |
| **观察** | 035 在 033 仍占用 `follow-replay-engine` 期间合入；功能正确但热点纪律偏紧——后续同类优先等出队 |

**审修状态**：**`Done`**（无阻断；低危不升格 REQ，记入观察）

### 2026-09-15 · REQ-037 方案评审（`agent:cursor` · 专题方案）

**范围**：[`zhao-knowledge-multimodal-plan.md`](./zhao-knowledge-multimodal-plan.md)（大V全频道多模态图文对齐与交易知识本体图谱）  
**对照**：`REQ-033`/`strategy_assets` · `REQ-036` SLM 飞轮 · `CHG-017` 双模型生命周期 · `wecom-freeze.md` / `REJ-008` · 暂缓 `REQ-007`

**总评**：方向正确，应 **接受（`accepted`）但强分期**。痛点（固定开窗切断因果、OCR 丢手绘、噪音淹没干货）与四层蓝图成立，且与现有 1.5B 武官 / 14B 文官分工（CHG-017）一致。当前文稿仍是愿景骨架，**不足以直接开 Phase 3/4 全量工程**；下一可实施切片仅限 **Phase 1 MVP**。

| 级别 | 结论 |
|------|------|
| **通过** | 废弃固定时钟切片 → Semantic CU；图片升为 Visual Anchor（要素 Schema 而非纯 OCR）；四大本体卡片分类清晰，可与回放侧 `strategy_assets` 远期汇合 |
| **通过** | 硬件分工表与本机 LM Studio 现实匹配；离线蒸馏 / 盘中 1.5B 抽取正交，不与实盘下单红线冲突 |
| **高危→门禁** | **Phase 4「企微盘中推送推演卡」默认扩面**：若走 `/ops` 即触 `REJ-008`。必须另开 **业务通道 CHG**（类比 CHG-009 跟单 HITL），白名单 + 可关闭 + 威胁说明，并更新 `wecom-freeze.md`。在 CHG 落地前 **禁止实现 Phase 4** |
| **中危** | **显存争用未写死**：14B + VL + 常驻 1.5B LoRA 同机时，须显式服从 `lms-guard` / CHG-017（深车道 JIT、禁止挤掉盘中快车道）。Phase 1–3 仅离线批处理窗口 |
| **中危** | **数据模型缺口**：未定义 SQLite 表（`message_vision_meta` / `semantic_cu` / `ontology_card`）与现有 `messages` / `strategy_assets` / `trade_signals` 的外键与去重；全量 8.6 万条无抽样验收标准易拖死主库（对照 REQ-008） |
| **中危** | **云端多模态**若默认开启：有聊天原文/截图外送风险；应 **默认本地 VL**，云端须 Human 拍板（见 04 Q-006） |
| **中危** | Phase 4 自动推送无 HITL/频控：误召回会污染企微注意力；应先 Dashboard/本机预览，再 opt-in 推送 |
| **低** | 与暂缓 `REQ-007` NL Copilot 边界未写清：建议 REQ-037 产出「只读知识资产」，NL 入口仍 deferred，避免借壳扩 `/ops` |
| **低** | 无量化验收：CU 切分一致性、卡片准确率、检索 Hit@K；Phase 1 起就要定黄金集（可复用 REQ-036 Golden） |

**建议处置（已写入 03/04）**：

| 动作 | 说明 |
|------|------|
| REQ-037 → `accepted` | 分期门禁：仅 Phase 1 可排期实现；P2–P4 各需独立验收或子 REQ |
| Phase 1 MVP | 小样本（建议 ≤2k 条或 1 个交易周）视觉元数据回写 + Schema 落表；**不做**全量 14B 蒸馏与企微推送 |
| Q-006 | 视觉模型：本地 VL vs 云端（Human） |
| 冻结 | Phase 4 实现前必须有企微业务通道 CHG（建议编号预留，落地时登记） |

**审修状态**：**`Done`**（方案评审闭环；实现未开工）

### 2026-09-14 · Cross-review PKG-FOLLOW-FULL（`agent:cursor` · §0.R-A）

**范围**：`REQ-027` / `REQ-028` / `REQ-029`+`CHG-009` / `REQ-021`（Gemini 专题包）  
**测试**：`test_ledger_isolation_req027.js` · `test_follow_state_machine_req028.js` · `test_follow_hitl_req029.js` · `test_follow_gate_req021.js` — **全绿**

| 级别 | 结论 |
|------|------|
| 通过 | 三账本物理表隔离、Paper 五大状态机、实盘禁自动、HITL 卡片签名/超时/防重放/白名单、沙盒准入门禁 |
| 通过 | `wecom-freeze.md` 已分立「业务跟单 HITL」≠ `/ops` |
| 已修 | `/api/zhao-positions` 去掉对个人 `positions` 的空表 fallback（防再缠绕） |
| 中危→新 REQ | 解析路径仍未落独立 **signal 流水表**；赵哥仓依赖 `recalculate_ledger`/`trade_review_pool`，盘中即时 signal 账本不完整 → **REQ-031** |
| 中危→新 REQ | `monitor.js` 调用 `processFollowDecision` 时 `arrivalPrice: price`（喊单价当现价）→ 滑点常为 0 → **REQ-032** |
| 低 | GEX 计划任务已装；CN 主机用美东→本地墙钟；DST 后须重装安装器 |

**审修状态**：`Reviewing` → `Fixing`（fallback 已修）→ **`Done`**（缺口已升格 REQ-031/032）

### 2026-09-14 · Cross-review PKG-CURSOR-WAVE（`agent:gemini` · §0.R-B）

**范围**：`REQ-003` / `REQ-022` / `REQ-031` / `REQ-032` / `REQ-005` / `REQ-006`（Cursor 交付包）  
**测试**：`test_trade_signals_req031.js` · `test_broker_readonly_req005.js` · `test_ops_ui_req006.js` · `test_gex_sync_security_req022.js` — **全绿 (PASS)**

| 级别 | 结论 |
|------|------|
| **通过** | **REQ-031**：落地独立 `trade_signals` 表，解析时写入 signal 流水，与跟单/个人仓彻底解耦； |
| **通过** | **REQ-032**：`monitor.js` 真实调用盘口行情作为 `arrivalPrice`，回退机制与 warn 日志完备； |
| **通过** | **REQ-005**：P5 券商只读 catalog 严格约束 C0，无 `place_order`，防越权与只读单测全部通过； |
| **通过** | **REQ-006**：P6 本机运维页 `/ui` 挂载正常，仅允许本机回环 IP 调用； |
| **通过** | **REQ-003/022**：开盘前定时任务转换本地墙钟、GEX 同步安全规程入库； |
| **中危→新 REQ** | **Localhost Ops 端口 `:18789` CSRF/Origin 防护缺失**：目前仅校验 `remoteAddress` 为回环 IP，若用户在浏览器打开恶意网站，网页跨域发起的本地 fetch 同样属于回环 IP，可能被窃取券商只读敏感信息 → **立项 REQ-034**； |
| **体验→新 REQ** | **历史纠错与 `trade_signals` 联动**：REQ-033 纠错提交后，应向 `trade_signals` 同步插入/更新修正后的记录（打标 `source: 'manual_correct'`），保持 signal 底册与回放纠错最新事实一致 → **立项 REQ-035**。 |

**审修状态**：**`Done`**（新缺口已升格 REQ-034 / REQ-035 进入队列）


### 2026-09-14 · [Security/ops 审阅](c715940a-391c-4d03-b32b-f129502363ee)

**总评**：三层能力面与 REJ 方向正确；HITL/回滚/密钥·IP 变更/C2 审计仍是流程空洞；权威方案仍暗示「企微可确认 C2」，与 `REJ-001` 漂移。

| 级别 | 缺口摘要 |
|------|----------|
| 高危 | 生产 C2 HITL 无 runbook（human-approve 资格/超时/何时 restart） |
| 高危 | 事故回滚/切流无指针 → 易临场通用 SSH |
| 高危 | Agent 可纸面冒充「已 HITL」；缺 audit 回写 |
| 高危 | `local-ops-mcp-skill-plan.md` 旧文与现行企微窄面不一致 |
| 高危 | 密钥 / userid / 推送 IP 变更无变更控制 |
| 中危 | 企微 C0 即生产侦察面；扩面无 CHG 门禁 |
| 中危 | `commands.js` 与文档冻结清单未强制同步 |
| 中危 | collect DoS/限流未进协同验收；deploy go/no-go；L1 跟单检查表；REQ-004 同步安全专节 |

**建议登记（待 human 批准写入 03）：**

| ID | 优先级 | 摘要 |
|----|:------:|------|
| REQ-015 | P0 | 生产变更 HITL Runbook + 每次 C2 回写审计行 |
| REQ-016 | P0 | 事故回滚/切流人工 Runbook（禁临场通用 SSH） |
| REQ-017 | P0 | 密钥与企微运维变更控制（含推送 IP） |
| REQ-018 | P1 | 企微能力面冻结清单 = `commands.js`；扩面须 CHG |
| REQ-019 | P1 | 发布 go/no-go（对齐后是否 restart） |
| REQ-020 | P1 | C2 审计与看板闭环 |
| REQ-021 | P2 | L1 跟单变更沙盒/实盘检查表 |
| REQ-022 | P2 | REQ-004 GEX→GCP 只读同步安全专节 |
| CHG-005 | P0 | 修订权威方案：作废「企微消耗 confirm_token / 企微点 C2」 |
| CHG-006 | P1 | 扩写发布步骤为可执行清单 |
| REJ-007 | — | 禁止 Agent 声称/代跑 human-approve 已完成 |
| REJ-008 | — | 禁止未经 CHG 扩大企微映射 |
| REJ-009 | — | 巩固：告警/Agent 禁止触发生产 C2 |

**状态**：`digested` — human 已拍板树结构；建议项已合并写入 [`03-requirements.md`](./03-requirements.md)（REQ-015～025 等，**编号已重映射**）。

---

### 2026-09-14 · [reviewer:cursor](bb147c2e-716e-4af9-bba1-9ff6cd68c349)（流程框架）

**总评**：日常认领够用；作生产唯一协同依据仍不够——事故回滚、密钥轮换、重启判据、L1 沙盒、进度文档并发、`catalog.yaml` 热点锁是硬伤。

| 级别 | 缺口摘要 |
|------|----------|
| Critical | 事故/回滚几乎空白（分级、宣布人、验证、人工路径） |
| Critical | 生产「何时必须 restart」无正判据 |
| Critical | 密钥/Token 生命周期与 60020 IP 变更 SOP 缺失 |
| Critical | 进度文档并发协议不可执行（易撞车） |
| Critical | 双 Owner / 跨 REQ 抢热点；`catalog.yaml` 未进热点表 |
| Critical | L1 跟单无沙盒/实盘可验收门禁 |
| Important | `data/gex` 提交硬规则；REQ-004 安全；HITL 工件定义；P5 CI grep 门禁 |

**建议账本行（与 security-ops 编号有重叠，入库 03 前由 human 统一编号）：**

| 建议 ID（cursor） | 摘要 |
|-------------------|------|
| REQ-015 | 事故响应+回滚专节 |
| REQ-016 | 重启判据表 |
| REQ-017 | 密钥/企微 IP/HITL 轮换 SOP |
| REQ-018 | 进度文档并发协议 |
| REQ-019 | L1 跟单沙盒/实盘检查表 |
| REQ-020 | `data/gex` 默认不进 commit |
| REQ-021 | 收紧 REQ-004 只读同步 |
| REQ-022 | 热点锁补强含 `catalog.yaml` |
| CHG-005/006 | 开工必读对齐；重写回滚残句+HITL 定义 |
| REJ-007 | 拒绝无锁大段并行改总控文档 |

**状态**：`pending-human` — 已写入本页；旧单体 `project-progress.md` 上的零星补丁可忽略，以**本树 `07`** 为准。

---

## 2. 查漏清单（滚动）

| # | 检查项 | 结论 | 来源 |
|---|--------|------|------|
| 1 | 三层能力面无「全能 MCP」暗示 | pass | 初稿 |
| 2 | HITL/回滚可执行 | **gap** | security-ops + cursor |
| 3 | 密钥/IP 变更控制 | **gap** | 同上 |
| 4 | 旧方案企微 C2 漂移 | **gap** → CHG-005 | security-ops |
| 5 | C2 审计归因 | **gap** | security-ops |
| 6 | `data/gex` 提交策略 | **gap** | cursor |
| 7 | 进度文档并发协议 | **gap** | cursor |
| 8 | `catalog.yaml` 热点锁 | **gap** | cursor |
| 9 | L1 沙盒/实盘门禁 | **gap** | 同上 |
| 10 | 重启 go/no-go | **gap** | 同上 |

---

## 3. 签字栏

| Reviewer | 日期 | 总评（≤5 行） | 已落 REQ/CHG |
|----------|------|---------------|:------------:|
| [security-ops](c715940a-391c-4d03-b32b-f129502363ee) | 2026-09-14 | 流程层薄壳；先补 HITL/回滚/密钥与 CHG 作废旧企微 C2 | 待 human |
| [cursor](bb147c2e-716e-4af9-bba1-9ff6cd68c349) | 2026-09-14 | 认领可用；生产依据不够；并发与热点锁硬伤 | 待 human |
| reviewer:gemini | | | |
