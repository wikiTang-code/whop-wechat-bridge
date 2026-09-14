/**
 * WeCom proactive app messages (message/send).
 * Needs WECOM_OPS_CORP_ID + WECOM_OPS_SECRET + WECOM_OPS_AGENT_ID.
 */
export function createWecomPusher({
  corpId,
  secret,
  agentId,
  fetchImpl = fetch,
  nowFn = () => Date.now(),
} = {}) {
  const agent = Number(agentId);
  const enabled = Boolean(corpId && secret && Number.isFinite(agent) && agent > 0);

  let cachedToken = '';
  let tokenExpiresAt = 0;

  async function getAccessToken() {
    if (!enabled) throw new Error('wecom push not configured');
    if (cachedToken && nowFn() < tokenExpiresAt - 60_000) return cachedToken;
    const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`;
    const res = await fetchImpl(url);
    const data = await res.json();
    if (!data.access_token) {
      throw new Error(`gettoken failed: ${data.errcode || res.status} ${data.errmsg || ''}`.trim());
    }
    cachedToken = data.access_token;
    const ttlSec = Number(data.expires_in) || 7200;
    tokenExpiresAt = nowFn() + ttlSec * 1000;
    return cachedToken;
  }

  async function sendText({ userid, content }) {
    if (!enabled) {
      return { ok: false, skipped: true, reason: 'push_not_configured' };
    }
    const to = String(userid || '').trim();
    const text = String(content || '').slice(0, 2000);
    if (!to) return { ok: false, error: 'userid required' };
    if (!text) return { ok: false, error: 'content required' };

    const token = await getAccessToken();
    const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`;
    const body = {
      touser: to,
      msgtype: 'text',
      agentid: agent,
      text: { content: text },
      safe: 0,
    };
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (data.errcode !== 0) {
      return {
        ok: false,
        error: `send failed: ${data.errcode} ${data.errmsg || ''}`.trim(),
        data,
      };
    }
    return { ok: true, msgid: data.msgid, data };
  }

  return {
    enabled,
    agentId: enabled ? agent : null,
    getAccessToken,
    sendText,
  };
}
