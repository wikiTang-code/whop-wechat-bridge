import fs from 'fs';
import path from 'path';
import https from 'https';

const candidateKeys = [
  'AQ.Ab8RN6LX5_ii4vzMHLwLdh0bwXLJZeP0sMngDz8TeulvD1QeTA',
  'AQ.Ab8RN6J_4WX5sEd05hle9EBezATY7O1tl_MLVXOR92ckt2QU1g',
  'AQ.Ab8RN6KdQ2zy8vFh0WvImALxB_MLEVfM-x8JRJKA_eVLxlXFLA'
];

console.log('====================================================');
console.log('🧪 批量测试候选 Gemini API Keys 连通性并自动拼接');
console.log('====================================================\n');

function testSingleKey(apiKey) {
  return new Promise((resolve) => {
    const model = 'gemini-flash-latest';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const payload = JSON.stringify({
      contents: [{ parts: [{ text: 'Ping test' }] }]
    });

    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve({ key: apiKey, valid: true, status: 200, msg: '有效 (OK)' });
        } else if (res.statusCode === 429) {
          // 429 也说明 Key 格式有效且可用，只是暂时达到频控
          resolve({ key: apiKey, valid: true, status: 429, msg: '有效 (触发429频控降速，可作为多Key备用)' });
        } else {
          resolve({ key: apiKey, valid: false, status: res.statusCode, msg: `无效 (${res.statusCode}: ${body.substring(0, 100)})` });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ key: apiKey, valid: false, status: 0, msg: `网络错误 (${err.message})` });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ key: apiKey, valid: false, status: 0, msg: '请求超时' });
    });

    req.write(payload);
    req.end();
  });
}

async function run() {
  const validKeys = [];

  for (let i = 0; i < candidateKeys.length; i++) {
    const key = candidateKeys[i];
    const prefix = key.substring(0, 12) + '...';
    console.log(`正在测试候选 Key #${i + 1} (${prefix})...`);
    const res = await testSingleKey(key);
    console.log(` -> 结果: ${res.msg}`);
    if (res.valid) {
      validKeys.push(key);
    }
  }

  console.log(`\n📊 最终检测通过有效 Key 数量: ${validKeys.length}/${candidateKeys.length}`);

  if (validKeys.length > 0) {
    const envPath = path.resolve(process.cwd(), '.env');
    let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

    let existingKeys = [];
    if (content.includes('GEMINI_API_KEY=')) {
      const match = content.match(/GEMINI_API_KEY=([^\r\n]+)/);
      if (match) {
        existingKeys = match[1].split(',').map(k => k.trim()).filter(Boolean);
      }
    }

    // 去重合并
    const allKeysSet = new Set([...existingKeys, ...validKeys]);
    const finalKeysStr = Array.from(allKeysSet).join(',');

    if (content.includes('GEMINI_API_KEY=')) {
      content = content.replace(/GEMINI_API_KEY=[^\r\n]+/, `GEMINI_API_KEY=${finalKeysStr}`);
    } else {
      content += `\nGEMINI_API_KEY=${finalKeysStr}\n`;
    }

    fs.writeFileSync(envPath, content);
    console.log(`\n🎉 已将 ${validKeys.length} 个有效 Key 成功拼接更新进 .env！`);
    console.log(`目前一共集成了 ${allKeysSet.size} 个有效 Gemini API Key 形成超级多 Key 轮询矩阵！`);
  } else {
    console.log('\n⚠️ 没有检测到有效的新 Key，保持原有配置。');
  }
}

run();
