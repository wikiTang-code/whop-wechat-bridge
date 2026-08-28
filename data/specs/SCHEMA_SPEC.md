# 🤖 Antigravity ↔ Grok Multi-Agent Collaboration Spec

本文档定义了 Antigravity（工程实施与数据管道）与 Grok（高阶推理、Prompt 调优与训练策略设计）通过 Git 仓库进行异步协作的规范与数据契约。

---

## 📁 协作目录结构

```text
data/
├── specs/
│   ├── SCHEMA_SPEC.md                # L1 Context Unit 与 L2 Semantic Envelope 的数据规范
│   └── semantic_envelope_schema.json # 严格 JSON Schema 定义
├── samples/
│   └── context_units_eval_50.jsonl   # 从生产库提取的 50 组代表性真实对话切片 (已脱敏)
├── prompts/
│   └── semantic_extract_prompt.md    # Grok 调优后的系统 Prompt 与 Few-Shot 样本
└── configs/
    └── lora_hyperparams.yaml         # 本地 35B 模型 SFT / LoRA 推荐训练参数
```

---

## 🎯 任务目标

1. **输入**：`data/samples/context_units_eval_50.jsonl`
2. **Grok 任务**：
   - 评估切窗合理性（前8后3窗口是否有噪音/截断）；
   - 完善 `data/prompts/semantic_extract_prompt.md`，提供零样本/少样本精准抽取能力；
   - 完善 `data/specs/semantic_envelope_schema.json`；
   - 在 `data/configs/lora_hyperparams.yaml` 中给出针对 AMD GPU 训练的最优超参数。
3. **Antigravity 任务**：
   - 读取 Grok 的成果，固化进 `persona-engine.js` 和 `context-unit-builder.js`；
   - 在 VM 上对全量历史发言执行 100% 资产化切窗与结构化抽取落库！
