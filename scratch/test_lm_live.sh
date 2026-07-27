#!/bin/bash
RESULT=$(curl -s --max-time 30 http://127.0.0.1:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen2.5-14b-instruct","messages":[{"role":"user","content":"回复连接成功三个字"}],"max_tokens":10}')

echo "=== 原始响应 ==="
echo "$RESULT" | head -c 500

echo ""
echo "=== 提取内容 ==="
echo "$RESULT" | python3 -c "import sys,json; r=json.load(sys.stdin); print('AI回复:', r['choices'][0]['message']['content'])" 2>&1
