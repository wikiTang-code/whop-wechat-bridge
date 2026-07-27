import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env');
const newKey = 'AQ.Ab8RN6KGf0NwQ03g7zJJkZMX5EA8yB_aAdDuOqlBqui1Q1kCQg';

console.log('====================================================');
console.log('🔑 配置新 Gemini API Key 到 .env 形成多 Key 轮询');
console.log('====================================================\n');

if (!fs.existsSync(envPath)) {
  fs.writeFileSync(envPath, `GEMINI_API_KEY=${newKey}\nPORT=3000\nAI_PROVIDER=gemini\n`);
  console.log('✅ 已创建全新的 .env 文件并配置新 Key！');
} else {
  let content = fs.readFileSync(envPath, 'utf8');
  if (content.includes('GEMINI_API_KEY=')) {
    const existingMatch = content.match(/GEMINI_API_KEY=([^\r\n]+)/);
    const existingVal = existingMatch ? existingMatch[1].trim() : '';
    if (existingVal.includes(newKey)) {
      console.log('ℹ️ 该新 Key 已经在 .env 中配置过了！');
    } else {
      const combined = existingVal ? `${existingVal},${newKey}` : newKey;
      content = content.replace(/GEMINI_API_KEY=[^\r\n]+/, `GEMINI_API_KEY=${combined}`);
      fs.writeFileSync(envPath, content);
      console.log('✅ 成功将新 Key 拼接追加到 GEMINI_API_KEY！形成多 Key 轮询链！');
    }
  } else {
    content += `\nGEMINI_API_KEY=${newKey}\n`;
    fs.writeFileSync(envPath, content);
    console.log('✅ 成功追加 GEMINI_API_KEY 到 .env！');
  }
}
