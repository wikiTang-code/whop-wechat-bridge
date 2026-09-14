/**
 * Deterministic WeCom reply formatter (no LLM).
 * Style: short Chinese summary + key rows (see approved GEX sample).
 */
import { formatInvokeResult } from './commands.js';

const MAX = 1800;

function fmtNum(n) {
  if (n == null || Number.isNaN(Number(n))) return '-';
  const x = Number(n);
  const a = Math.abs(x);
  if (a >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(x / 1e3).toFixed(1)}K`;
  return String(Math.round(x * 100) / 100);
}

function unwrap(result) {
  if (!result || typeof result !== 'object') return { ok: false, data: result };
  if (result.data !== undefined && (result.id || result.ok !== undefined)) {
    return { ok: result.ok !== false, id: result.id, data: result.data, error: result.error || result.message };
  }
  return { ok: result.ok !== false, data: result, error: result.error };
}

function clip(lines) {
  let text = lines.filter((x) => x !== null && x !== undefined).join('\n');
  if (text.length > MAX) text = `${text.slice(0, MAX - 20)}\n…(已截断)`;
  return text;
}

function headline(id, ok, extra = '') {
  const mark = ok ? '✅' : '❌';
  return `${mark} [${id}]${extra ? ` ${extra}` : ''}`;
}

function formatGexSummarize(data) {
  const d = data || {};
  const lines = [
    headline('gex.summarize', d.ok !== false && !d.missing, d.stale ? '偏旧' : '较新'),
    '⚠️ 结构快照，不是下单信号；OI 为 T+1。',
    '',
    `快照：${d.generated_at || '?'}（约 ${d.age_minutes ?? '?'} 分钟前）`,
    `状态：${d.stale ? '偏旧/过期' : '较新'} · ${d.session || '-'} · ${d.source || '-'}`,
    '',
    '指数墙：',
  ];
  for (const sym of ['SPY', 'QQQ', 'SPX']) {
    const x = d.index?.[sym];
    if (!x) continue;
    lines.push(
      `• ${sym} 现货 ${x.spot ?? '-'}`
      + ` | KING ${x.king?.strike ?? '-'} (${fmtNum(x.king?.net_gex)})`
      + ` | FLOOR ${x.floor?.strike ?? '-'} (${fmtNum(x.floor?.net_gex)})`
      + ` | ${x.regime || '-'}`,
    );
  }
  const tsla = d.matrix?.TSLA;
  if (tsla) {
    lines.push('');
    lines.push(
      `个股 TSLA：现货 ${tsla.spot ?? '-'}`
      + ` | KING ${tsla.king?.strike ?? '-'}`
      + ` | FLOOR ${tsla.floor?.strike ?? '-'}`
      + ` | ${tsla.regime || '-'}`,
    );
  } else if (d.focus?.underlying || d.focus?.query) {
    lines.push('');
    lines.push(`个股焦点：${d.focus.underlying || d.focus.query}`);
  }
  lines.push('');
  lines.push('读法：正 gamma 偏粘；KING≈阻力、FLOOR≈支撑。对齐赵哥价位再看，勿单独当信号。');
  return clip(lines);
}

function formatGexStatus(data) {
  const d = data || {};
  return clip([
    headline('gex.status', d.ok !== false && !d.missing, d.stale ? '偏旧' : '较新'),
    `生成：${d.generated_at || '?'}（约 ${d.age_minutes ?? '?'} 分钟前）`,
    `session=${d.session || '-'} source=${d.source || '-'} collection_ok=${d.collection_ok}`,
    `errors=${d.error_count ?? 0} oi_as_of=${d.oi_as_of || '-'}`,
    '',
    '要看 KING/FLOOR 墙，请发 /ops gex sum',
  ]);
}

function formatGexFreshness(data) {
  const d = data || {};
  return clip([
    headline('gex.freshness', !d.missing && d.rating !== 'stale', d.rating || ''),
    `生成：${d.generated_at || '?'} · 年龄约 ${d.age_minutes ?? '?'} 分钟`,
    `session=${d.session || '-'} stale=${d.stale} missing=${d.missing}`,
  ]);
}

function formatGexCollect(data) {
  const d = data || {};
  const ok = d.ok === true;
  const lines = [
    headline('gex.collect', ok, ok ? '完成' : '失败或未完成'),
    `exit=${d.exit_code ?? '-'} zero_dte=${(d.zero_dte || []).join(',') || '-'}`,
    `matrix=${(d.matrix || []).join(',') || '-'} expiries=${d.expiries ?? '-'}`,
    `generated_at=${d.generated_at || '-'} errors=${d.error_count ?? '-'}`,
  ];
  if (d.error === 'opend_unreachable') {
    lines.push('');
    lines.push(d.stderr_tail || 'OpenD 未启动。');
    return clip(lines);
  }
  if (d.stderr_tail) {
    lines.push('');
    lines.push('stderr 尾：');
    lines.push(String(d.stderr_tail).slice(-600));
  }
  lines.push('');
  lines.push(ok ? '可发 /ops gex sum 查看墙摘要。' : '请检查本机 OpenD / 长桥后重试 /ops collect。');
  return clip(lines);
}

function formatPm2(data) {
  const d = data || {};
  const apps = d.apps || d.pm2?.apps || [];
  const lines = [headline('gcp.pm2_status', d.ok !== false), ''];
  if (!apps.length) lines.push('（无进程数据）');
  for (const a of apps) {
    lines.push(`• ${a.name}: ${a.status || '?'} · rss ${a.rss_mb ?? '-'}MB` + (a.restarts != null ? ` · restarts ${a.restarts}` : ''));
  }
  return clip(lines);
}

function formatHealthBundle(data) {
  const d = data || {};
  const health = d.health || {};
  const subs = health.subsystems || {};
  const lines = [
    headline('gcp.health_bundle', d.ok === true || health.ok === true, health.status || ''),
    '',
    '子系统：',
  ];
  for (const [k, v] of Object.entries(subs)) {
    lines.push(`• ${k}: ${typeof v === 'object' ? (v.status || JSON.stringify(v)) : v}`);
  }
  if (d.pm2?.apps) {
    lines.push('');
    lines.push('PM2：');
    for (const a of d.pm2.apps) {
      lines.push(`• ${a.name}: ${a.status} · ${a.rss_mb ?? '-'}MB`);
    }
  }
  if (d.git) {
    lines.push('');
    lines.push(`Git：${d.git.short || d.git.sha || '-'} (${d.git.branch || '-'})`);
  }
  return clip(lines);
}

function formatResources(data) {
  const d = data || {};
  const raw = typeof d === 'object' ? d : {};
  // ssh recipe may nest under stdout parse — keep flexible
  const body = raw.data && typeof raw.data === 'object' ? raw.data : raw;
  return clip([
    headline('gcp.resources', body.ok !== false),
    typeof body === 'string' ? body : JSON.stringify(body, null, 2).slice(0, 1400),
  ]);
}

function formatGit(data) {
  const d = data || {};
  return clip([
    headline('gcp.git_head', d.ok !== false),
    `HEAD ${d.short || d.sha || d.head || '-'}`,
    `branch ${d.branch || '-'}`,
    d.message ? `msg: ${String(d.message).slice(0, 200)}` : null,
  ]);
}

function formatLmStatus(data) {
  const d = data || {};
  const models = (d.models || []).slice(0, 8).join(', ') || '-';
  return clip([
    headline('lm.status', d.reachable === true, d.reachable ? '可达' : '不可达'),
    `${d.host || '127.0.0.1'}:${d.port || 8080} · rtt ${d.rtt_ms ?? '-'}ms`,
    `models: ${models}`,
    d.lms_ps?.output ? `\n${String(d.lms_ps.output).trim().slice(0, 800)}` : null,
  ]);
}

function formatTunnel(data) {
  const d = data || {};
  return clip([
    headline('lm.tunnel.status', d.ok !== false && d.running !== false),
    `running=${d.running ?? d.ok} pid=${d.pid ?? '-'}`,
    d.detail || d.error || null,
    d.remote_probe ? `remote: ${JSON.stringify(d.remote_probe).slice(0, 400)}` : null,
  ]);
}

function formatDashList(data) {
  const d = data || {};
  const boards = d.boards || d.items || [];
  const lines = [headline('dash.list', d.ok !== false), ''];
  if (!boards.length && d.urls) {
    for (const u of d.urls) lines.push(`• ${u}`);
  } else {
    for (const b of boards) {
      lines.push(`• ${b.id || b.name || b}: ${b.url || b.path || ''}`);
    }
  }
  if (lines.length === 2) lines.push(JSON.stringify(d).slice(0, 1200));
  return clip(lines);
}

function formatWhoami(data) {
  const d = data || {};
  return clip([
    headline('ops.whoami', true),
    `phase=${d.phase || '-'} max_class=${d.max_class || '-'} role=${d.role || '-'}`,
    `allow: ${(d.allow || []).join(', ') || '-'}`,
  ]);
}

/**
 * @param {string} id capability id
 * @param {any} result gateway invoke result or raw data / Error
 */
export function formatWecomReply(id, result) {
  if (result instanceof Error) {
    return clip([headline(id || 'error', false, '异常'), result.message]);
  }
  const { ok, data, error } = unwrap(result);
  const payload = data !== undefined ? data : result;

  try {
    switch (id) {
      case 'gex.summarize':
        return formatGexSummarize(payload);
      case 'gex.status':
        return formatGexStatus(payload);
      case 'gex.freshness':
        return formatGexFreshness(payload);
      case 'gex.collect':
        return formatGexCollect(payload);
      case 'gcp.pm2_status':
        return formatPm2(payload);
      case 'gcp.health_bundle':
      case 'gcp.health':
        return formatHealthBundle(payload);
      case 'gcp.resources':
        return formatResources(payload);
      case 'gcp.git_head':
        return formatGit(payload);
      case 'lm.status':
        return formatLmStatus(payload);
      case 'lm.tunnel.status':
      case 'lm.circuit_status':
        return formatTunnel(payload);
      case 'dash.list':
        return formatDashList(payload);
      case 'ops.whoami':
        return formatWhoami(payload);
      default:
        if (!ok && error) return clip([headline(id, false), String(error)]);
        return formatInvokeResult(id, result);
    }
  } catch (err) {
    return formatInvokeResult(id, result);
  }
}
