/**
 * Map WeCom text commands to local-ops invokes (P4.1: C0 + allowlisted C1 collect).
 * C2 / other C1 remain CLI/IDE only.
 */

const HELP = `本机运维 /ops（P4.1：C0 + collect）
/ops help
/ops whoami
/ops health          → gcp.health_bundle
/ops gex [status|fresh|sum]
/ops collect         → gex.collect（异步；完成后主动推送结果）
/ops gex run         → 同上
/ops lm
/ops tunnel
/ops boards
/ops pm2
/ops resources
/ops git

其它 C1/C2（restart/deploy/load）请用 Cursor/CLI（生产 C2 还需 human-approve）。
群机器人 webhook 不能回控。`;

const C0_MAP = {
  whoami: { id: 'ops.whoami', args: {} },
  health: { id: 'gcp.health_bundle', args: {} },
  lm: { id: 'lm.status', args: {} },
  tunnel: { id: 'lm.tunnel.status', args: {} },
  boards: { id: 'dash.list', args: {} },
  pm2: { id: 'gcp.pm2_status', args: {} },
  resources: { id: 'gcp.resources', args: {} },
  git: { id: 'gcp.git_head', args: {} },
};

/** WeCom-allowed C1 ids (userid allowlist still required). */
export const WECOM_C1_IDS = new Set(['gex.collect']);

const BLOCKED = new Set([
  'restart', 'deploy', 'load', 'unload',
  'tunnel-start', 'tunnel-stop', 'open', 'skip', 'align', 'promote',
]);

export function parseOpsCommand(text) {
  const raw = String(text || '').trim();
  if (!raw) return { kind: 'ignore' };

  const m = /^(?:\/)?ops(?:\s+|$)/i.exec(raw);
  if (!m) return { kind: 'ignore' };

  const rest = raw.slice(m[0].length).trim();
  if (!rest || /^help$/i.test(rest) || rest === '?') {
    return { kind: 'help', text: HELP };
  }

  const parts = rest.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const sub = (parts[1] || '').toLowerCase();

  if (BLOCKED.has(cmd) || BLOCKED.has(sub)) {
    return {
      kind: 'denied',
      text: `「${cmd}${sub ? ' ' + sub : ''}」不在企微范围内。请用本机 CLI / IDE（生产变更需 human-approve）。`,
    };
  }

  if (cmd === 'collect' || (cmd === 'gex' && (sub === 'run' || sub === 'collect'))) {
    return {
      kind: 'invoke',
      id: 'gex.collect',
      args: {},
      async: true,
      ack: '已启动 gex.collect（默认 zero-dte SPY/QQQ/SPX + matrix 赵哥高频正股）。',
    };
  }

  if (cmd === 'gex') {
    if (sub === 'status' || sub === 'sum' || sub === 'summarize' || !sub) {
      // WeCom: status also returns wall digest (approved human-readable style)
      return { kind: 'invoke', id: 'gex.summarize', args: {} };
    }
    if (sub === 'fresh' || sub === 'freshness') {
      return { kind: 'invoke', id: 'gex.freshness', args: {} };
    }
    return { kind: 'denied', text: '用法: /ops gex [status|fresh|sum|run]' };
  }

  if (C0_MAP[cmd]) {
    return { kind: 'invoke', ...C0_MAP[cmd] };
  }

  return {
    kind: 'denied',
    text: `未知命令「${cmd}」。发送 /ops help 查看。`,
  };
}

export function formatInvokeResult(id, result) {
  const max = 1800;
  let body;
  try {
    body = JSON.stringify(result, null, 2);
  } catch {
    body = String(result);
  }
  if (body.length > max) body = `${body.slice(0, max)}\n…(truncated)`;
  return `[${id}]\n${body}`;
}
