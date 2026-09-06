/**
 * Day-level GEX structure strip (hint only). Shared by ticker timeline + quant tab.
 * Does not auto-align, does not write, does not change header risk color.
 * Default strip = walls/regime; expand = delta metadata + heatmap entry (no ladder dump).
 */
(function (global) {
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtGex(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    const v = Number(n);
    const sign = v > 0 ? '+' : v < 0 ? '−' : '';
    const abs = Math.abs(v);
    if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return sign + '$' + (abs / 1e3).toFixed(0) + 'K';
    return sign + '$' + abs.toFixed(0);
  }

  function fmtStrike(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    const v = Number(n);
    return Number.isInteger(v) ? String(v) : v.toFixed(v >= 1000 ? 0 : 2);
  }

  function fmtPct(n) {
    if (n == null || !Number.isFinite(Number(n))) return '';
    const v = Number(n);
    const sign = v > 0 ? '+' : '';
    return sign + v.toFixed(2) + '%';
  }

  function kindLabel(kind) {
    if (kind === 'nearest') return '最近到期（非 0DTE）';
    if (kind === '0dte' || kind === '0DTE') return '0DTE';
    if (kind === 'matrix') return '多到期日矩阵';
    return kind || '';
  }

  function wallLine(label, wall) {
    if (!wall) return label + ' —';
    const expiry = wall.expiry ? ' @' + wall.expiry.slice(5) : '';
    return label + ' ' + fmtStrike(wall.strike) + expiry + ' (' + fmtGex(wall.net_gex) + ')';
  }

  function columnLine(totals) {
    if (!totals || typeof totals !== 'object') return '';
    const keys = Object.keys(totals).sort();
    if (!keys.length) return '';
    return keys.map((k) => {
      const v = totals[k];
      const cls = Number(v) < 0 ? 'gex-neg' : Number(v) > 0 ? 'gex-pos' : '';
      return '<span class="' + cls + '">' + escapeHtml(k.slice(5)) + ' ' + fmtGex(v) + '</span>';
    }).join(' · ');
  }

  function coverageLine(cov) {
    if (!cov || cov.got == null || cov.total == null) return '';
    return '期权覆盖 ' + cov.got + '/' + cov.total;
  }

  function indexChip(ticker, item) {
    if (!item) return '';
    const kind = kindLabel(item.kind);
    const kindCls = item.kind === 'nearest' ? 'gex-kind-nearest' : '';
    return (
      '<div class="gex-chip">' +
        '<div class="gex-chip-title">' + escapeHtml(ticker) +
          (kind ? ' <span class="gex-kind ' + kindCls + '">' + escapeHtml(kind) + '</span>' : '') +
        '</div>' +
        '<div>现货 ' + fmtStrike(item.spot) + ' · 价位 ' + fmtStrike(item.spot_strike) + '</div>' +
        '<div>' + escapeHtml(wallLine('Floor', item.floor)) + '</div>' +
        '<div>' + escapeHtml(wallLine('King', item.king)) + '</div>' +
        (item.regime ? '<div class="gex-muted">局部 gamma：' + escapeHtml(item.regime) + '</div>' : '') +
      '</div>'
    );
  }

  /** Expand panel: only fields NOT already on the default chip. */
  function detailExtras(ticker, item, isMatrix) {
    if (!item) return '';
    const lines = [];
    lines.push('<div class="gex-detail-block">');
    lines.push('<div class="gex-chip-title">' + escapeHtml(ticker) + (isMatrix ? ' 矩阵详情' : ' 详情') + '</div>');

    if (item.kind) lines.push('<div>类型 ' + escapeHtml(kindLabel(item.kind)) + '</div>');
    if (item.expiry) lines.push('<div>到期 ' + escapeHtml(item.expiry) + '</div>');
    if (item.expiries && item.expiries.length) {
      lines.push('<div>到期日列 ' + escapeHtml(item.expiries.join(' · ')) + '</div>');
    }
    if (item.spot_strike != null && isMatrix) {
      lines.push('<div>价位档 ' + fmtStrike(item.spot_strike) + '</div>');
    }
    if (item.change_pct != null) {
      const pct = fmtPct(item.change_pct);
      const cls = Number(item.change_pct) < 0 ? 'gex-neg' : Number(item.change_pct) > 0 ? 'gex-pos' : '';
      lines.push('<div>现货涨跌 <span class="' + cls + '">' + escapeHtml(pct) + '</span></div>');
    }
    if (item.local_gex != null) lines.push('<div>局部 GEX ' + fmtGex(item.local_gex) + '</div>');
    const cov = coverageLine(item.coverage);
    if (cov) lines.push('<div>' + escapeHtml(cov) + '</div>');
    if (item.column_totals) {
      lines.push('<div class="gex-cols"><strong>各到期日列合计</strong><br>' + columnLine(item.column_totals) + '</div>');
    }
    if (item.note) lines.push('<div class="gex-muted">' + escapeHtml(item.note) + '</div>');
    if (lines.length <= 2) {
      lines.push('<div class="gex-muted">墙位见上方摘要；价位阶梯请打开热图。</div>');
    }
    lines.push('</div>');
    return lines.join('');
  }

  function reportsHtml(reports, prominent) {
    if (!Array.isArray(reports) || !reports.length) {
      return '<div class="gex-muted">暂无 HTML 热图文件（本机采集后会出现）</div>';
    }
    return (
      '<div class="gex-report-links' + (prominent ? ' gex-report-links-lg' : '') + '">' +
      reports.map((r) => (
        '<a class="gex-report-link" href="' + escapeHtml(r.href) + '" target="_blank" rel="noopener noreferrer">' +
          escapeHtml(r.title || r.id) +
        '</a>'
      )).join('') +
      '</div>'
    );
  }

  function analysisHtml(analysis) {
    if (!analysis || !analysis.headline) return '';
    const bullets = Array.isArray(analysis.bullets) ? analysis.bullets : [];
    const caveats = Array.isArray(analysis.caveats) ? analysis.caveats : [];
    return (
      '<div class="gex-analysis">' +
        '<div class="gex-analysis-head">' +
          '<strong>结构解读 / 结论</strong>' +
          '<span class="gex-muted">规则引擎 · 非买卖指令</span>' +
        '</div>' +
        '<div class="gex-analysis-headline">' + escapeHtml(analysis.headline) + '</div>' +
        (bullets.length
          ? '<ul class="gex-analysis-bullets">' +
            bullets.map((b) => '<li>' + escapeHtml(b) + '</li>').join('') +
            '</ul>'
          : '') +
        (caveats.length
          ? '<div class="gex-analysis-caveats">' + escapeHtml(caveats.join(' · ')) + '</div>'
          : '') +
      '</div>'
    );
  }

  function bindToggle(el) {
    const btn = el.querySelector('[data-role="gex-toggle"]');
    const panel = el.querySelector('[data-role="gex-detail"]');
    if (!btn || !panel) return;
    btn.addEventListener('click', () => {
      const open = panel.hidden;
      panel.hidden = !open;
      btn.textContent = open ? '收起详情' : '详情与热图';
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  function renderGexSummary(el, data, symbol) {
    if (!el) return;
    if (!data || data.missing) {
      el.hidden = false;
      el.className = 'gex-summary is-missing';
      el.innerHTML = '<div class="gex-summary-head"><strong>GEX 结构提示</strong><span>暂无结构快照（不是持有信号）</span></div>';
      return;
    }

    const stale = !!data.stale;
    const ok = data.ok !== false;
    el.hidden = false;
    el.className = 'gex-summary' + (ok ? '' : ' is-bad') + (stale ? ' is-stale' : '');

    const focus = data.focus || {};
    const query = focus.query || symbol || '';
    const underlying = focus.underlying;
    let focusNote = '';
    if (query && underlying && query !== underlying) {
      focusNote = escapeHtml(query) + ' 事件看 ' + escapeHtml(underlying) + ' 正股 GEX';
    } else if (underlying) {
      focusNote = '焦点 ' + escapeHtml(underlying);
    }

    const tsla = data.matrix && data.matrix.TSLA ? data.matrix.TSLA : null;
    const spy = data.index && data.index.SPY ? data.index.SPY : null;
    const qqq = data.index && data.index.QQQ ? data.index.QQQ : null;
    const spx = data.index && data.index.SPX ? data.index.SPX : null;
    const col = data.collection || {};

    const age = data.age_minutes == null ? '—' : String(data.age_minutes) + ' 分钟';
    const statusBits = [];
    statusBits.push(ok ? '采集成功' : '采集失败');
    statusBits.push(stale ? '结构过期' : '结构较新');
    statusBits.push('OI 截至昨日收盘（T+1）');
    statusBits.push('不是买卖指令');

    let tslaBlock = '';
    if (tsla) {
      tslaBlock =
        '<div class="gex-chip gex-chip-focus">' +
          '<div class="gex-chip-title">TSLA</div>' +
          '<div>现货 ' + fmtStrike(tsla.spot) + '</div>' +
          '<div>' + escapeHtml(wallLine('Floor', tsla.floor)) + '</div>' +
          '<div>' + escapeHtml(wallLine('King', tsla.king)) + '</div>' +
          '<div class="gex-muted">列合计 / 到期日见「详情与热图」</div>' +
        '</div>';
    }

    const detailBody =
      '<div class="gex-detail-lead">' +
        '<strong>详情里多看什么</strong>' +
        '<ul>' +
          '<li>到期类型、局部 GEX、期权覆盖、涨跌幅、各到期日列合计（上方摘要只保留墙位）</li>' +
          '<li><strong>完整价位阶梯 / 矩阵色块在 HTML 热图</strong>，本条 API 故意不灌 ladder</li>' +
          '<li>周末/代理常为「最近到期（非 0DTE）」；OI 是昨日收盘，不是实时持仓</li>' +
        '</ul>' +
      '</div>' +
      '<div class="gex-detail-meta">' +
        '<div>生成 ' + escapeHtml(data.generated_at || '—') + '</div>' +
        '<div>session ' + escapeHtml(data.session || '—') + '</div>' +
        '<div>source ' + escapeHtml(data.source || '—') + '</div>' +
        '<div>oi_as_of ' + escapeHtml(data.oi_as_of || 'yesterday_close') + '</div>' +
        '<div>年龄 ' + escapeHtml(age) + '</div>' +
        (col.futu_us_option ? '<div>futu_us_option ' + escapeHtml(String(col.futu_us_option)) + '</div>' : '') +
        (col.index_spot ? '<div>index_spot ' + escapeHtml(String(col.index_spot)) + '</div>' : '') +
      '</div>' +
      (col.note ? '<div class="gex-detail-note">' + escapeHtml(col.note) + '</div>' : '') +
      '<div class="gex-detail-grid">' +
        detailExtras('TSLA', tsla, true) +
        detailExtras('SPY', spy, false) +
        detailExtras('QQQ', qqq, false) +
        detailExtras('SPX', spx, false) +
      '</div>' +
      '<div class="gex-detail-reports">' +
        '<strong>打开完整热图（新标签）</strong>' +
        reportsHtml(data.reports, true) +
      '</div>' +
      '<div class="gex-summary-foot">' + escapeHtml(data.disclaimer || '结构快照，不是预测，不构成投资建议。') + '</div>';

    el.innerHTML =
      '<div class="gex-summary-head">' +
        '<strong>GEX 结构提示</strong>' +
        '<span>' + escapeHtml(statusBits.join(' · ')) + '</span>' +
        '<span class="gex-muted">生成 ' + escapeHtml(data.generated_at || '—') + ' · 年龄 ' + escapeHtml(age) + '</span>' +
      '</div>' +
      (focusNote ? '<div class="gex-focus">' + focusNote + '</div>' : '') +
      analysisHtml(data.analysis) +
      '<div class="gex-summary-grid">' +
        tslaBlock +
        indexChip('SPY', spy) +
        indexChip('QQQ', qqq) +
        indexChip('SPX', spx) +
      '</div>' +
      '<div class="gex-actions">' +
        '<button type="button" class="gex-toggle-btn" data-role="gex-toggle" aria-expanded="false">详情与热图</button>' +
        '<span class="gex-actions-label">快捷</span>' +
        reportsHtml(data.reports, false) +
      '</div>' +
      '<div class="gex-detail" data-role="gex-detail" hidden>' + detailBody + '</div>' +
      '<div class="gex-summary-foot">' + escapeHtml(data.disclaimer || '结构快照，不是预测，不构成投资建议。') + '</div>';

    bindToggle(el);
  }

  async function loadGexSummary(elOrId, symbol) {
    const el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
    if (!el) return;
    const q = symbol ? ('?symbol=' + encodeURIComponent(symbol)) : '';
    try {
      const res = await fetch('/api/gex/latest' + q);
      const json = await res.json();
      renderGexSummary(el, json && json.data, symbol);
    } catch (err) {
      el.hidden = false;
      el.className = 'gex-summary is-bad';
      el.innerHTML = '<div class="gex-summary-head"><strong>GEX 结构提示</strong><span>加载失败（不是持有信号）</span></div>';
    }
  }

  global.loadGexSummary = loadGexSummary;
})(window);
