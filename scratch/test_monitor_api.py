import urllib.request
import json
import base64
import os

env_path = '/home/wikitang628/whop-wechat-bridge/.env'
user = 'admin'
pwd = ''

if os.path.exists(env_path):
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            if line.startswith('DASHBOARD_USERNAME='):
                user = line.split('=', 1)[1].strip()
            elif line.startswith('DASHBOARD_PASSWORD='):
                pwd = line.split('=', 1)[1].strip()

credentials = f"{user}:{pwd}"
encoded_cred = base64.b64encode(credentials.encode()).decode()

url = 'http://127.0.0.1:8085/api/system/monitor'
req = urllib.request.Request(
    url,
    headers={'Authorization': f'Basic {encoded_cred}'}
)

try:
    with urllib.request.urlopen(req, timeout=5) as res:
        data = res.read()
        print(f"✅ 看板监控 API 响应成功!")
        print(f"HTTP Status: {res.status}")
        print(f"Response Data Size: {len(data)} bytes")
        json_obj = json.loads(data.decode())
        print(f"Active Tasks Count in Array: {len(json_obj['data']['activeTasks'])}")
        print(f"Active Tasks Total in DB: {json_obj['data'].get('activeTasksCount')}")
except Exception as e:
    print(f"❌ 请求失败: {e}")
