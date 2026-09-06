/**
 * Day-level GEX structure strip (hint only). Shared by ticker timeline + quant tab.
 * Does not auto-align, does not write, does not change header risk color.
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

  function kindLabel(kind) {
    if (kind === 'nearest') return '最近到期（非 0DTE）';
    if (kind === '0dte' || kind === '0DTE') return '0DTE';
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
          (tsla.column_totals
            ? '<div class="gex-cols">列合计 ' + columnLine(tsla.column_totals) + '</div>'
            : '') +
        '</div>';
    }

    el.innerHTML =
      '<div class="gex-summary-head">' +
        '<strong>GEX 结构提示</strong>' +
        '<span>' + escapeHtml(statusBits.join(' · ')) + '</span>' +
        '<span class="gex-muted">生成 ' + escapeHtml(data.generated_at || '—') + ' · 年龄 ' + escapeHtml(age) + '</span>' +
      '</div>' +
      (focusNote ? '<div class="gex-focus">' + focusNote + '</div>' : '') +
      '<div class="gex-summary-grid">' +
        tslaBlock +
        indexChip('SPY', spy) +
        indexChip('QQQ', qqq) +
        indexChip('SPX', spx) +
      '</div>' +
      '<div class="gex-summary-foot">' + escapeHtml(data.disclaimer || '结构快照，不是预测，不构成投资建议。') + '</div>';
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
