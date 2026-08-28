import urllib.request
import re
import json
import os

folder_id = '1odKmU8wjhG12OQB4-bMvh241V6hZAiNO'
url = f'https://drive.google.com/drive/folders/{folder_id}'

req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})

try:
    with urllib.request.urlopen(req) as response:
        html = response.read().decode('utf-8', errors='ignore')
        
    print(f"Downloaded HTML size: {len(html)} bytes")
    
    # 匹配 Google Drive 内部的 _DRIVE_IVD 或文件结构
    file_matches = re.findall(r'\["([a-zA-Z0-9_-]{25,})",\["([^"]+)"', html)
    print(f"Found {len(file_matches)} candidate files:")
    for fid, fname in file_matches:
        print(f" - {fname} -> {fid}")
        
except Exception as e:
    print(f"Download failed: {e}")
