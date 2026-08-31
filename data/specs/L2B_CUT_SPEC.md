# L2b 全频道战法与风控知识切窗规范 (L2B Cut Specification)

> **版本**：v1.1  
> **状态**：严格草案 (Queue 维持 `paused: 2064`，禁止在审批通过前启动切窗或解冻队列)  
> **核心原则**：L2b 是**战法、纪律、风控与图表知识提取流水线**，与 L2a 跟单流水线物理硬隔离，**输出绝对禁止包含 BUY/SELL 实盘指令**。

---

## 一、数据源范围与主键铁律 (Sources)

### 1. 频道路由准入 (赵哥全频道发言)
L2b 的提取目标是赵哥的完整认知体系与战法纪律，因此全频道的赵哥发言均可作为知识切窗来源：
- **`forum_feed_1CTr7SqVMzFfuFiiRJLEHN`**（历史股票期权记录区）：长文战法、量化复盘、出货教案；
- **`chat_feed_1CTr7QocNpDZ9FXZ6fvWe4`**（不用翻墙美股发布）：盘中实时宏观判断、突发事件应对；
- **`chat_feed_1CTrCEx44dP13jW3RVkYiS`**（不用翻墙期权）：期权异动观察、对冲纪律；
- **`chat_feed_1CU95KbtifP1JtuqTiVXZb`**（讨论区股票记录）：**核心配图金标专区（g_img_001~005 全部在此频道）**；
- **`chat_feed_1CWLuNUVYVVYttro8gAvJ5`**（市值理论100跌50 公式记录）：反弹一半 `(高+低)/2` 公式专项 (共8条)；
- **`chat_feed_1CTr5VAdNHtbZAFaTitvoT`**（不用翻墙美股讨论区）：赵哥在群内的答疑与战法解释。

### 2. 与 L2a 广播窗的双轨处理原则
- 已经在 L2a 中切过跟单动作的广播窗（例如“急跌买回”、“二次握手确认”），**仍需进入 L2b 切窗提取战法知识**（纯成交口播可挂在 L2a 同窗上抽一句 statement，但其本身不作为新独立锚点）；
- **红线铁律**：L2b 抽取的产物必须定性为“战法/风控闸门”，**其输出绝对禁止生成 BUY/SELL 订单**。

### 3. 主键约束
- 统一使用权威登记册 [`config/channel_registry.json`](../config/channel_registry.json) 中的 `feed_id` 作为唯一主键；
- 严禁通过频道中文名子串正则反向猜测归属。

---

## 二、切窗规则与口诀锚点机制 (Windowing vs L2a)

L2b 切窗机制与 L2a 存在根本性差异：

| 维度 | L2a 交易跟单切窗 | L2b 战法知识切窗 (本规范) |
|---|---|---|
| **切窗目标** | 提取明确的建仓/加仓/减仓/清仓动作 | 提取战法原子、风控纪律、图表形态与口播观察 |
| **触发锚点** | 单个或成组的交易口播脉冲 | **战法口诀锚点：因果、公式、纪律、形态、答疑** |
| **空动作处理** | 无动作者标记为纯观点空窗 | **不为成交拆单，绝不因 actions 为空而丢弃窗口** |
| **配图机制** | 图作为辅助凭证 | **配图作为一等公民 (g_img_001~005 / OCR / 形态解析)** |
| **金标覆盖** | 覆盖交易样本 | **金标 G4/G5（精准对齐 post_id）必须 100% 被切中** |

### 1. 严格收紧战法口诀锚点（禁止“泛逻辑/总结”过度开窗）
严禁将单纯的成交流水（如“854出掉mu”、“49.9出掉dram”）切成战法窗。锚点发言必须满足以下**五类口诀特征之一**：
1. **因果推导**（“因为...所以...”、“...是为了应对...”、“...才会...”）；
2. **公式计算**（`（高+低）/2`、反弹一半、定增市值双底折算、磨损值折算）；
3. **风控纪律**（“没利润垫...不要留”、“总仓位不超过7成”、“开盘杀多不追”）；
4. **形态/时机**（“二次握手”、“尾盘强平V反”、“跳空补缺口”、“周五先多后空”）；
5. **战法答疑**（针对群友提问做出的机制解释与原理说明）。

### 2. 上下文拼窗机制
- **上下文跨度**：以锚点发言为中心，向前取同 `feed_id` 历史 3 条，向后取同 `feed_id` 随后 3 条，完整拼装为 `raw_text` 或 `dialogue_messages`；
- **图表关联**：若发言或相邻上下文携带 `attachments` 且在盘上存在已核验真图（`size>15KB`），必须挂载配图本地路径、SHA 摘要与图文对齐描述。

---

## 三、战法知识原子产物契约 (Product Contract)

L2b 切窗产物写入独立的 `data/runs/l2b_knowledge_*.jsonl`，每条记录必须严格符合以下 JSON Schema：

```json
{
  "cu_id": "cu_l2b_drycut_20260830_00001",
  "post_id": "post_1CUmhoAGUop4SppGjvML7p",
  "feed_id": "forum_feed_1CTr7SqVMzFfuFiiRJLEHN",
  "channel_name": "历史股票期权记录区",
  "kid": "k_second_handshake",
  "type": "playbook",
  "statement": "盘中二次握手低点博弈财报，在二次握手吸，盘后多的时候出。",
  "evidence_span": "因为这次是第二次遇到 rddt  hims这种盘中二次握手  二次握手的低点还是最近第三季度的最低点这种的 财报博弈方式 一般没太大问题 小超预期 大超预期 盘后都会有多的  在二次握手吸   盘后才预期 多的时候出",
  "matched_phrase": "二次握手",
  "raw_text": "[post_1CUmhoAGUop4SppGjvML7p] 📡【历史股票期权记录区 (forum_feed_1CTr7SqVMzFfuFiiRJLEHN)】 2025/11/3 16:57:29 xiaozhaolucky: 因为这次是第二次遇到 rddt  hims这种盘中二次握手  二次握手的低点还是最近第三季度的最低点这种的 财报博弈方式 一般没太大问题 小超预期 大超预期 盘后都会有多的  在二次握手吸   盘后才预期 多的时候出",
  "chart_notes": {
    "has_image": false,
    "aligns_with_text": "no_image",
    "local_path": "no_image",
    "sha": "no_image"
  },
  "not": [],
  "status": "proposed",
  "do_not_use_as_order": true,
  "created_at": 1787935644129
}
```

### 字段级严格契约与防编造铁律
1. **`raw_text` / `evidence_span`**：
   - 必须包含完整原始切窗上下文 `raw_text`；
   - **`evidence_span` 必须是 `raw_text` 中严格的连续字符子串**，严禁模型自行概括或重写。
2. **`statement` 与 `not[]` 禁止编词**：
   - `statement`：必须忠实于原文表述，**禁止编造原文没有的高大上词汇**（如“事件影响期”、“保守反弹目标位”等，原文没有一律剔除）；
   - `not[]`：**只记录原文中明确指出的禁止项或反向约束**；若原文无显式禁止，**必须写为空数组 `[]`**，严禁模型凭空捏造。
3. **`kid` 严格撞表与 `pending_new` 保护**：
   - 切窗抽取时，`kid` 只允许匹配已有知识库表（25 hits + G4/G5 + g_img_001~005 + 受控 proposed 表）；
   - 若出现新战法但未在表中登记，**必须赋予 `kid: "pending_new"`，绝对禁止模型自造 `k_*` 标识符**。
4. **全量切窗边界防串与软门纪律**：
   - **同频 ≠ 同时段**：同频道消息按时间序排列，若后文距离锚点超过 24 小时，全量切窗时必须标注 `context_stale: true` 软门提醒，不得硬丢窗；
   - **同文双发口诀哈希去重**：若记录区与期权区等不同频道双发同一口诀，全量时按 `statement_hash` 严格去重，仅保留一条主窗（优先保留记录区或带图窗）。
5. **`chart_notes` 规范元数据**：
   - 若存在真图，必须完整填入 `local_path`、`sha`、`aligns_with_text` 与 `has_image: true`；
   - 若无图，必须显式填入 `has_image: false`，其余字段填 `"no_image"`，**严禁用 `null` 模糊糊弄**。
6. **`status` 默认 `proposed`**：
   - 抽取产物默认全量标记为 **`status: "proposed"`**（金标与闸门必须人工在工作台审核后方可晋升）；
7. **`do_not_use_as_order: true`**：
   - **全量布尔硬锁**，下游执行引擎读取到此字段必须绝对阻断下单；
8. **禁止写入 registry**：严禁回写代码本、手册与频道登记册；
9. **禁止混入 L2a actions**：绝不允许向 `parsed.actions` 注入知识原子。

---

## 四、权威金标与真实配图种子映射表 (Ground Truth & Image Seeds)

> **严正声明**：本表完全复制自 [`data/samples/l2b_gold_seeds_5_strict.json`](../samples/l2b_gold_seeds_5_strict.json) 与 [`data/samples/l2b_real_image_seeds_5_proposed.json`](../samples/l2b_real_image_seeds_5_proposed.json)，严禁手工篡改或混淆 unlocated 状态。

| 种子编号 | 战法名称 | 规范 kid | 真实所属 post_id / 状态 | 归属频道 feed_id | 配图本地路径 (local_path) |
|---|---|---|---|---|---|
| **G1** | 波动值高抛底吸 | `k_wave_value_extremes` | `proposed_unlocated` | `unlocated` | `no_image` |
| **G2** | 尾盘 15:50 V反 | `k_late_session_v_reversal` | `proposed_unlocated` | `unlocated` | `no_image` |
| **G3** | 整数位急跌买回 (CRWV@86) | `k_dip_buy_round_number` | 2026-07-01 增量广播切窗 | `forum_feed_1CTr7SqVMzFfuFiiRJLEHN` | `no_image` |
| **G4** | 盘中二次握手博弈财报 (在二次握手吸) | `k_second_handshake` | **`post_1CUmhoAGUop4SppGjvML7p`** (2025-11-03) | `forum_feed_1CTr7SqVMzFfuFiiRJLEHN` | `no_image` |
| **G5** | 4-28 被动减全文与缺口回买 | `k_passive_redeem_then_rebuy` | **`post_1CaWLMfYvJsZHjS9ugtaPj`** (2026-04-28) | `chat_feed_1CTrCEx44dP13jW3RVkYiS` | `no_image` |
| **g_img_001** | 九转序列数学曲率图 | `k_nine_turn_sequence` | **`post_1CXYCpXPkLs5VVnU5aBkJe`** (2026-01-27) | `chat_feed_1CU95KbtifP1JtuqTiVXZb` | `data/media/zhao/2026-01-27/post_1CXYCpXPkLs5VVnU5aBkJe_0.jpg` |
| **g_img_002** | 看转弯两次有效拐点图 | `k_focus_on_inflection_turn` | **`post_1CYDwHo9hVfbwciyfsR9sa`** (2026-02-17) | `chat_feed_1CU95KbtifP1JtuqTiVXZb` | `data/media/zhao/2026-02-17/post_1CYDwHo9hVfbwciyfsR9sa_0.jpg` |
| **g_img_003** | 二次握手精确 SPX 指数图 | `k_second_handshake` | **`post_1CayBBJeexEDaiEveHEmGa`** (2026-05-12) | `chat_feed_1CU95KbtifP1JtuqTiVXZb` | `data/media/zhao/2026-05-12/post_1CayBBJeexEDaiEveHEmGa_0.jpg` |
| **g_img_004** | 法案投票周期高低点图 | `k_event_cycle_extremes` | **`post_1Cb4TAuGNsh8zYEUCgnce7`** (2026-05-15) | `chat_feed_1CU95KbtifP1JtuqTiVXZb` | `data/media/zhao/2026-05-15/post_1Cb4TAuGNsh8zYEUCgnce7_0.jpg` |
| **g_img_005** | IREN 跌补三缺口46整数底图 | `k_gap_fill_round_number_bottom` | **`post_1CbTUayc44sNzPweAjd3QW`** (2026-05-27) | `chat_feed_1CU95KbtifP1JtuqTiVXZb` | `data/media/zhao/2026-05-27/post_1CbTUayc44sNzPweAjd3QW_0.jpg` |
| **公式区8条** | (高+低)/2 反弹一半测算 | `k_half_retrace_watch` | `post_1CWLuUbwbhS7EvhKs97CBG` 等 8 条 (2025-12~2026-03) | `chat_feed_1CWLuNUVYVVYttro8gAvJ5` | `no_image` |

---

## 五、分阶段验收与解冻纪律 (Verification & Unfreezing)

在正式解冻 `l2b_cut` 队列之前，必须严格执行以下四步验收闭环：

```text
🏛️ L2b 知识切窗验收四步闭环
├── Step 1. 规范审批（当前阶段：本规范 v1.2 审阅，队列严格保持 paused: 2064）
├── Step 2. Dry-Cut 20 窗（先切 20 组典型战法窗，必须点名 100% 切中 G4、G5、g_img_001、g_img_002 真实 post_id）
├── Step 3. 人工原文穿透盲审（逐字核对 evidence_span 连续子串、not[] 与无编造性）
└── Step 4. 评审通过后，签署解冻决定，方可分批启动全量切窗流水线
```

---

## 六、受控资产冻结红线核验

- [x] L2a 候选流（1441 窗）维持只读冻结；
- [x] 人审记录与工作台 `l2a_human_verified_actions.jsonl` 维持只读冻结；
- [x] 券商对账闸门维持 `exit code 2` 阻断；
- [x] `pipeline_tasks.l2b_cut` 维持 `paused: 2064`。

