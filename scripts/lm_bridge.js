/**
 * scripts/lm_bridge.js — DEPRECATED (CHG-023)
 * Old 8081->8080 relay for LM Studio. Do not autostart.
 * Use: npm run ai:cutover  then  ssh -R 8080:127.0.0.1:8080
 */
import http from 'http';

console.error('[DEPRECATED] lm_bridge 8081 retired by CHG-023. Use npm run ai:cutover');
process.exit(1);

const LISTEN_PORT = 8081;
const TARGET_HOST = '127.0.0.1';
const TARGET_PORT = 8080;

const server = http.createServer((req, res) => {
  const options = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: Object.assign({}, req.headers, { host: '127.0.0.1:8080' })
  };
  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });
  proxyReq.on('error', (err) => {
    res.statusCode = 502;
    res.end(`Bridge Proxy Error: ${err.message}`);
  });
  req.pipe(proxyReq, { end: true });
});
server.listen(LISTEN_PORT, '0.0.0.0');
