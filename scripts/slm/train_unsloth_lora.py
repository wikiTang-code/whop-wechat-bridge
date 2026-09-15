"""
train_unsloth_lora.py
REQ-036: 极轻量大V交易语义专用小模型 (SLM) 微调脚本 (基于 Unsloth / HuggingFace)
支持单张消费级显卡 (6GB-16GB 显存) 或 Google Colab T4 免费环境，5-10 分钟完成微调。
目标基座：Qwen/Qwen2.5-1.5B-Instruct 或 Qwen/Qwen2.5-0.5B-Instruct
产物：专有交易解析 LoRA 权重 & GGUF (可在 LM Studio 或 llama.cpp 零显存/纯CPU毫秒级运行)
"""

import os
import json
import torch

try:
    from unsloth import FastLanguageModel
    from datasets import Dataset
    from trl import SFTTrainer
    from transformers import TrainingArguments
except ImportError:
    print("提示: 运行此训练脚本需先安装微调依赖: pip install unsloth transformers datasets trl accelerate bitsandbytes")
    exit(0)

# 1. 超参数配置
max_seq_length = 1024
dtype = None # None 表示自动检测 (float16 或 bfloat16)
load_in_4bit = True # 开启 4-bit 量化，1.5B 模型显存占用 < 3GB
base_model_name = "Qwen/Qwen2.5-1.5B-Instruct"

print(f"🚀 加载基座模型: {base_model_name}...")
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=base_model_name,
    max_seq_length=max_seq_length,
    dtype=dtype,
    load_in_4bit=load_in_4bit,
)

# 2. 挂载 LoRA 适配器
model = FastLanguageModel.get_peft_model(
    model,
    r=16,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    lora_alpha=16,
    lora_dropout=0,
    bias="none",
    use_gradient_checkpointing="unsloth",
    random_state=3407,
)

# 3. 加载由 REQ-036 飞轮导出的训练集
dataset_file = os.path.join(os.path.dirname(__file__), "../../data/slm/alpaca_trade_sft.json")
if not os.path.exists(dataset_file):
    raise FileNotFoundError(f"未找到训练集文件: {dataset_file}，请先执行 node scripts/slm/export_training_data.js")

with open(dataset_file, "r", encoding="utf-8") as f:
    raw_data = json.load(f)

formatted_samples = []
for item in raw_data:
    # Qwen2.5 标准 Chat 模板格式
    text = tokenizer.apply_chat_template([
        {"role": "system", "content": item["instruction"]},
        {"role": "user", "content": item["input"]},
        {"role": "assistant", "content": item["output"]}
    ], tokenize=False, add_generation_prompt=False)
    formatted_samples.append({"text": text})

train_dataset = Dataset.from_list(formatted_samples)
print(f"📊 成功加载微调样本: {len(train_dataset)} 条")

# 4. 训练器配置
trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=train_dataset,
    dataset_text_field="text",
    max_seq_length=max_seq_length,
    dataset_num_proc=2,
    packing=False,
    args=TrainingArguments(
        per_device_train_batch_size=4,
        gradient_accumulation_steps=4,
        warmup_steps=10,
        max_steps=120, # 约 3-4 个 epoch，只需 5 分钟
        learning_rate=2e-4,
        fp16=not torch.cuda.is_bf16_supported(),
        bf16=torch.cuda.is_bf16_supported(),
        logging_steps=10,
        optim="adamw_8bit",
        weight_decay=0.01,
        lr_scheduler_type="linear",
        seed=3407,
        output_dir="outputs_slm_zhao",
    ),
)

# 5. 执行微调
print("🔥 开始微调训练...")
trainer_stats = trainer.train()
print(f"✅ 微调训练完成！耗时: {trainer_stats.metrics.get('train_runtime', 0):.1f} 秒")

# 6. 保存微调模型与 GGUF 导出
save_dir = "models/zhao_trade_slm_1.5b"
model.save_pretrained_merged(save_dir, tokenizer, save_method="merged_16bit")
print(f"💾 合并后模型已保存至: {save_dir}")

# 导出为 4-bit GGUF，可直接拖入 LM Studio
try:
    model.save_pretrained_gguf(save_dir + "_gguf", tokenizer, quantization_method="q4_k_m")
    print(f"🎉 GGUF 端侧量化模型导出成功: {save_dir}_gguf (可直接拖入 LM Studio 运行)")
except Exception as e:
    print(f"⚠️ GGUF 导出提示 (可后续用 llama.cpp 转换): {e}")
