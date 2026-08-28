# 🏭 L2a/L2b 离线增量批处理流水线规范 (L2A/L2B Offline Incremental Pipeline Specification)

> **版本标识**：`L2A-PIPELINE-SPEC-V1`  
> **核心原则**：
> 1. **L0 原始消息唯一生长**：SQLite `messages` 仅增不改；
> 2. **五段式固定闭环**：`A 切窗 -> B 抽取 -> C 清洗 -> D 战法撞表 -> E 指针更新`；
> 3. **幂等与断点续跑**：根据 `cu_id` 自动跳过已解析记录，每次运行以 `run_id` 隔离落盘，**绝对禁止覆盖 1195 基准库存**；
> 4. **前端零推理**：Web 工作台仅读取指针与清缓存，绝不在点击路径中触发大模型。

---

## 一、五段式固定离线流水线架构

```
  SQLite messages (L0 原始消息)
        │
        ▼ (A. 切窗: 读 messages >= 水印, 按同日/Session/20min/8条切窗)
  data/samples/l2a_cu_{run_id}.jsonl (cu_id: cu_incr_{run_id}_{seq})
        │
        ▼ (B. 抽取: 本地 14B, 温度0, prompt_v3, 支持断点跳过)
  data/runs/l2a_raw_{run_id}.jsonl
        │
        ▼ (C. 清洗: 统一 Ticker 映射 / planned 强降级 / etf_2x 规范 / 去假代码)
  data/runs/l2a_cleaned_{run_id}.jsonl  +  data/runs/l2a_empty_tier1_{run_id}.jsonl
        │
        ▼ (D. 撞表: 纯匹配已封 25 标准战法长短语，提取连续证据 span)
  data/runs/l2b_hits_{run_id}.jsonl
        │
        ▼ (E. 指针与水印更新)
  data/runs/l2a_incr_latest.json (更新 runs 数组与 latest_date)
  data/runs/l2a_watermark.json   (推进 last_watermark_ts)
        │
        ▼
  Web 工作台点击【🔄 同步到最新离线批次】(POST /api/l2a/reload-offline，毫秒级合并)
```

---

## 二、批次命名与资产规范

| 资产层级 | 文件路径模式 | 描述与命名约束 |
| :--- | :--- | :--- |
| **基准库存 (只读)** | `data/runs/l2a_broadcast_candidates_1195_cleaned.jsonl` | 1,195 组基准封档集，**永远只读，禁止改写** |
| **增量切窗 (L1)** | `data/samples/l2a_cu_{run_id}.jsonl` | 新号段：`cu_incr_{run_id}_{seq}` |
| **增量原始抽取 (L2a)** | `data/runs/l2a_raw_{run_id}.jsonl` | 大模型原始输出，具备 `latency_ms` 与 `parse_ok` |
| **增量清洗结果 (L2a)** | `data/runs/l2a_cleaned_{run_id}.jsonl` | 规范化后的纯净候选单，供工作台合并回放 |
| **增量战法命中 (L2b)** | `data/runs/l2b_hits_{run_id}.jsonl` | 命中的标准战法长短语与真实证据 span |
| **全局增量指针** | `data/runs/l2a_incr_latest.json` | 维护 `base_path` 与 `runs: []` 列表 |
| **全局推进水印** | `data/runs/l2a_watermark.json` | 记录上次成功切窗的最新消息时间戳 |

---

## 三、总控流水线命令与参数规范

主流水线脚本：`scratch/run_l2a_pipeline.js`

```bash
# 1. 预检切窗 (Dry-Cut: 仅切窗统计增量消息与 CU 数量，不调用大模型)
node scratch/run_l2a_pipeline.js --dry-cut

# 2. 完整全量增量跑批 (A -> B -> C -> D -> E，自动推进水印并更新指针)
node scratch/run_l2a_pipeline.js --run-id 20260828_incr01 --full-run
```

---

## 四、四大绝对禁止红线 (System Invariants)

1. 🛑 **禁止在 Web API 路径中发起大模型推理**（工作台只读指针）；
2. 🛑 **禁止覆盖或改写 1195 基准文件**（增量必须以独立 `run_id` 落盘）；
3. 🛑 **禁止在增量中使用 `cu_trade_*` 乱序覆盖旧编号**（强制使用 `cu_incr_{run_id}_{seq}`）；
4. 🛑 **禁止向券商发起实盘下单**（保持 `is_live_order: false`，对账保持 `exit code 2`）。
