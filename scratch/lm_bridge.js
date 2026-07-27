import http from 'http';

const LISTEN_PORT = 8081;
const TARGET_HOST = '127.0.0.1';
const TARGET_PORT = 8080;

const server = http.createServer((req, res) => {
  const options = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: '127.0.0.1:8080' }
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    console.error('[Bridge Proxy Error]:', err.message);
    res.statusCode = 502;
    res.end(`Bridge Proxy Error: ${err.message}`);
  });

  req.pipe(proxyReq, { end: true });
});

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`🚀 本地中继代理已启动在 0.0.0.0:${LISTEN_PORT} -> 纯净转发给 LM Studio ${TARGET_HOST}:${TARGET_PORT}`);
});
