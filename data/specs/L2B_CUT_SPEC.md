# L2b 全频道战法与风控知识切窗规范 (L2B Cut Specification)

> **版本**：v1.0-draft  
> **状态**：严格草案 (Queue 维持 `paused: 2064`，禁止在审批通过前启动切窗或解冻队列)  
> **核心原则**：L2b 是**战法、纪律、风控与图表知识提取流水线**，与 L2a 跟单流水线物理硬隔离，**输出绝对禁止包含 BUY/SELL 实盘指令**。

---

## 一、数据源范围与主键铁律 (Sources)

### 1. 频道路由准入 (赵哥全频道发言)
L2b 的提取目标是赵哥的完整认知体系与战法纪律，因此全频道的赵哥发言均可作为知识切窗来源：
- **`forum_feed_1CTr7SqVMzFfuFiiRJLEHN`**（历史股票期权记录区）：长文战法、量化复盘、出货教案；
- **`chat_feed_1CTr7QocNpDZ9FXZ6fvWe4`**（不用翻墙美股发布）：盘中实时宏观判断、突发事件应对；
- **`chat_feed_1CTrCEx44dP13jW3RVkYiS`**（不用翻墙期权）：期权异动观察、对冲纪律；
- **`chat_feed_1CWLuNUVYVVYttro8gAvJ5`**（市值理论100跌50 公式记录）：反弹一半 `(高+低)/2` 公式专项；
- **`chat_feed_1CTr5VAdNHtbZAFaTitvoT`**（不用翻墙美股讨论区）：赵哥在群内的答疑与战法解释。

### 2. 与 L2a 广播窗的双轨处理原则
- 已经在 L2a 中切过跟单动作的广播窗（例如“急跌买回”、“二次握手确认”），**仍需进入 L2b 切窗提取战法知识**；
- **红线铁律**：L2b 抽取的产物必须定性为“战法/风控闸门”，**其输出绝对禁止生成 BUY/SELL 订单**。

### 3. 主键约束
- 统一使用权威登记册 [`config/channel_registry.json`](../config/channel_registry.json) 中的 `feed_id` 作为唯一主键；
- 严禁通过频道中文名子串正则反向猜测归属。

---

## 二、切窗规则与上下文机制 (Windowing vs L2a)

L2b 切窗机制与 L2a 存在根本性差异：

| 维度 | L2a 交易跟单切窗 | L2b 战法知识切窗 (本规范) |
|---|---|---|
| **切窗目标** | 提取明确的建仓/加仓/减仓/清仓动作 | 提取战法原子、风控纪律、图表形态与口播观察 |
| **触发单位** | 单个或成组的交易口播脉冲 | **一条赵哥核心陈述 + 前后各 N 条同 feed 上下文** |
| **空动作处理** | 无动作者标记为纯观点空窗 | **不为成交拆单，绝不因 actions 为空而丢弃窗口** |
| **配图机制** | 图作为辅助凭证 | **配图作为一等公民 (g_img_001~005 / OCR / 形态解析)** |
| **金标覆盖** | 覆盖交易样本 | **金标 G4/G5（如反弹一半、尾盘强平二次握手）必须 100% 被切中** |

### 上下文拼窗机制
1. **锚点发言**：赵哥（`sender_id: user_4yeplXgbguTu4` 或 `xiaozhaolucky`）发布的包含战法、逻辑、因果或总结的发言；
2. **上下文跨度**：向前取同 `feed_id` 历史 3 条，向后取同 `feed_id` 随后 3 条（跨度内若有群友提问，一并保留以提供上下文语义）；
3. **图表关联**：若发言或相邻上下文携带 `attachments` 且在盘上存在已核验真图（`size>15KB`），必须挂载配图本地路径与 SHA 摘要。

---

## 三、战法知识原子产物契约 (Product Contract)

L2b 切窗产物写入独立的 `data/runs/l2b_knowledge_*.jsonl`，每条记录必须严格符合以下 JSON Schema：

```json
{
  "cu_id": "cu_l2b_20260830_00001",
  "feed_id": "forum_feed_1CTr7SqVMzFfuFiiRJLEHN",
  "channel_name": "历史股票期权记录区",
  "kid": "k_half_retrace_watch",
  "type": "formula",
  "statement": "市值理论100跌50公式：取事件影响期高低点均值作为保守反弹目标位",
  "evidence_span": "（137.75+65.11）/2=101.43 根据公式就是101.43是一半位置出一半",
  "matched_phrase": "（137.75+65.11）/2",
  "chart_notes": null,
  "not": [
    "不得在未到保守一半位置提前清仓",
    "不得忽略定增市值对双底形态的重置影响"
  ],
  "status": "proposed",
  "do_not_use_as_order": true,
  "created_at": 1787935644129
}
```

### 字段级硬约束
1. **`kid`**：知识库战法标识符（例如 `k_second_handshake`、`k_half_retrace_watch`、`k_friday_long_then_short`）；
2. **`statement`**：对战法/纪律的一句话权威提炼；
3. **`evidence_span`**：在赵哥原文中的精准字符级证据切片；
4. **`not[]`**：该战法的反向约束/禁止条件（如死区、禁止追高、禁止加仓条件）；
5. **`status`**：默认全量赋予 **`proposed`**，只有经过人工在工作台专项核准后方可转为 `asserted` / `gold`；
6. **`do_not_use_as_order: true`**：**全量布尔硬锁**，任何下游执行引擎读取到此字段必须绝对阻断下单逻辑；
7. **禁止写入 registry**：L2b 产物只存在于知识库与工作台闸门中，严禁回写入代码本/手册/频道权威登记册；
8. **禁止混入 L2a actions**：任何 L2b 知识原子绝不允许注入 `parsed.actions`。

---

## 四、分阶段验收与解冻纪律 (Verification & Unfreezing)

在正式解冻 `l2b_cut` 队列之前，必须严格执行以下四步验收闭环：

```text
🏛️ L2b 知识切窗验收四步闭环
├── Step 1. 规范审批（当前阶段，队列保持 paused: 2064）
├── Step 2. Dry-Cut 20 窗（先切 20 组典型战法窗，包含金标 G4/G5 与图表 g_img_001~005）
├── Step 3. 人工原文穿透盲审（逐字核对 evidence_span、not[] 与上下文完整性）
└── Step 4. 评审通过后，签署解冻决定，方可分批启动全量切窗流水线
```

---

## 五、受控资产冻结红线核验

- [x] L2a 候选流（1441 窗）维持只读冻结；
- [x] 人审记录与工作台 `l2a_human_verified_actions.jsonl` 维持只读冻结；
- [x] 券商对账闸门维持 `exit code 2` 阻断；
- [x] `pipeline_tasks.l2b_cut` 维持 `paused: 2064`。
