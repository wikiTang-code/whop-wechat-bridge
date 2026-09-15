# 大V交易语义端侧轻量小模型 (SLM) 微调与数据飞轮 SOP (REQ-036)

> **目标**：彻底解决大模型在解析口语喊单时「推理耗时长（>20秒）、显存开销大、容易对代码/标的产生幻觉」的痛点，将交易抽取浓缩为 **1.5B/0.5B 专用模型**，单次响应达 **50ms~200ms**，可在 LM Studio 或纯 CPU 运行。

---

## 1. 数据飞轮闭环架构

```mermaid
flowchart TD
    A[历史830笔大V发言] --> B[Tokenizer 槽位初次提取]
    B --> C[企微移动端卡片人工审核/纠错]
    C -->|确认通过| D[(SQLite 黄金正样本)]
    C -->|人工修改| E[(DPO 纠错偏好对)]
    F[messages 宏观/闲聊] -->|抗幻觉负样本采样| G[(200条 No-trade 负样本)]
    
    D --> H[export_training_data.js 飞轮管道]
    E --> H
    G --> H
    
    H --> I[alpaca_trade_sft.json 训练集]
    I --> J[Unsloth / LoRA 微调 5分钟]
    J --> K[Qwen2.5-1.5B 专用交易权重]
    K --> L[导出 GGUF (q4_k_m)]
    L --> M[直接拖入 LM Studio / llama.cpp 极速推理]
```

---

## 2. 飞轮数据导出方法

在项目根目录下执行：
```bash
node scripts/slm/export_training_data.js
```
该命令会自动从 `whop_archive.db` 提取并生成：
- `data/slm/alpaca_trade_sft.json` (1030 组标准指令样本)
- `data/slm/sharegpt_trade_sft.jsonl`
- `data/slm/dpo_preference_pairs.jsonl` (纠错偏好对)
- `data/slm/dataset_summary.json` (样本分布报告)

---

## 3. 一键微调运行指南

### 环境准备（任意 6GB+ 显卡或 Google Colab 免费 T4）
```bash
pip install unsloth transformers datasets trl accelerate bitsandbytes
```

### 启动训练（约 5~8 分钟完成）
```bash
python scripts/slm/train_unsloth_lora.py
```

### 训练产物
- `models/zhao_trade_slm_1.5b`: 完整 HuggingFace 格式合并权重
- `models/zhao_trade_slm_1.5b_gguf`: GGUF 量化文件，可直接拖入 **LM Studio** 或使用纯 CPU `llama.cpp` 跑。

---

## 4. 线上双轨接入与兜底策略 (`slm-extractor.js`)

在系统运行中采用 **双轨协同 + 确定性硬保障**：
1. **优先路径**：请求本地反代 LM Studio (`http://127.0.0.1:8080/v1`)，直接获取标准化交易要素 JSON。
2. **硬保障兜底**：若遇本地反代未启动、显卡占用超时或输出格式非法，**0ms 自动回退** 至 `price_extractor.js` Tokenizer 规则引擎，确保流水线永远不掉单、不阻断。
