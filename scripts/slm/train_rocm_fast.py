"""
scripts/slm/train_rocm_fast.py
针对 AMD RX 7900 XT (ROCm / WSL2) 的无死锁、原生纯 PyTorch 极速 LoRA 训练引擎
杜绝 HuggingFace Accelerate 的 device_map='auto' 引起的 meta/cpu 跨设备死锁。
"""

import os
import sys
import json
import time
import torch
from torch.utils.data import DataLoader
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import LoraConfig, get_peft_model, TaskType

# 环境变量保障
os.environ["HSA_ENABLE_DXG_DETECTION"] = "1"
os.environ["HSA_OVERRIDE_GFX_VERSION"] = "11.0.0"
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"

class TradeDataset(torch.utils.data.Dataset):
    def __init__(self, data_path, tokenizer, max_length=512):
        with open(data_path, 'r', encoding='utf-8') as f:
            raw_samples = json.load(f)
        
        self.items = []
        for item in raw_samples:
            conv = [
                {"role": "system", "content": item["instruction"]},
                {"role": "user", "content": item["input"]},
                {"role": "assistant", "content": item["output"]}
            ]
            text = tokenizer.apply_chat_template(conv, tokenize=False, add_generation_prompt=False)
            enc = tokenizer(text, max_length=max_length, truncation=True, padding="max_length", return_tensors="pt")
            input_ids = enc["input_ids"].squeeze(0)
            attention_mask = enc["attention_mask"].squeeze(0)
            labels = input_ids.clone()
            labels[attention_mask == 0] = -100
            self.items.append({
                "input_ids": input_ids,
                "attention_mask": attention_mask,
                "labels": labels
            })

    def __len__(self):
        return len(self.items)

    def __getitem__(self, idx):
        return self.items[idx]

def main():
    print("===========================================================")
    print("🚀 启动 AMD ROCm 纯 PyTorch 极速 LoRA 训练引擎 (无死锁原生模式)")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"训练设备: {device} ({torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU'})")
    print("===========================================================\n")

    model_id = "Qwen/Qwen2.5-Coder-1.5B-Instruct"

    print("[1/4] 加载 Tokenizer 与基座模型直接放入 GPU...")
    tokenizer = AutoTokenizer.from_pretrained(model_id, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # 关键点：绝对不使用 device_map='auto'，直接 .to(device)，彻底消除 meta device 死锁
    model = AutoModelForCausalLM.from_pretrained(
        model_id,
        torch_dtype=torch.bfloat16,
        trust_remote_code=True
    ).to(device)

    print("[2/4] 注入 LoRA 适配层...")
    peft_config = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=16,
        lora_alpha=32,
        lora_dropout=0.05,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"]
    )
    model = get_peft_model(model, peft_config)
    model.print_trainable_parameters()

    print("\n[3/4] 准备数据集与 DataLoader...")
    script_dir = os.path.dirname(os.path.abspath(__file__))
    data_path = os.path.abspath(os.path.join(script_dir, "../../data/slm/alpaca_trade_sft.json"))
    dataset = TradeDataset(data_path, tokenizer, max_length=512)
    batch_size = 4
    dataloader = DataLoader(dataset, batch_size=batch_size, shuffle=True)
    total_steps = len(dataloader) * 3
    print(f"样本总数: {len(dataset)} | Batch Size: {batch_size} | 总迭代 Steps: {total_steps}")

    optimizer = torch.optim.AdamW(model.parameters(), lr=2e-4, weight_decay=0.01)
    
    print("\n[4/4] 开始迭代训练 (3 Epochs)...")
    model.train()
    step = 0
    t0 = time.time()
    
    for epoch in range(1, 4):
        epoch_loss = 0
        for batch_idx, batch in enumerate(dataloader):
            step += 1
            optimizer.zero_grad()
            
            input_ids = batch["input_ids"].to(device)
            attention_mask = batch["attention_mask"].to(device)
            labels = batch["labels"].to(device)

            outputs = model(input_ids=input_ids, attention_mask=attention_mask, labels=labels)
            loss = outputs.loss
            loss.backward()
            optimizer.step()

            loss_val = loss.item()
            epoch_loss += loss_val

            if step % 5 == 0 or step == total_steps:
                elapsed = time.time() - t0
                speed = step / elapsed if elapsed > 0 else 0
                print(f"Epoch [{epoch}/3] Step [{step}/{total_steps}] - Loss: {loss_val:.4f} - 速度: {speed:.2f} it/s", flush=True)

    print(f"\n✅ 训练完成！总耗时: {time.time() - t0:.1f} 秒", flush=True)

    # 保存 LoRA 权重
    save_dir = os.path.abspath(os.path.join(script_dir, "../../models/zhao_slm_1.5b_lora"))
    os.makedirs(save_dir, exist_ok=True)
    model.save_pretrained(save_dir)
    tokenizer.save_pretrained(save_dir)
    print(f"🎉 专属微调权重已成功保存至: {save_dir}", flush=True)

if __name__ == "__main__":
    main()
