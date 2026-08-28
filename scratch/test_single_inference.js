import dotenv from 'dotenv';
dotenv.config();

const url = 'http://127.0.0.1:8080/v1/chat/completions';
console.log('Sending request to:', url);

try {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen2.5-14b-instruct',
      messages: [{ role: 'user', content: '请用一句话回答：美股今天开盘吗？' }],
      temperature: 0.1
    }),
    signal: AbortSignal.timeout(30000)
  });

  console.log('Status:', res.status);
  const data = await res.json();
  console.log('Response:', JSON.stringify(data, null, 2));
} catch (e) {
  console.error('Error:', e.message);
}
