# compare_model_vs_queue.py
import os, sys, json, time, sqlite3
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

os.environ['HSA_ENABLE_DXG_DETECTION'] = '1'
os.environ['HSA_OVERRIDE_GFX_VERSION'] = '11.0.0'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
os.environ['HF_ENDPOINT'] = 'https://hf-mirror.com'

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

def clean_json_text(text):
    text = text.strip()
    if text.startswith('```json'):
        text = text[7:]
    elif text.startswith('```'):
        text = text[3:]
    if text.endswith('```'):
        text = text[:-3]
    text = text.strip()
    s = text.find('{')
    e = text.rfind('}')
    if s != -1 and e != -1 and e > s:
        return text[s:e+1]
    return text

def main():
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
    json_path = os.path.join(repo_root, 'data/slm/queue_sample_for_eval.json')
    with open(json_path, 'r', encoding='utf-8') as f:
        rows = json.load(f)
    
    print(f'已读取到 {len(rows)} 笔交易队列单据进行对比...')
    
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f'推理设备: {device} ({torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"})')
    
    model_id = 'Qwen/Qwen2.5-Coder-1.5B-Instruct'
    lora_path = os.path.join(repo_root, 'models/zhao_slm_1.5b_lora')
    
    print('加载基座模型与 LoRA...')
    tokenizer = AutoTokenizer.from_pretrained(model_id, trust_remote_code=True)
    base_model = AutoModelForCausalLM.from_pretrained(
        model_id,
        torch_dtype=torch.bfloat16,
        trust_remote_code=True
    ).to(device)
    
    model = PeftModel.from_pretrained(base_model, lora_path)
    model.eval()
    print('LoRA 适配器装载完毕！开始批量推理对比...')
    
    results = []
    
    for idx, r in enumerate(rows):
        qid = r['id']
        seq_no = r['seq_no']
        raw_content = r['raw_content']
        cur_ticker = r['parsed_ticker']
        cur_action = r['parsed_action']
        cur_price = r['parsed_price']
        cur_qty = r['parsed_qty']
        cur_fraction = r['fraction_desc']
        status = r['status']
        corr_json = r['corrected_json']
        clean_text = raw_content.replace('[IMAGE:', '').strip()
        
        messages = [
            {'role': 'system', 'content': SYSTEM_PROMPT},
            {'role': 'user', 'content': clean_text}
        ]
        prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = tokenizer(prompt, return_tensors='pt').to(device)
        
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
        resp_text = tokenizer.decode(gen_ids, skip_special_tokens=True).strip()
        
        parsed_model = None
        try:
            cleaned = clean_json_text(resp_text)
            parsed_model = json.loads(cleaned)
        except Exception as e:
            parsed_model = {'error': str(e), 'raw': resp_text}
            
        results.append({
            'seq_no': seq_no,
            'raw_content': raw_content,
            'current_regex': {
                'ticker': cur_ticker,
                'action': cur_action,
                'price': cur_price,
                'fraction_desc': cur_fraction,
                'status': status
            },
            'corrected_truth': json.loads(corr_json) if corr_json else None,
            'ai_model': parsed_model,
            'latency_ms': latency_ms
        })
        if (idx + 1) % 10 == 0 or idx == len(rows) - 1:
            print(f'[{idx+1}/{len(rows)}] #{seq_no} 完成 ({latency_ms}ms)')
        
    out_path = os.path.join(repo_root, 'data/slm/model_inference_compare.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f'对比结果已写入 {out_path}')

if __name__ == '__main__':
    main()
