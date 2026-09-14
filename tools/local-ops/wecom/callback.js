/**
 * WeCom inbound adapter — C0 + allowlisted C1 collect (P4.1).
 * Sync commands: passive reply.
 * Async commands: immediate ack + proactive push when done (needs WECOM_OPS_SECRET + AGENT_ID).
 */
import { createWecomCrypt, xmlTag, xmlEscape } from './crypto.js';
import { parseOpsCommand, WECOM_C1_IDS } from './commands.js';
import { formatWecomReply } from './format.js';

function parseUserAllowlist(raw) {
  return new Set(
    String(raw || '')
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

let collectInFlight = null;

/** Test helper */
export function resetWecomCollectLock() {
  collectInFlight = null;
}

export function createWecomHandler({
  token,
  encodingAesKey,
  corpId,
  allowedUserIds = '',
  gateway,
  pusher = null,
  nowFn = () => Date.now(),
  onBackgroundError = (err) => {
    process.stderr.write(`[wecom] background invoke error: ${err?.message || err}\n`);
  },
} = {}) {
  const crypt = createWecomCrypt({ token, encodingAesKey, corpId });
  const allow = parseUserAllowlist(allowedUserIds);
  const pushEnabled = Boolean(pusher?.enabled);

  function assertUser(userid) {
    if (allow.size === 0) {
      return { ok: false, reason: 'WECOM_OPS_USERIDS empty — refuse all inbound' };
    }
    if (!allow.has(String(userid || ''))) {
      return { ok: false, reason: `userid not allowlisted: ${userid}` };
    }
    return { ok: true };
  }

  function assertCapability(cap, id) {
    if (!cap) return { ok: false, reason: `拒绝：${id} 未注册` };
    if (cap.class === 'C0') return { ok: true };
    if (cap.class === 'C1' && WECOM_C1_IDS.has(id)) return { ok: true };
    return { ok: false, reason: `拒绝：${id} 不在企微允许范围（${cap.class}）` };
  }

  async function pushResult(userid, id, resultOrErr) {
    if (!pushEnabled) return { ok: false, skipped: true };
    let content;
    if (resultOrErr instanceof Error) {
      content = `[${id}] 失败\n${resultOrErr.message}`;
    } else {
      content = formatWecomReply(id, resultOrErr);
    }
    try {
      const out = await pusher.sendText({ userid, content });
      if (!out.ok) {
        process.stderr.write(`[wecom] push failed: ${out.error || out.reason}\n`);
      }
      return out;
    } catch (err) {
      process.stderr.write(`[wecom] push error: ${err.message}\n`);
      return { ok: false, error: err.message };
    }
  }

  function handleVerify(query) {
    const {
      msg_signature: msgSignature,
      timestamp,
      nonce,
      echostr,
    } = query || {};
    if (!crypt.verifySignature({ msgSignature, timestamp, nonce, encrypt: echostr })) {
      return { status: 403, body: 'invalid signature' };
    }
    const plain = crypt.decryptEcho(echostr);
    return { status: 200, body: plain, contentType: 'text/plain; charset=utf-8' };
  }

  function buildTextReply({ toUser, fromUser, content }) {
    const ts = Math.floor(nowFn() / 1000);
    return (
      `<xml>`
      + `<ToUserName><![CDATA[${xmlEscape(toUser)}]]></ToUserName>`
      + `<FromUserName><![CDATA[${xmlEscape(fromUser)}]]></FromUserName>`
      + `<CreateTime>${ts}</CreateTime>`
      + `<MsgType><![CDATA[text]]></MsgType>`
      + `<Content><![CDATA[${String(content).replace(/]]>/g, ']] >')}]]></Content>`
      + `</xml>`
    );
  }

  async function handleMessage(query, rawXml) {
    const encrypt = xmlTag(rawXml, 'Encrypt');
    const {
      msg_signature: msgSignature,
      timestamp,
      nonce,
    } = query || {};

    if (!encrypt) return { status: 400, body: 'missing Encrypt' };
    if (!crypt.verifySignature({ msgSignature, timestamp, nonce, encrypt })) {
      return { status: 403, body: 'invalid signature' };
    }

    const plainXml = crypt.decrypt(encrypt);
    const msgType = xmlTag(plainXml, 'MsgType');
    const fromUser = xmlTag(plainXml, 'FromUserName');
    const toUser = xmlTag(plainXml, 'ToUserName');

    if (msgType !== 'text') {
      const reply = buildTextReply({
        toUser: fromUser,
        fromUser: toUser,
        content: '仅支持文本。发送 /ops help',
      });
      return {
        status: 200,
        body: crypt.packReply(reply, timestamp, nonce),
        contentType: 'application/xml; charset=utf-8',
      };
    }

    const userGate = assertUser(fromUser);
    if (!userGate.ok) {
      const reply = buildTextReply({
        toUser: fromUser,
        fromUser: toUser,
        content: `拒绝：${userGate.reason}`,
      });
      return {
        status: 200,
        body: crypt.packReply(reply, timestamp, nonce),
        contentType: 'application/xml; charset=utf-8',
      };
    }

    const content = xmlTag(plainXml, 'Content');
    const parsed = parseOpsCommand(content);
    let replyText;

    if (parsed.kind === 'ignore') {
      replyText = '未识别。发送 /ops help';
    } else if (parsed.kind === 'help' || parsed.kind === 'denied') {
      replyText = parsed.text;
    } else if (parsed.kind === 'invoke') {
      if (!gateway || typeof gateway.invoke !== 'function') {
        replyText = 'gateway unavailable';
      } else {
        const listed = gateway.listCatalog?.();
        const cap = listed?.capabilities?.find((c) => c.id === parsed.id);
        const gate = assertCapability(cap, parsed.id);
        if (!gate.ok) {
          replyText = gate.reason;
        } else if (parsed.async) {
          if (parsed.id === 'gex.collect' && collectInFlight) {
            replyText = 'gex.collect 仍在运行中，完成后会推送；或稍后再发 /ops gex status。';
          } else {
            const job = gateway.invoke(parsed.id, parsed.args || {})
              .then(async (result) => {
                process.stderr.write(
                  `[wecom] async ${parsed.id} done ok=${result?.ok ?? result?.data?.ok}\n`,
                );
                await pushResult(fromUser, parsed.id, result);
                return result;
              })
              .catch(async (err) => {
                onBackgroundError(err);
                await pushResult(fromUser, parsed.id, err);
                throw err;
              })
              .finally(() => {
                if (collectInFlight === job) collectInFlight = null;
              });
            if (parsed.id === 'gex.collect') collectInFlight = job;
            const base = parsed.ack || `已启动 ${parsed.id}（后台执行）。`;
            replyText = pushEnabled
              ? `${base}\n完成后会主动推送结果到本会话。`
              : `${base}\n（未配置 WECOM_OPS_SECRET/AGENT_ID，完成后不会主动推送，请自行 /ops gex status）`;
          }
        } else {
          const result = await gateway.invoke(parsed.id, parsed.args || {});
          replyText = formatWecomReply(parsed.id, result);
        }
      }
    } else {
      replyText = '内部错误';
    }

    const reply = buildTextReply({
      toUser: fromUser,
      fromUser: toUser,
      content: replyText.slice(0, 2000),
    });
    return {
      status: 200,
      body: crypt.packReply(reply, timestamp, nonce),
      contentType: 'application/xml; charset=utf-8',
    };
  }

  return { handleVerify, handleMessage, crypt, assertUser, pushEnabled };
}
