/**
 * @file public/monitoring.js
 * @description P2-11 / P2-E: 健康看板前端轮询与 DOM 渲染逻辑
 *
 * 契约规范: docs/p2-11-dom-contract.md
 * 核心原则:
 * 1. 严格按 contract 填 DOM，不改动 HTML 结构；
 * 2. 轮询: 页面处于活跃状态时 5s，处于后台休眠 (hidden) 时降频至 30s；唤醒时立即拉取；
 * 3. 双进程内存语义: ingestRssMb == null 时隐藏合计并标注「仅看板进程」，严禁伪造合计；
 * 4. 推送 P95: 采样为空时展示 #spark-push-empty，严禁伪造假常数折线；
 * 5. 容错降级: 请求失败时保留上次成功快照，展示 #fetch-error 并附加 body.dash-degraded。
 */

(function () {
  'use strict';

  // 状态与定时器追踪
  let pollTimer = null;
  let isVisible = document.visibilityState === 'visible';
  let lastSuccessfulPayload = null;

  // DOM 元素缓存
  const els = {
    fetchError: document.getElementById('fetch-error'),
    dashTitle: document.getElementById('dash-title'),
    marketEt: document.getElementById('market-et'),
    marketBj: document.getElementById('market-bj'),
    refreshLabel: document.getElementById('refresh-label'),
    globalStatus: document.getElementById('global-status'),
    memWeb: document.getElementById('mem-web'),
    memIngest: document.getElementById('mem-ingest'),
    memCombined: document.getElementById('mem-combined'),
    memIngestWrap: document.getElementById('mem-ingest-wrap'),
    memBudget: document.getElementById('mem-budget'),
    memPercent: document.getElementById('mem-percent'),
    memNote: document.getElementById('mem-note'),
    uptime: document.getElementById('uptime'),
    sparkMemory: document.getElementById('spark-memory'),
    sparkMemoryCaption: document.getElementById('spark-memory-caption'),
    sparkPush: document.getElementById('spark-push'),
    sparkPushEmpty: document.getElementById('spark-push-empty'),
    alertFeed: document.getElementById('alert-feed'),
    alertFeedEmpty: document.getElementById('alert-feed-empty'),
  };

  /**
   * 格式化运行时间 (秒 -> Xd Xh Xm)
   */
  function formatUptime(seconds) {
    if (!seconds || seconds <= 0) return '0m';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  /**
   * 格式化告警发生时间 (提取 HH:mm:ss)
   */
  function formatAlertTime(beijingStr, ts) {
    if (beijingStr && typeof beijingStr === 'string') {
      const parts = beijingStr.split(' ');
      if (parts.length > 1) return parts[1];
      return beijingStr;
    }
    if (ts) {
      const d = new Date(ts);
      return d.toTimeString().substring(0, 8);
    }
    return '--:--:--';
  }

  /**
   * 字符串 HTML 转义防注入
   */
  function escapeHtml(str) {
    if (!str && str !== 0) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * 动态绘制内存最近 1 小时内联轻量 SVG 趋势线
   */
  function renderMemorySparkline(container, timestamps, values) {
    if (!container) return;
    if (!values || values.length < 2) {
      container.innerHTML = '<span class="spark-placeholder">等待时序数据…</span>';
      return;
    }

    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = (maxVal - minVal) || 1;
    const width = 300;
    const height = 70;
    const paddingX = 8;
    const paddingY = 8;

    const points = values.map((v, i) => {
      const x = paddingX + (i / (values.length - 1)) * (width - paddingX * 2);
      const y = height - paddingY - ((v - minVal) / range) * (height - paddingY * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    const lastVal = values[values.length - 1];

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:100%;overflow:visible;" preserveAspectRatio="none">
        <polyline fill="none" stroke="var(--accent, #2dd4bf)" stroke-width="2" points="${points}" />
        <text x="${width - paddingX}" y="${height - 2}" text-anchor="end" font-size="10" fill="var(--text-muted, #8b9aab)" font-family="var(--mono)">
          当前: ${lastVal}MB (${minVal}~${maxVal}MB)
        </text>
      </svg>
    `;
  }

  /**
   * 核心渲染函数：严格映射 JSON Payload 到 DOM Contract
   */
  function render(payload) {
    if (!payload || !payload.overall) return;
    lastSuccessfulPayload = payload;

    const { market, overall, subsystems = {}, recentAlerts = [], sparklines = {}, serverTimeBeijing } = payload;
    const overallStatus = overall.status || 'unknown';

    // 1. 全局状态 Banner & 顶层 class
    document.body.classList.remove('dash-ok', 'dash-warn', 'dash-critical');
    document.body.classList.add(`dash-${overallStatus}`);

    if (els.globalStatus) {
      els.globalStatus.setAttribute('data-level', overallStatus);
      const labelEl = els.globalStatus.querySelector('[data-role="label"]');
      if (labelEl) {
        labelEl.textContent = `GLOBAL: ${overallStatus.toUpperCase()}`;
      }
    }

    // 2. 美东与北京时间元信息
    if (els.marketEt) {
      const etStr = market?.currentET || '—';
      const statusText = market?.statusText ? ` (${market.statusText})` : '';
      els.marketEt.textContent = `美东: ${etStr}${statusText}`;
    }
    if (els.marketBj) {
      els.marketBj.textContent = `北京: ${serverTimeBeijing || '—'}`;
    }

    // 3. 双进程内存展示规则
    const mem = overall.memory || {};
    const webRss = mem.webRssMb ?? mem.rssMb;
    const ingestRss = mem.ingestRssMb;
    const combinedRss = mem.combinedRssMb;

    if (els.memWeb) els.memWeb.textContent = webRss != null ? webRss : '—';
    if (els.memBudget) els.memBudget.textContent = mem.budgetMb ?? 958;

    if (ingestRss == null) {
      // Ingest 进程未上报内存：隐藏合计，显式标注「仅看板进程」，严禁伪造合计
      if (els.memIngestWrap) els.memIngestWrap.hidden = true;
      if (els.memNote) els.memNote.textContent = '（仅看板进程）';
      if (els.memPercent) {
        const fallbackPercent = (webRss != null && mem.budgetMb)
          ? (Math.round((webRss / mem.budgetMb) * 1000) / 10)
          : '—';
        els.memPercent.textContent = fallbackPercent;
      }
    } else {
      // Ingest 内存存在：显示合计句式
      if (els.memIngestWrap) els.memIngestWrap.hidden = false;
      if (els.memIngest) els.memIngest.textContent = ingestRss;
      if (els.memCombined) els.memCombined.textContent = combinedRss != null ? combinedRss : '—';
      if (els.memPercent) els.memPercent.textContent = mem.budgetPercent != null ? mem.budgetPercent : '—';
      if (els.memNote) els.memNote.textContent = '';
    }

    // 4. Web 进程 Uptime
    if (els.uptime) {
      els.uptime.textContent = formatUptime(overall.uptimeSeconds);
    }

    // 5. 7 大核心子系统矩阵更新
    renderSubsystems(subsystems);

    // 6. 趋势微图更新 (恪守无假数据铁律)
    if (els.sparkMemoryCaption && sparklines.notes?.memoryRss) {
      els.sparkMemoryCaption.textContent = `内存 RSS（${sparklines.notes.memoryRss}）`;
    }
    renderMemorySparkline(els.sparkMemory, sparklines.timestamps, sparklines.memoryRss);

    // 推送 P95 绝不假画线
    const hasPushSamples = Array.isArray(sparklines.pushP95) && sparklines.pushP95.length > 0;
    if (els.sparkPushEmpty) {
      els.sparkPushEmpty.hidden = hasPushSamples;
    }

    // 7. 实时告警事件流
    renderAlertFeed(recentAlerts);
  }

  /**
   * 渲染核心子系统（含 P2-12g routeCoverage / tunnel）
   */
  function renderSubsystems(subsystems) {
    const keys = [
      'ingest',
      'aiTunnel',
      'eventLoop',
      'monitoringDb',
      'queues',
      'assets',
      'pushPipeline',
      'routeCoverage',
      'tunnel',
      'dataConsistency',
      'softDegrade',
    ];

    keys.forEach((key) => {
      const cell = document.querySelector(`[data-subsystem="${key}"]`);
      if (!cell) return;

      const sub = subsystems[key] || { status: 'unknown' };
      const statusLevel = sub.status || 'unknown';

      const statusEl = cell.querySelector('[data-role="status"]');
      if (statusEl) {
        statusEl.setAttribute('data-level', statusLevel);
        statusEl.innerHTML = `<span class="status-dot"></span> ${escapeHtml(statusLevel.toUpperCase())}`;
      }

      const detailEl = cell.querySelector('[data-role="detail"]');
      if (detailEl) {
        detailEl.innerHTML = getSubsystemDetailHtml(key, sub);
      }
    });
  }

  /**
   * 生成各子系统的多行细节 HTML
   */
  function getSubsystemDetailHtml(key, sub) {
    switch (key) {
      case 'ingest': {
        const delay = sub.delaySec != null ? `${sub.delaySec}s` : '—';
        const outcome = sub.lastOutcome || '—';
        const desc = sub.description || '—';
        return `心跳延迟: ${escapeHtml(delay)}<br>最近结果: ${escapeHtml(outcome)}<br>说明: ${escapeHtml(desc)}`;
      }
      case 'aiTunnel': {
        const desc = sub.description || sub.detail || '—';
        const state = sub.state || sub.status || 'unknown';
        // 不硬编码「隧道运行中」——quick tunnel 状态需真实探针，见线框注1
        return `AI 隧道状态: ${escapeHtml(state)}<br>说明: ${escapeHtml(desc)}<br>CF Tunnel: 见注1（重启可能换域）`;
      }
      case 'eventLoop': {
        const mean = sub.meanDelayMs != null ? `${sub.meanDelayMs}ms` : '—';
        const p99 = sub.p99DelayMs != null ? `${sub.p99DelayMs}ms` : '—';
        const max = sub.maxDelayMs != null ? `${sub.maxDelayMs}ms` : '—';
        return `平均延迟: ${escapeHtml(mean)}<br>P99 延迟: ${escapeHtml(p99)}<br>最大尖刺: ${escapeHtml(max)}`;
      }
      case 'monitoringDb': {
        const readonlySafe = sub.readonlySafe === true
          ? '正常 (只读安全)'
          : (sub.readonlySafe === false ? '非只读模式' : '未知');
        const desc = sub.description || '—';
        return `模式: ${escapeHtml(readonlySafe)}<br>状态: ${escapeHtml(desc)}`;
      }
      case 'queues': {
        const media = sub.mediaPending != null ? sub.mediaPending : '—';
        const offline = sub.offlinePending != null ? sub.offlinePending : '—';
        const bp = sub.backpressureLevel || sub.backpressure || sub.status || '—';
        return `Media 待下载: ${escapeHtml(media)}<br>离线任务积压: ${escapeHtml(offline)}<br>背压: ${escapeHtml(bp)}`;
      }
      case 'assets': {
        const persona = sub.persona ? `${sub.persona.lagDays ?? 0}天 (${sub.persona.status})` : '—';
        const l2a = sub.l2a ? `${sub.l2a.lagDays ?? 0}天 (${sub.l2a.status})` : '—';
        const news = sub.news?.description || (sub.news?.status ? sub.news.status : '—');
        return `Persona: ${escapeHtml(persona)}<br>L2a 水位: ${escapeHtml(l2a)}<br>News: ${escapeHtml(news)}`;
      }
      case 'pushPipeline': {
        const p95 = sub.recentP95TtlMs != null ? `${sub.recentP95TtlMs}ms` : '暂无数据';
        const failures = sub.consecutiveFailures != null ? `${sub.consecutiveFailures} 次` : '0 次';
        const circuit = sub.circuitOpen ? '熔断开启' : '闭合正常';
        return `实时 P95 TTL: ${escapeHtml(p95)} (环形缓冲)<br>连续失败: ${escapeHtml(failures)}<br>推送熔断器: ${escapeHtml(circuit)}`;
      }
      case 'routeCoverage': {
        const fail = sub.failCount != null ? String(sub.failCount) : '—';
        const desc = sub.description || '—';
        const bad = Array.isArray(sub.paths)
          ? sub.paths.filter((p) => p && p.ok === false).map((p) => p.path).slice(0, 3)
          : [];
        const badLine = bad.length
          ? `异常: ${escapeHtml(bad.join(', '))}`
          : '异常路径: 无';
        return `失败数: ${escapeHtml(fail)}<br>${badLine}<br>说明: ${escapeHtml(desc)}`;
      }
      case 'tunnel': {
        const enabled = sub.enabled === false ? '关闭' : (sub.enabled === true ? '开启' : '—');
        const url = sub.url || '—';
        const desc = sub.description || (sub.status === 'off' ? 'ENABLE_TUNNEL 未开启' : '—');
        const note = '重启可能换域；以落盘时间为准';
        const urlHtml = sub.url
          ? `<a href="${escapeHtml(sub.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`
          : escapeHtml(url);
        return `开关: ${escapeHtml(enabled)}<br>URL: ${urlHtml}<br>${escapeHtml(note)}<br>说明: ${escapeHtml(desc)}`;
      }
      case 'dataConsistency': {
        const checked = sub.checked != null ? String(sub.checked) : '—';
        const mismatch = sub.mismatchCount != null ? String(sub.mismatchCount) : '—';
        const cats = sub.categories || {};
        const c1 = cats.dbHasAttachMissingFile ?? 0;
        const c2 = cats.manifestMissingFile ?? 0;
        const c3 = cats.dbAttachParseError ?? 0;
        const skip = sub.skippedRemoteOnly != null ? String(sub.skippedRemoteOnly) : '0';
        const desc = sub.description || '—';
        const notes = sub.notes || 'sampled_only';
        return `抽样核验: ${escapeHtml(checked)} · 偏差: ${escapeHtml(mismatch)}<br>`
          + `C1缺文件:${escapeHtml(String(c1))} C2清单:${escapeHtml(String(c2))} C3坏JSON:${escapeHtml(String(c3))}<br>`
          + `跳过纯远程: ${escapeHtml(skip)}<br>说明: ${escapeHtml(desc)}<br><span class="cell-note">${escapeHtml(notes)}</span>`;
      }
      case 'softDegrade': {
        const actions = Array.isArray(sub.activeActions) ? sub.activeActions : [];
        const count = String(actions.length);
        const ids = actions.slice(0, 4).map((a) => a?.id).filter(Boolean);
        const idLine = ids.length ? ids.join(', ') : '无';
        const desc = sub.description || '—';
        const notes = sub.notes || 'safe_soft_degrade_only, zero_pm2_restart';
        return `生效动作: ${escapeHtml(count)}<br>ID: ${escapeHtml(idLine)}<br>说明: ${escapeHtml(desc)}`
          + `<br><span class="cell-note">${escapeHtml(notes)}</span>`;
      }
      default:
        return escapeHtml(sub.description || JSON.stringify(sub));
    }
  }

  /**
   * 渲染告警事件列表
   */
  function renderAlertFeed(alerts) {
    if (!els.alertFeed) return;

    if (!Array.isArray(alerts) || alerts.length === 0) {
      if (els.alertFeedEmpty) els.alertFeedEmpty.hidden = false;
      els.alertFeed.innerHTML = '';
      return;
    }

    if (els.alertFeedEmpty) els.alertFeedEmpty.hidden = true;

    const itemsHtml = alerts.map((a) => {
      const level = a.level || 'info';
      const timeStr = formatAlertTime(a.createdAtBeijing, a.createdAt);
      const msg = a.message || a.title || '系统告警';
      return `<li data-level="${escapeHtml(level)}">[${escapeHtml(timeStr)}] ${escapeHtml(level.toUpperCase())}: ${escapeHtml(msg)}</li>`;
    }).join('');

    els.alertFeed.innerHTML = itemsHtml;
  }

  /**
   * 显示错误条并标记降级半透明
   */
  function showError() {
    if (els.fetchError) els.fetchError.hidden = false;
    document.body.classList.add('dash-degraded');
  }

  /**
   * 恢复正常展示
   */
  function hideError() {
    if (els.fetchError) els.fetchError.hidden = true;
    document.body.classList.remove('dash-degraded');
  }

  /**
   * 执行单次拉取
   */
  async function poll() {
    try {
      const res = await fetch('/api/monitoring/dashboard', {
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const data = await res.json();
      if (!data || data.success === false) {
        throw new Error(data?.error || '接口返回异常状态');
      }

      render(data);
      hideError();
    } catch (err) {
      console.warn('[monitoring] 拉取看板数据失败:', err.message);
      showError();
      // 保留上次成功数据，绝不白屏清空
      if (lastSuccessfulPayload) {
        render(lastSuccessfulPayload);
      }
    } finally {
      scheduleNext();
    }
  }

  /**
   * 计算下一轮延迟并调度
   */
  function scheduleNext(customDelay) {
    if (pollTimer) clearTimeout(pollTimer);
    const delay = customDelay != null ? customDelay : (isVisible ? 5000 : 30000);
    pollTimer = setTimeout(poll, delay);
  }

  /**
   * 监听浏览器标签页可见性变更
   */
  document.addEventListener('visibilitychange', () => {
    const nextVisible = document.visibilityState === 'visible';
    if (nextVisible !== isVisible) {
      isVisible = nextVisible;
      if (els.refreshLabel) {
        els.refreshLabel.textContent = isVisible ? '刷新: 5s' : '刷新: 30s (休眠)';
      }
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      if (isVisible) {
        // 唤醒切回前台：清掉挂起定时器后立即拉取
        poll();
      } else {
        scheduleNext(30000);
      }
    }
  });

  // 页面加载完成后立即启动初次拉取
  if (els.refreshLabel) els.refreshLabel.textContent = '刷新: 5s';
  poll();
})();

