/**
 * WeCom proactive app messages (message/send).
 * Needs WECOM_OPS_CORP_ID + WECOM_OPS_SECRET + WECOM_OPS_AGENT_ID.
 * Optional WECOM_OPS_PUSH_VIA=gcp|direct (default gcp) for stable egress IP.
 */
import { createGcpSshFetch } from './gcp-fetch.js';

export function createWecomPusher({
  corpId,
  secret,
  agentId,
  pushVia = process.env.WECOM_OPS_PUSH_VIA || 'gcp',
  fetchImpl,
  nowFn = () => Date.now(),
} = {}) {
  const agent = Number(agentId);
  const enabled = Boolean(corpId && secret && Number.isFinite(agent) && agent > 0);
  const via = String(pushVia || 'gcp').toLowerCase() === 'direct' ? 'direct' : 'gcp';
  const fetchFn = fetchImpl || (via === 'gcp' ? createGcpSshFetch() : fetch);

  let cachedToken = '';
  let tokenExpiresAt = 0;

  async function getAccessToken() {
    if (!enabled) throw new Error('wecom push not configured');
    if (cachedToken && nowFn() < tokenExpiresAt - 60_000) return cachedToken;
    const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`;
    const res = await fetchFn(url);
    const data = await res.json();
    if (!data.access_token) {
      const code = data.errcode != null ? data.errcode : res.status;
      throw new Error(`gettoken failed: ${code} ${data.errmsg || ''}`.trim());
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

    try {
      const token = await getAccessToken();
      const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`;
      const body = {
        touser: to,
        msgtype: 'text',
        agentid: agent,
        text: { content: text },
        safe: 0,
      };
      const res = await fetchFn(url, {
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
          via,
        };
      }
      return { ok: true, msgid: data.msgid, data, via };
    } catch (err) {
      return { ok: false, error: err.message, via };
    }
  }

  async function sendMarkdown({ userid, content }) {
    if (!enabled) {
      return { ok: false, skipped: true, reason: 'push_not_configured' };
    }
    const to = String(userid || '').trim();
    const text = String(content || '');
    if (!to) return { ok: false, error: 'userid required' };
    if (!text) return { ok: false, error: 'content required' };

    try {
      const token = await getAccessToken();
      const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`;
      const body = {
        touser: to,
        msgtype: 'markdown',
        agentid: agent,
        markdown: { content: text },
        enable_duplicate_check: 0,
      };
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (data.errcode !== 0) {
        return {
          ok: false,
          error: `send markdown failed: ${data.errcode} ${data.errmsg || ''}`.trim(),
          data,
          via,
        };
      }
      return { ok: true, msgid: data.msgid, data, via };
    } catch (err) {
      return { ok: false, error: err.message, via };
    }
  }

  return {
    enabled,
    agentId: enabled ? agent : null,
    via,
    getAccessToken,
    sendText,
    sendMarkdown,
  };
}
