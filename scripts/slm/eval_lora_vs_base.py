"""
scripts/slm/eval_lora_vs_base.py
对比评测：Qwen2.5-Coder-1.5B 原生基座 vs 微调后赵哥专属 LoRA 适配器
"""

import os
import json
import time
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

os.environ["HSA_ENABLE_DXG_DETECTION"] = "1"
os.environ["HSA_OVERRIDE_GFX_VERSION"] = "11.0.0"
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"

SYSTEM_PROMPT = """你是一个顶级美股量化交易信号提取器，专门解析交易大V的中文口语喊单和调仓发言。
你的任务是严格从用户文本中提取交易动作要素并输出纯 JSON 对象，禁止输出任何多余解释或 Markdown 格式。

【输出Schema】
{
  "has_trade": boolean,
  "trades": [
    {
      "symbol": string,         // 标的大写代码 (如 TSLL, LITE, CONL, IREN, CIFR, CRWV)
      "action": "BUY" | "SELL", // 买入/加仓/加回/开仓 为 BUY；卖出/减仓/出掉/平仓/止损 为 SELL
      "price_type": "LIMIT" | "MARKET" | "RANGE",
      "price": number,          // 本次执行价格 (区间价取均值)
      "source_lot_price": number | null, // 做T买回原卖出批次，或指定卖出的买入成本批次
      "fraction_desc": string,  // 仓位描述 (如 "三分之一常规仓", "半仓", "出剩下一半")
      "fraction_ratio": number, // 数字化比例 (0.333, 0.5, 1.0)
      "stop_loss": number | null,
      "is_day_trade": boolean
    }
  ]
}"""

TEST_CASES = [
    {
        "desc": "典型做T与指定出剩下一半 (含批次成本与比例)",
        "text": "866出剩下一半 855的lite"
    },
    {
        "desc": "标准限价买入与止损标记",
        "text": "tsll 14.2 买入 200股，破13.8止损"
    },
    {
        "desc": "黑话接回/回买 (做T加回)",
        "text": "刚才47.8出的iren，现在46.5回买接回底仓"
    },
    {
        "desc": "抗幻觉负样本1：纯宏观缺口与点位分析 (绝不能误报交易)",
        "text": "spx的主要支撑点在7340 跌破的话下面看7180-7200这个缺口 正常回调到处找新闻是错误做法"
    },
    {
        "desc": "抗幻觉负样本2：日常闲聊与仓位心理提示",
        "text": "这波行情不要追涨杀跌，盘中等转弯往上再看，先观察不急着操作"
    }
]

def generate_output(model, tokenizer, prompt_text, device):
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt_text}
    ]
    prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(prompt, return_tensors="pt").to(device)
    
    t0 = time.time()
    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=256,
            do_sample=False,
            pad_token_id=tokenizer.eos_token_id
        )
    latency_ms = int((time.time() - t0) * 1000)
    
    gen_ids = outputs[0][inputs.input_ids.shape[1]:]
    response_text = tokenizer.decode(gen_ids, skip_special_tokens=True).strip()
    return response_text, latency_ms

def main():
    print("===========================================================")
    print("🧪 启动微调模型 vs 基座模型 对比评测 (Benchmark Evaluation)")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"评测设备: {device} ({torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU'})")
    print("===========================================================\n")

    model_id = "Qwen/Qwen2.5-Coder-1.5B-Instruct"
    lora_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../models/zhao_slm_1.5b_lora"))

    print("[1/3] 加载 Base 1.5B 基座模型与 Tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(model_id, trust_remote_code=True)
    base_model = AutoModelForCausalLM.from_pretrained(
        model_id,
        torch_dtype=torch.bfloat16,
        trust_remote_code=True
    ).to(device)

    print("\n--- 开始评测 [Base 1.5B 原始基座模型] ---")
    base_results = []
    for i, c in enumerate(TEST_CASES):
        resp, ms = generate_output(base_model, tokenizer, c["text"], device)
        base_results.append((resp, ms))
        print(f"[{i+1}/{len(TEST_CASES)}] Base 完成 ({ms}ms)")

    print("\n[2/3] 动态挂载 LoRA 适配器权重...")
    lora_model = PeftModel.from_pretrained(base_model, lora_path)
    lora_model.eval()

    print("\n--- 开始评测 [Fine-Tuned 1.5B 专属微调模型] ---")
    lora_results = []
    for i, c in enumerate(TEST_CASES):
        resp, ms = generate_output(lora_model, tokenizer, c["text"], device)
        lora_results.append((resp, ms))
        print(f"[{i+1}/{len(TEST_CASES)}] LoRA 完成 ({ms}ms)")

    print("\n===========================================================")
    print("📊 详细横向比对结果看板 (Side-by-Side Comparison)")
    print("===========================================================\n")

    for i, c in enumerate(TEST_CASES):
        b_resp, b_ms = base_results[i]
        l_resp, l_ms = lora_results[i]

        print(f"【测试用例 {i+1}】: {c['desc']}")
        print(f"原始文本: \"{c['text']}\"\n")
        print(f"▶ [Base 原生基座] 延迟: {b_ms}ms\n{b_resp}\n")
        print(f"▶ [LoRA 专属微调] 延迟: {l_ms}ms\n{l_resp}\n")
        print("-" * 60 + "\n")

if __name__ == "__main__":
    main()
