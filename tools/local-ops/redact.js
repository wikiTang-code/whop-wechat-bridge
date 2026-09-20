const PATTERNS = [
  /https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[A-Za-z0-9_-]+/gi,
  /Bearer\s+[A-Za-z0-9._\-+/=]+/gi,
  /\b(LONGBRIDGE_(APP_KEY|APP_SECRET|ACCESS_TOKEN)|WHOP_COOKIE|DASHBOARD_PASSWORD|WECHAT_WORK_WEBHOOK_URL|WECHAT_ALERT_WEBHOOK_URL|WECHAT_QUANT_RADAR_WEBHOOK_URL)=[^\s]+/gi,
  /\bsk-[A-Za-z0-9]{12,}/g,
];

const MAX_CHARS = 32 * 1024;

export function redactText(input) {
  let text = input == null ? '' : String(input);
  if (text.length > MAX_CHARS) {
    text = `${text.slice(0, MAX_CHARS)}\n…[truncated ${text.length - MAX_CHARS} chars]`;
  }
  for (const re of PATTERNS) {
    text = text.replace(re, '[REDACTED]');
  }
  return text;
}

export function redactJson(value) {
  if (value == null) return value;
  if (typeof value === 'string') return redactText(value);
  if (typeof value !== 'object') return value;
  try {
    return JSON.parse(redactText(JSON.stringify(value)));
  } catch {
    return { redacted: true };
  }
}
