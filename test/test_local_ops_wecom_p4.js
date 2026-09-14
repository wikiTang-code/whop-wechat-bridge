/**
 * WeCom crypto + C0/C1-collect mapping + callback allowlist tests (P4.1).
 */
import assert from 'assert';
import { createWecomCrypt, xmlTag } from '../tools/local-ops/wecom/crypto.js';
import { parseOpsCommand } from '../tools/local-ops/wecom/commands.js';
import { createWecomHandler, resetWecomCollectLock } from '../tools/local-ops/wecom/callback.js';
import { createWecomPusher } from '../tools/local-ops/wecom/push.js';
import { buildRemoteCurlScript, shSingleQuote } from '../tools/local-ops/wecom/gcp-fetch.js';
import { formatWecomReply } from '../tools/local-ops/wecom/format.js';
import { createGateway } from '../tools/local-ops/gateway.js';
import { loadCatalog } from '../tools/local-ops/load-catalog.js';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const catalog = loadCatalog(path.join(here, '../tools/local-ops/catalog.yaml'));
assert.strictEqual(catalog.phase, 'P4.1');

const keyBuf = Buffer.alloc(32, 7);
const encodingAesKey = keyBuf.toString('base64').replace(/=+$/, '');
assert.strictEqual(encodingAesKey.length, 43);

const token = 'testtoken';
const corpId = 'wwCORPidTEST';
const crypt = createWecomCrypt({ token, encodingAesKey, corpId });

const plain = 'hello-echo';
const enc = crypt.encrypt(plain);
const ts = '1409659813';
const nonce = 'nonceTest';
const sig = crypt.sha1Signature(ts, nonce, enc);
assert.ok(crypt.verifySignature({ msgSignature: sig, timestamp: ts, nonce, encrypt: enc }));
assert.strictEqual(crypt.decrypt(enc), plain);

const help = parseOpsCommand('/ops help');
assert.strictEqual(help.kind, 'help');
assert.ok(help.text.includes('collect'));

const health = parseOpsCommand('/ops health');
assert.deepStrictEqual(health, { kind: 'invoke', id: 'gcp.health_bundle', args: {} });

const gex = parseOpsCommand('ops gex status');
assert.strictEqual(gex.id, 'gex.summarize');

const collect = parseOpsCommand('/ops collect');
assert.strictEqual(collect.kind, 'invoke');
assert.strictEqual(collect.id, 'gex.collect');
assert.strictEqual(collect.async, true);

const gexRun = parseOpsCommand('/ops gex run');
assert.strictEqual(gexRun.id, 'gex.collect');

const restart = parseOpsCommand('/ops restart');
assert.strictEqual(restart.kind, 'denied');

const ignore = parseOpsCommand('hello');
assert.strictEqual(ignore.kind, 'ignore');

let collectCalls = 0;
const gw = {
  listCatalog() {
    return {
      capabilities: [
        { id: 'gex.status', class: 'C0' },
        { id: 'gcp.health_bundle', class: 'C0' },
        { id: 'gex.collect', class: 'C1' },
      ],
    };
  },
  async invoke(id) {
    if (id === 'gex.collect') {
      collectCalls += 1;
      await new Promise((r) => setTimeout(r, 30));
      return { ok: true, id, data: { stub: true } };
    }
    return { ok: true, id, data: { stub: true } };
  },
};

const handler = createWecomHandler({
  token,
  encodingAesKey,
  corpId,
  allowedUserIds: 'alice,bob',
  gateway: gw,
});

assert.strictEqual(handler.assertUser('alice').ok, true);
assert.strictEqual(handler.assertUser('eve').ok, false);

const echoEnc = crypt.encrypt('ping');
const verify = handler.handleVerify({
  msg_signature: crypt.sha1Signature(ts, nonce, echoEnc),
  timestamp: ts,
  nonce,
  echostr: echoEnc,
});
assert.strictEqual(verify.status, 200);
assert.strictEqual(verify.body, 'ping');

async function postContent(userid, content) {
  const inner = (
    `<xml>`
    + `<ToUserName><![CDATA[wwagent]]></ToUserName>`
    + `<FromUserName><![CDATA[${userid}]]></FromUserName>`
    + `<CreateTime>1409659813</CreateTime>`
    + `<MsgType><![CDATA[text]]></MsgType>`
    + `<Content><![CDATA[${content}]]></Content>`
    + `<MsgId>1</MsgId>`
    + `<AgentID>1000002</AgentID>`
    + `</xml>`
  );
  const encMsg = crypt.encrypt(inner);
  const postXml = `<xml><Encrypt><![CDATA[${encMsg}]]></Encrypt></xml>`;
  const out = await handler.handleMessage({
    msg_signature: crypt.sha1Signature(ts, nonce, encMsg),
    timestamp: ts,
    nonce,
  }, postXml);
  const replyPlain = crypt.decrypt(xmlTag(out.body, 'Encrypt'));
  return { out, replyPlain };
}

const statusMsg = await postContent('alice', '/ops gex status');
assert.strictEqual(statusMsg.out.status, 200);
assert.ok(statusMsg.replyPlain.includes('gex.summarize') || statusMsg.replyPlain.includes('stub') || statusMsg.replyPlain.includes('指数墙') || statusMsg.replyPlain.includes('快照'));

const eveMsg = await postContent('eve', '/ops gex status');
assert.ok(eveMsg.replyPlain.includes('拒绝') || eveMsg.replyPlain.includes('allowlist') || eveMsg.replyPlain.includes('not allowlisted'));

const collectMsg = await postContent('alice', '/ops collect');
assert.ok(collectMsg.replyPlain.includes('已启动') || collectMsg.replyPlain.includes('gex.collect'));
assert.ok(collectMsg.replyPlain.includes('未配置') || collectMsg.replyPlain.includes('主动推送'));
assert.strictEqual(collectCalls, 1);
await new Promise((r) => setTimeout(r, 50));

// Proactive push on async complete
resetWecomCollectLock();
const pushed = [];
const pusher = createWecomPusher({
  corpId: 'wwCORPidTEST',
  secret: 'secret',
  agentId: '1000002',
  fetchImpl: async (url, init) => {
    if (String(url).includes('gettoken')) {
      return { json: async () => ({ access_token: 'tok', expires_in: 7200 }) };
    }
    const body = JSON.parse(init.body);
    pushed.push(body);
    return { json: async () => ({ errcode: 0, errmsg: 'ok', msgid: '1' }) };
  },
});
assert.strictEqual(pusher.enabled, true);
const handlerPush = createWecomHandler({
  token,
  encodingAesKey,
  corpId,
  allowedUserIds: 'alice',
  gateway: gw,
  pusher,
});
async function postWith(handler, userid, content) {
  const inner = (
    `<xml>`
    + `<ToUserName><![CDATA[wwagent]]></ToUserName>`
    + `<FromUserName><![CDATA[${userid}]]></FromUserName>`
    + `<CreateTime>1409659813</CreateTime>`
    + `<MsgType><![CDATA[text]]></MsgType>`
    + `<Content><![CDATA[${content}]]></Content>`
    + `</xml>`
  );
  const encMsg = crypt.encrypt(inner);
  const out = await handler.handleMessage({
    msg_signature: crypt.sha1Signature(ts, nonce, encMsg),
    timestamp: ts,
    nonce,
  }, `<xml><Encrypt><![CDATA[${encMsg}]]></Encrypt></xml>`);
  return crypt.decrypt(xmlTag(out.body, 'Encrypt'));
}
const ackPush = await postWith(handlerPush, 'alice', '/ops collect');
assert.ok(ackPush.includes('主动推送'));
await new Promise((r) => setTimeout(r, 80));
assert.ok(pushed.length >= 1);
assert.strictEqual(pushed[0].touser, 'alice');
assert.ok(String(pushed[0].text.content).includes('gex.collect') || String(pushed[0].text.content).includes('完成') || String(pushed[0].text.content).includes('失败'));

// human-readable format sample
const sample = formatWecomReply('gex.summarize', {
  ok: true,
  data: {
    ok: true,
    stale: true,
    age_minutes: 10,
    generated_at: '2026-09-14T00:00:00',
    session: 'rth',
    source: 'futu-opend',
    index: {
      SPY: { spot: 1, king: { strike: 2, net_gex: -1e6 }, floor: { strike: 3, net_gex: 2e6 }, regime: 'positive_gamma' },
    },
    matrix: { TSLA: { spot: 4, king: { strike: 5 }, floor: { strike: 6 }, regime: 'positive_gamma' } },
  },
});
assert.ok(sample.includes('指数墙'));
assert.ok(sample.includes('SPY'));
assert.ok(!sample.trim().startsWith('{'));

// gcp-fetch: URL with & must be base64-wrapped, not raw in remote shell
{
  const u = 'https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=ww&corpsecret=sec';
  const script = buildRemoteCurlScript(u, { method: 'GET' });
  assert.ok(script.includes('base64 -d'), 'url via base64');
  assert.ok(!script.includes('corpsecret=sec'), 'secret not plaintext in script');
  assert.ok(shSingleQuote("a'b").includes(`'\\''`), 'single-quote escape');
  const post = buildRemoteCurlScript(u, { method: 'POST' });
  assert.ok(post.includes('--data-binary @-'));
}

const realGw = createGateway();
assert.strictEqual(realGw.catalog.phase, 'P4.1');

const { createLocalOpsHttpServer } = await import('../tools/local-ops/http-server.js');
const { server } = createLocalOpsHttpServer({
  env: { LOCAL_OPS_HTTP_HOST: '127.0.0.1', LOCAL_OPS_HTTP_PORT: '0' },
  gateway: gw,
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const addr = server.address();
const healthRes = await fetch(`http://127.0.0.1:${addr.port}/healthz`);
const healthJson = await healthRes.json();
assert.strictEqual(healthJson.ok, true);
assert.strictEqual(healthJson.wecom_enabled, false);
server.close();

console.log('test_local_ops_wecom_p4: PASS');
