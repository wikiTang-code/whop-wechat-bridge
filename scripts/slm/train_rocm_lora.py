"""
scripts/slm/train_rocm_lora.py
针对 AMD RX 7900 XT (ROCm / WSL2) 的专用微调执行引擎
基于原生 HuggingFace Transformers + PEFT (LoRA) + TRL (SFTTrainer)
纯 GPU 显存加速 (bfloat16)，约 3~5 分钟即可完成 1030 条大V交易数据烧录！
"""

import os
import sys
import json
import torch

# 1. 严格遵循全局规则：AMD ROCm gfx1100 架构与 WSL2 DXG 桥梁配置
os.environ["HSA_ENABLE_DXG_DETECTION"] = "1"
os.environ["HSA_OVERRIDE_GFX_VERSION"] = "11.0.0"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments
from peft import LoraConfig, get_peft_model, TaskType
from datasets import Dataset
from trl import SFTTrainer

def main():
    print("===========================================================")
    print("🚀 启动 AMD ROCm 专用 1.5B 大V交易语义 SFT 微调流水线")
    print(f"PyTorch 版本: {torch.__version__} | GPU 加速可用: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"当前 GPU 设备: {torch.cuda.get_device_name(0)}")
    print("===========================================================\n")

    # 优先选择国内高速镜像下载基座，若已缓存则直接读取
    model_id = "Qwen/Qwen2.5-Coder-1.5B-Instruct"
    
    # 尝试从环境变量或魔搭下载镜像
    os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"

    print(f"[1/5] 加载 Tokenizer 与基座模型 ({model_id})...")
    tokenizer = AutoTokenizer.from_pretrained(model_id, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # 采用 bfloat16 加载，7900XT 硬件原生支持，显存占用仅约 3.2GB
    model = AutoModelForCausalLM.from_pretrained(
        model_id,
        torch_dtype=torch.bfloat16,
        device_map="auto",
        trust_remote_code=True
    )

    print("\n[2/5] 配置 LoRA 适配器...")
    peft_config = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=16,
        lora_alpha=32,
        lora_dropout=0.05,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]
    )
    model = get_peft_model(model, peft_config)
    model.print_trainable_parameters()

    print("\n[3/5] 加载 REQ-036 飞轮导出的黄金标注数据集...")
    # 动态定位训练集路径 (兼容 Windows 与 WSL2 挂载路径)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(script_dir, "../../data/slm/alpaca_trade_sft.json"),
        "/mnt/c/Users/86597/.gemini/antigravity/scratch/whop-wechat-bridge/data/slm/alpaca_trade_sft.json",
        "data/slm/alpaca_trade_sft.json"
    ]
    data_path = None
    for c in candidates:
        if os.path.exists(c):
            data_path = os.path.abspath(c)
            break

    if not data_path:
        raise FileNotFoundError(f"未找到 alpaca_trade_sft.json 训练集，请先执行 node scripts/slm/export_training_data.js")

    print(f"读取训练集: {data_path}")
    with open(data_path, "r", encoding="utf-8") as f:
        raw_samples = json.load(f)

    # 转换为直接 Tokenized 的微调数据集
    tokenized_samples = []
    for item in raw_samples:
        conversation = [
            {"role": "system", "content": item["instruction"]},
            {"role": "user", "content": item["input"]},
            {"role": "assistant", "content": item["output"]}
        ]
        text = tokenizer.apply_chat_template(conversation, tokenize=False, add_generation_prompt=False)
        enc = tokenizer(text, max_length=1024, truncation=True)
        enc["labels"] = list(enc["input_ids"])
        tokenized_samples.append(enc)

    dataset = Dataset.from_list(tokenized_samples)
    print(f"成功预处理并 Tokenize 样本数: {len(dataset)} 条")

    print("\n[4/5] 启动 GPU 加速微调 (3 个 Epochs)...")
    output_dir = os.path.join(script_dir, "../../models/zhao_slm_1.5b_lora")
    os.makedirs(output_dir, exist_ok=True)

    training_args = TrainingArguments(
        output_dir=output_dir,
        per_device_train_batch_size=4,
        gradient_accumulation_steps=4,
        num_train_epochs=3,
        learning_rate=2e-4,
        warmup_steps=10,
        logging_steps=10,
        save_strategy="no",
        bf16=True,
        optim="adamw_torch",
        report_to="none"
    )

    from transformers import Trainer, DataCollatorForSeq2Seq
    trainer = Trainer(
        model=model,
        train_dataset=dataset,
        data_collator=DataCollatorForSeq2Seq(tokenizer, pad_to_multiple_of=8),
        args=training_args
    )

    trainer.train()

    print("\n[5/5] 保存微调完成的 LoRA 权重...")
    model.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)
    print(f"🎉 专属微调权重保存成功！路径: {output_dir}")
    print("===========================================================")

if __name__ == "__main__":
    main()
