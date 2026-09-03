import http from 'http';

const postData = JSON.stringify({
  model: 'qwen2.5-14b-instruct',
  messages: [{ role: 'user', content: 'Say hello in one word' }],
  temperature: 0.2,
  max_tokens: 10
});

const options = {
  hostname: '127.0.0.1',
  port: 8080,
  path: '/v1/chat/completions',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  },
  timeout: 120000
};

console.log('Sending request to LM Studio...');
const start = Date.now();

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    const latency = Date.now() - start;
    console.log('Latency: ' + latency + 'ms');
    console.log('Response: ' + data);
  });
});

req.on('error', (e) => console.error('Error: ' + e.message));
req.on('timeout', () => { req.destroy(); console.error('Timeout after 120s'); });
req.write(postData);
req.end();
