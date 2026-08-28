# Antigravity ↔ Grok 协作契约

## 目录

```text
data/
├── specs/
│   ├── SCHEMA_SPEC.md
│   └── semantic_envelope_schema.json   # v1.1，向后兼容
├── samples/
│   └── context_units_eval_50.jsonl
├── eval/
│   └── window_quality_50.md            # Grok 对 50 条切窗的逐条评测
├── prompts/
│   └── semantic_extract_prompt.md      # 抽取 System Prompt + few-shot
└── configs/
    └── lora_hyperparams.yaml           # 7900 XT 20GB QLoRA，金标不足不开训
```

## 切窗结论（必须先改管道）

当前 50 条不是「前8后3 + 20分钟合并」，而是「截到 12 条消息」。

- 广播频道：按 `session` 变化或 `gap > 25min` 切开，单簇最多 8 条 KOL 文本
- 讨论区：锚点前 3 后 2，3 分钟内连续 KOL 回复才合并
- 每条消息补 `created_at_et` ISO 时间，否则 20 分钟无法计算
- 详细评测见 `data/eval/window_quality_50.md`

## L2 抽取

- Prompt：`data/prompts/semantic_extract_prompt.md`
- 校验：`data/specs/semantic_envelope_schema.json`
- 缺标的 / 纯图片 → `parse_status=failed`，禁止编造
- 「加了/出了」才是 filled；「可以/注意/挂」是 planned

## 训练

50 条金标不够 LoRA。流程：重切窗 → prompt 抽取 → 人工修订 → ≥800 条再按 `lora_hyperparams.yaml` 训。

## 工程侧下一步

1. 落地切窗规则，重导 50 条 eval
2. 用新 prompt 抽这 50 条，对照 few-shot 打分
3. 不要在旧 12 条窗上跑 7.5 万
