/**
 * tools/http-sync-client.mjs
 * 极简跨平台同步 HTTP 请求辅助器 (供 CLI/Sync Adapter 使用)
 * 用法: node tools/http-sync-client.mjs <url> <method> [jsonBody]
 */

const [,, url, method = 'GET', bodyStr = ''] = process.argv;

if (!url) {
  process.stdout.write(JSON.stringify({ status: 400, ok: false, error: 'Missing url' }));
  process.exit(0);
}

try {
  const options = {
    method: method.toUpperCase(),
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(8000)
  };

  if (bodyStr && bodyStr.trim() && options.method !== 'GET') {
    options.body = bodyStr;
  }

  const res = await fetch(url, options);
  const text = await res.text();
  process.stdout.write(JSON.stringify({ status: res.status, ok: res.ok, body: text }));
} catch (e) {
  process.stdout.write(JSON.stringify({ status: 500, ok: false, error: e.message }));
}
