# batch_infer_pending.py
import os, sys, json, time, re
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

def apply_rule_guardrail(raw, action):
    # 强卖出关键词
    sell_keywords = ['止盈', '平本出', '止损出', '出剩下一半', '出清', '平仓', '卖出', '出掉', '减半', '出一半']
    for kw in sell_keywords:
        if kw in raw:
            return 'SELL'
    # 强买入关键词
    buy_keywords = ['加了', '建仓', '开仓', '买了', '买回', '接回', '加仓', '开了']
    for kw in buy_keywords:
        if kw in raw and not any(sk in raw for sk in ['卖出的', '出的']):
            return 'BUY'
    return action

def clean_fraction_desc(desc):
    if not desc:
        return '常规仓位'
    # 去除多余重复的 (约占总资金...)
    desc = re.sub(r'\s*\(约占总资金.*?\)', '', desc).strip()
    return desc if desc else '常规仓位'

def main():
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
    in_path = os.path.join(repo_root, 'data/slm/pending_queue_full.json')
    out_path = os.path.join(repo_root, 'data/slm/pending_inferred_ai.json')
    
    with open(in_path, 'r', encoding='utf-8') as f:
        items = json.load(f)
        
    print(f'待推理的 Pending 队列记录数: {len(items)}')
    
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f'推理设备: {device} ({torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"})')
    
    model_id = 'Qwen/Qwen2.5-Coder-1.5B-Instruct'
    lora_path = os.path.join(repo_root, 'models/zhao_slm_1.5b_lora')
    
    tokenizer = AutoTokenizer.from_pretrained(model_id, trust_remote_code=True)
    base_model = AutoModelForCausalLM.from_pretrained(
        model_id,
        torch_dtype=torch.bfloat16,
        trust_remote_code=True
    ).to(device)
    
    model = PeftModel.from_pretrained(base_model, lora_path)
    model.eval()
    print('LoRA 模型装载就绪，开始执行全量批量推理...')
    
    t_start = time.time()
    results = []
    
    for idx, item in enumerate(items):
        raw = item['raw_content']
        clean_text = raw.replace('[IMAGE:', '').strip()
        
        messages = [
            {'role': 'system', 'content': SYSTEM_PROMPT},
            {'role': 'user', 'content': clean_text}
        ]
        prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = tokenizer(prompt, return_tensors='pt').to(device)
        
        with torch.no_grad():
            outputs = model.generate(
                **inputs,
                max_new_tokens=256,
                do_sample=False,
                pad_token_id=tokenizer.eos_token_id
            )
        gen_ids = outputs[0][inputs.input_ids.shape[1]:]
        resp_text = tokenizer.decode(gen_ids, skip_special_tokens=True).strip()
        
        parsed_action = item['parsed_action']
        parsed_ticker = item['parsed_ticker']
        parsed_price = item['parsed_price']
        source_lot = item['source_lot_price']
        frac_desc = item['fraction_desc']
        frac_ratio = item['fraction_ratio']
        
        try:
            cj = clean_json_text(resp_text)
            data = json.loads(cj)
            if data.get('has_trade') and data.get('trades'):
                tr = data['trades'][0]
                if tr.get('symbol'):
                    parsed_ticker = tr['symbol'].upper()
                if tr.get('action'):
                    parsed_action = tr['action'].upper()
                if tr.get('price') is not None:
                    parsed_price = float(tr['price'])
                if tr.get('source_lot_price') is not None:
                    source_lot = float(tr['source_lot_price']) if tr['source_lot_price'] else None
                if tr.get('fraction_desc'):
                    frac_desc = clean_fraction_desc(tr['fraction_desc'])
                if tr.get('fraction_ratio'):
                    frac_ratio = float(tr['fraction_ratio'])
        except Exception as e:
            pass
            
        # 边界安全兜底
        parsed_action = apply_rule_guardrail(raw, parsed_action)
        frac_desc = clean_fraction_desc(frac_desc)
        
        results.append({
            'id': item['id'],
            'seq_no': item['seq_no'],
            'parsed_ticker': parsed_ticker,
            'parsed_action': parsed_action,
            'parsed_price': parsed_price,
            'source_lot_price': source_lot,
            'fraction_desc': frac_desc,
            'fraction_ratio': frac_ratio
        })
        
        if (idx + 1) % 50 == 0 or idx == len(items) - 1:
            elapsed = time.time() - t_start
            speed = (idx + 1) / elapsed
            rem_sec = int((len(items) - (idx + 1)) / speed) if speed > 0 else 0
            print(f'[{idx+1}/{len(items)}] 进度: {((idx+1)/len(items)*100):.1f}% | 速度: {speed:.1f}条/s | 预估剩余: {rem_sec}s')
            
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f'全量 AI 推理完成！结果已写入 {out_path}')

if __name__ == '__main__':
    main()
