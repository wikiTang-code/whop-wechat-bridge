import urllib.request
import json
import time

url = 'http://127.0.0.1:8080/v1/chat/completions'
payload = {
    'model': 'qwen2.5-14b-instruct',
    'messages': [
        {'role': 'user', 'content': '请详细分析美股科技股的当前趋势与潜在风险'}
    ],
    'max_tokens': 200
}

t0 = time.time()
req = urllib.request.Request(
    url,
    data=json.dumps(payload).encode('utf-8'),
    headers={'Content-Type': 'application/json'}
)

try:
    with urllib.request.urlopen(req, timeout=30) as res:
        data = json.loads(res.read().decode('utf-8'))
        t1 = time.time()
        elapsed = t1 - t0
        tokens = data['usage']['completion_tokens']
        prompt_tokens = data['usage'].get('prompt_tokens', 0)
        speed = tokens / elapsed
        print(f"=== LM Studio 本地 GPU 推理速度实测 ===")
        print(f"输入 Prompt Tokens: {prompt_tokens}")
        print(f"输出 Completion Tokens: {tokens}")
        print(f"总计算耗时: {elapsed:.2f} 秒")
        print(f"🚀 实测生成速度: {speed:.2f} tokens/s")
except Exception as e:
    print(f"❌ 测试失败: {e}")
