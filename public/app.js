// Global state
let state = {
  messages: [],
  reports: [],
  config: {},
  searchQuery: '',
  activeTab: 'tab-analyst',
  portfolio: {},
  positions: [],
  orders: [],
  messagesOffset: 0,
  messagesLimit: 50,
  totalMessages: 0
};

// ==========================================================================
// Initialization & Event Listeners
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  initApp();
  setupEventListeners();
  initLayoutResizer();
});

function initApp() {
  fetchConfig();
  fetchMessages();
  fetchReports();
  fetchQuantData(); // Fetch quantitative data
}

function initLayoutResizer() {
  const grid = document.getElementById('tab-analyst');
  const splitter = document.getElementById('analyst-splitter');

  if (!grid || !splitter) return;

  let isDragging = false;

  splitter.addEventListener('mousedown', (e) => {
    isDragging = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const gridRect = grid.getBoundingClientRect();
    const leftWidth = e.clientX - gridRect.left;
    const totalWidth = gridRect.width;

    // Convert to percentage
    const leftPercentage = (leftWidth / totalWidth) * 100;

    // Apply constraints: min 20%, max 80%
    if (leftPercentage > 20 && leftPercentage < 80) {
      grid.style.gridTemplateColumns = `${leftPercentage}% 8px ${100 - leftPercentage - 0.5}%`;
    }
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    }
  });

  // Touch support for mobile/tablet drag if visible
  splitter.addEventListener('touchstart', (e) => {
    isDragging = true;
  });

  document.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    if (e.touches.length === 0) return;

    const touch = e.touches[0];
    const gridRect = grid.getBoundingClientRect();
    const leftWidth = touch.clientX - gridRect.left;
    const totalWidth = gridRect.width;

    const leftPercentage = (leftWidth / totalWidth) * 100;

    if (leftPercentage > 20 && leftPercentage < 80) {
      grid.style.gridTemplateColumns = `${leftPercentage}% 8px ${100 - leftPercentage - 0.5}%`;
    }
  });

  document.addEventListener('touchend', () => {
    if (isDragging) {
      isDragging = false;
    }
  });
}

function setupEventListeners() {
  // Sync button
  document.getElementById('btn-sync').addEventListener('click', triggerSync);
  
  // Settings modal open/close
  document.getElementById('btn-settings').addEventListener('click', openSettingsModal);
  document.getElementById('btn-close-settings').addEventListener('click', closeSettingsModal);
  document.getElementById('btn-cancel-settings').addEventListener('click', closeSettingsModal);
  
  // Settings AI Provider toggle
  document.getElementById('ai_provider').addEventListener('change', toggleAIFields);
  
  // Settings form submit
  document.getElementById('settings-form').addEventListener('submit', saveSettings);
  
  // Close report detail modal
  document.getElementById('btn-close-report').addEventListener('click', closeReportModal);
  document.getElementById('btn-close-report-footer').addEventListener('click', closeReportModal);
  document.getElementById('btn-copy-report').addEventListener('click', copyReportToClipboard);
  
  // Close context messages modal
  document.getElementById('btn-close-context').addEventListener('click', closeContextModal);
  document.getElementById('btn-close-context-footer').addEventListener('click', closeContextModal);
  
  // Tab switching logic
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      switchTab(tabId);
    });
  });

  // Manual trade form submit
  document.getElementById('manual-trade-form').addEventListener('submit', handleManualTrade);

  // Reset simulation account
  document.getElementById('btn-reset-portfolio').addEventListener('click', handleResetPortfolio);

  // Search input
  const searchInput = document.getElementById('search-input');
  const clearSearchBtn = document.getElementById('btn-clear-search');
  
  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim();
    if (state.searchQuery) {
      clearSearchBtn.style.display = 'block';
    } else {
      clearSearchBtn.style.display = 'none';
    }
    // Debounce message search
    debounce(() => fetchMessages(state.searchQuery), 300)();
  });
  
  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    state.searchQuery = '';
    clearSearchBtn.style.display = 'none';
    fetchMessages();
  });

  // Only speakers checkbox change
  document.getElementById('chk-only-speakers').addEventListener('change', () => {
    fetchMessages(state.searchQuery);
  });

  // Sector dropdown filter change
  document.getElementById('filter-sector').addEventListener('change', () => {
    fetchMessages(state.searchQuery);
  });

  // Strategy dropdown filter change
  document.getElementById('filter-strategy').addEventListener('change', () => {
    fetchMessages(state.searchQuery);
  });

  // Start date filter change
  document.getElementById('filter-start-date').addEventListener('change', () => {
    fetchMessages(state.searchQuery);
  });

  // End date filter change
  document.getElementById('filter-end-date').addEventListener('change', () => {
    fetchMessages(state.searchQuery);
  });

  // AI dimensional review click listener
  document.getElementById('btn-ai-review').addEventListener('click', triggerAIReview);

  // RAG Q&A form submit
  const ragForm = document.getElementById('rag-chat-form');
  if (ragForm) {
    ragForm.addEventListener('submit', handleRagSubmit);
  }
}

// Helper: Debouncer for search performance
let debounceTimeout;
function debounce(func, delay) {
  return function(...args) {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => func.apply(this, args), delay);
  };
}

// Tab switcher
function switchTab(tabId) {
  state.activeTab = tabId;
  
  // Update buttons state
  document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.getAttribute('data-tab') === tabId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Update panels state
  document.querySelectorAll('.tab-content').forEach(content => {
    if (content.id === tabId) {
      content.classList.add('active');
      content.style.display = 'grid';
    } else {
      content.classList.remove('active');
      content.style.display = 'none';
    }
  });

  // Auto-refresh when entering trading tab
  if (tabId === 'tab-trading') {
    fetchQuantData();
  } else if (tabId === 'tab-strategies') {
    fetchStrategyData();
  }
}

// ==========================================================================
// API Handlers (Fetch & Post)
// ==========================================================================

async function fetchConfig() {
  try {
    const response = await fetch('/api/config');
    const result = await response.json();
    if (result.success) {
      state.config = result.data;
      populateSettingsForm(result.data);
      
      // Update last sync time from persisted database state
      if (result.data.LAST_SYNC_TIME) {
        const syncDate = new Date(result.data.LAST_SYNC_TIME);
        const today = new Date();
        const isToday = syncDate.toDateString() === today.toDateString();
        document.getElementById('last-sync-time').innerText = isToday 
          ? syncDate.toLocaleTimeString('zh-CN') 
          : syncDate.toLocaleString('zh-CN', { hour12: false });
      } else {
        document.getElementById('last-sync-time').innerText = '尚未同步';
      }
    }
  } catch (error) {
    console.error('Error fetching config:', error);
  }
}

async function fetchMessages(search = '', append = false) {
  const container = document.getElementById('messages-list');
  const onlySpeakers = document.getElementById('chk-only-speakers')?.checked !== false;
  const sector = document.getElementById('filter-sector')?.value || '';
  const strategy = document.getElementById('filter-strategy')?.value || '';
  const startDate = document.getElementById('filter-start-date')?.value || '';
  const endDate = document.getElementById('filter-end-date')?.value || '';
  
  if (!append) {
    state.messagesOffset = 0;
  }
  
  try {
    let url = `/api/messages?onlySpeakers=${onlySpeakers}&limit=${state.messagesLimit}&offset=${state.messagesOffset}`;
    if (search) {
      url += `&search=${encodeURIComponent(search)}`;
    }
    if (sector) {
      url += `&sector=${encodeURIComponent(sector)}`;
    }
    if (strategy) {
      url += `&strategy=${encodeURIComponent(strategy)}`;
    }
    if (startDate) {
      url += `&startDate=${encodeURIComponent(startDate)}`;
    }
    if (endDate) {
      url += `&endDate=${encodeURIComponent(endDate)}`;
    }
    
    const response = await fetch(url);
    const result = await response.json();
    
    if (result.success) {
      state.totalMessages = result.total;
      if (append) {
        state.messages = state.messages.concat(result.data);
      } else {
        state.messages = result.data;
      }
      renderMessages(state.messages, state.totalMessages);
    } else {
      container.innerHTML = `<div class="empty-state"><span class="empty-state-icon">⚠️</span><p>加载数据失败: ${result.error}</p></div>`;
    }
  } catch (error) {
    console.error('Error fetching messages:', error);
    container.innerHTML = `<div class="empty-state"><span class="empty-state-icon">❌</span><p>网络请求错误，请稍后重试</p></div>`;
  }
}

async function fetchReports() {
  const container = document.getElementById('reports-list');
  const countBadge = document.getElementById('report-count');
  
  try {
    const response = await fetch('/api/reports');
    const result = await response.json();
    
    if (result.success) {
      state.reports = result.data;
      countBadge.innerText = `${result.total} 篇`;
      renderReports(result.data);
    } else {
      container.innerHTML = `<div class="empty-state"><span class="empty-state-icon">⚠️</span><p>加载报告失败: ${result.error}</p></div>`;
    }
  } catch (error) {
    console.error('Error fetching reports:', error);
    container.innerHTML = `<div class="empty-state"><span class="empty-state-icon">❌</span><p>网络请求错误，请稍后重试</p></div>`;
  }
}

// Fetch quantitative portfolio and history logs
async function fetchQuantData() {
  try {
    // 1. Fetch portfolio summary
    const portRes = await fetch('/api/quant/portfolio');
    const portResult = await portRes.json();
    if (portResult.success) {
      state.portfolio = portResult.data;
      renderPortfolio(portResult.data);
    }

    // 2. Fetch active positions
    const posRes = await fetch('/api/quant/positions');
    const posResult = await posRes.json();
    if (posResult.success) {
      state.positions = posResult.data;
      renderPositions(posResult.data);
    }

    // 3. Fetch order history logs
    const ordRes = await fetch('/api/quant/orders');
    const ordResult = await ordRes.json();
    if (ordResult.success) {
      state.orders = ordResult.data;
      renderOrders(ordResult.data);
    }
  } catch (error) {
    console.error('Error fetching quantitative trading data:', error);
  }
}

async function triggerSync() {
  const syncBtn = document.getElementById('btn-sync');
  const syncBtnText = document.getElementById('sync-btn-text');
  const syncIcon = document.getElementById('sync-icon');
  
  // Set loading state
  syncBtn.disabled = true;
  syncBtnText.innerText = '正在同步中...';
  syncIcon.classList.add('spin-animation');
  
  try {
    const response = await fetch('/api/sync', { method: 'POST' });
    const result = await response.json();
    
    if (result.success) {
      // Refresh views
      await fetchConfig();
      await fetchMessages();
      await fetchReports();
      await fetchQuantData(); // also refresh quant data
      
      const newMsgs = result.newSpeakerMessagesCount || 0;
      showNotification(newMsgs > 0 ? `同步成功！发现 ${newMsgs} 条新发言并已触发自动跟单或生成 AI 研报。` : '同步成功，但未发现群主新发言。', 'success');
    } else {
      showNotification(`同步失败: ${result.reason}`, 'error');
    }
  } catch (error) {
    console.error('Sync error:', error);
    showNotification('网络错误，无法触发同步任务。', 'error');
  } finally {
    // Reset state
    syncBtn.disabled = false;
    syncBtnText.innerText = '立即同步';
    syncIcon.classList.remove('spin-animation');
  }
}

async function saveSettings(e) {
  e.preventDefault();
  
  const statusMsg = document.getElementById('settings-status-msg');
  statusMsg.className = 'status-msg';
  statusMsg.innerText = '正在保存配置...';
  
  const payload = {
    PORT: document.getElementById('whop_chat_channel_id').value ? state.config.PORT : undefined,
    AI_PROVIDER: document.getElementById('ai_provider').value,
    WHOP_CHAT_CHANNEL_ID: document.getElementById('whop_chat_channel_id').value,
    WHOP_SIGNAL_CHANNEL_IDS: document.getElementById('whop_signal_channel_ids').value,
    TARGET_SPEAKER_USER_IDS: document.getElementById('target_speaker_user_ids').value,
    MONITOR_INTERVAL_MINUTES: document.getElementById('monitor_interval_minutes').value,
    OLLAMA_BASE_URL: document.getElementById('ollama_base_url').value,
    OLLAMA_MODEL: document.getElementById('ollama_model').value,
    LM_STUDIO_BASE_URL: document.getElementById('lm_studio_base_url').value,
    LM_STUDIO_MODEL: document.getElementById('lm_studio_model').value,
    MOCK_TRADING_MODE: document.getElementById('mock_trading_mode').value,
    AUTO_TRADING_LEVEL: document.getElementById('auto_trading_level').value,
    USE_DYNAMIC_SIZING: document.getElementById('use_dynamic_sizing').value,
    DEFAULT_POSITION_PCT: document.getElementById('default_position_pct').value,
    AUTO_SUBSTITUTE_LEVERAGED_ETFS: document.getElementById('auto_substitute_leveraged_etfs').value,
    LEVERAGED_ETF_MAPPING: document.getElementById('leveraged_etf_mapping').value,
    RISK_PER_TRADE_PCT: document.getElementById('risk_per_trade_pct').value,
    MAX_CONCENTRATION_PCT: document.getElementById('max_concentration_pct').value,
    CASH_BUFFER_PCT: document.getElementById('cash_buffer_pct').value
  };

  // Only send secrets if they have been explicitly filled
  const token = document.getElementById('whop_user_token').value.trim();
  if (token) payload.WHOP_USER_TOKEN = token;

  const geminiKey = document.getElementById('gemini_api_key').value.trim();
  if (geminiKey) payload.GEMINI_API_KEY = geminiKey;

  const wechatUrl = document.getElementById('wechat_work_webhook_url').value.trim();
  if (wechatUrl) payload.WECHAT_WORK_WEBHOOK_URL = wechatUrl;

  const whopSecret = document.getElementById('whop_webhook_secret').value.trim();
  if (whopSecret) payload.WHOP_WEBHOOK_SECRET = whopSecret;

  try {
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    if (result.success) {
      statusMsg.className = 'status-msg success';
      statusMsg.innerText = '配置保存成功！系统已应用最新指标。';
      
      // Update local state and close modal
      await fetchConfig();
      setTimeout(() => {
        closeSettingsModal();
        statusMsg.innerText = '';
        fetchQuantData(); // Refresh UI to match trading mode
      }, 1500);
    } else {
      statusMsg.className = 'status-msg error';
      statusMsg.innerText = `配置保存失败: ${result.error}`;
    }
  } catch (error) {
    statusMsg.className = 'status-msg error';
    statusMsg.innerText = '保存失败，请检查后端网络连接。';
  }
}

// Handle manual test order submission
async function handleManualTrade(e) {
  e.preventDefault();
  
  const payload = {
    ticker: document.getElementById('trade_ticker').value.trim(),
    action: document.getElementById('trade_action').value,
    price: parseFloat(document.getElementById('trade_price').value),
    quantity: parseInt(document.getElementById('trade_qty').value, 10),
    stopLoss: document.getElementById('trade_sl').value ? parseFloat(document.getElementById('trade_sl').value) : null,
    reason: 'Web 控制台手动下单测试'
  };

  try {
    const response = await fetch('/api/quant/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (result.success) {
      showNotification(`下单成功！状态: ${result.mode === 'SANDBOX' ? '模拟已成交' : '已提交实盘柜台'}`, 'success');
      // Reset form input
      document.getElementById('trade_ticker').value = '';
      document.getElementById('trade_price').value = '';
      document.getElementById('trade_qty').value = '';
      document.getElementById('trade_sl').value = '';
      // Refresh trading data
      fetchQuantData();
    } else {
      showNotification(`下单失败: ${result.reason}`, 'error');
      fetchQuantData(); // refresh to show rejected log
    }
  } catch (error) {
    showNotification('网络错误，下单请求失败。', 'error');
  }
}

// Reset sandbox portfolio
async function handleResetPortfolio() {
  if (!confirm('您确定要重置虚拟账户吗？这将抹去所有沙盒持仓与订单记录，恢复至 100,000 美元初始资金！')) {
    return;
  }

  try {
    const response = await fetch('/api/quant/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 100000.00 })
    });
    const result = await response.json();
    if (result.success) {
      showNotification(result.message, 'success');
      fetchQuantData();
    }
  } catch (error) {
    showNotification('账户重置请求失败。', 'error');
  }
}

// ==========================================================================
// Rendering Elements & Helper UI Functions
// ==========================================================================

function renderMessages(messages, total) {
  const container = document.getElementById('messages-list');
  
  if (messages.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">💬</div>
        <p>${state.searchQuery ? '未找到符合搜索条件的历史发言' : '暂无群主历史发言存盘记录'}</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  messages.forEach((msg) => {
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    
    const dateStr = new Date(msg.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    
    let text = msg.content || '';
    const images = [];
    
    // 1. Extract and remove all [IMAGE:url] patterns
    text = text.replace(/\[IMAGE:(https?:\/\/[^\]]+)\]/g, (match, url) => {
      images.push(url);
      return `__IMAGE_PLACEHOLDER_${images.length - 1}__`;
    });

    // 2. Escape HTML entities
    let html = text
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;");

    // 3. Highlight tickers
    html = html.replace(/(\b[A-Z]{2,5}\b|\$[a-zA-Z]{2,5})/g, '<span class="ticker-highlight">$1</span>');

    // 4. Re-insert images as HTML tags
    images.forEach((url, index) => {
      const imgHtml = `<div class="message-image-container"><img class="message-image" src="${url}" alt="图片" onclick="window.open('${url}', '_blank')"></div>`;
      html = html.replace(`__IMAGE_PLACEHOLDER_${index}__`, imgHtml);
    });

    // Check if VIP/Main 대V speaker (xiaozhaolucky or user ID)
    const isVip = msg.sender_name === 'xiaozhaolucky' || msg.sender_id === 'user_4yeplXgbguTu4';
    const senderBadge = isVip 
      ? `<span class="sender-name vip-sender">⭐ ${msg.sender_name} <span class="vip-badge">大V</span></span>` 
      : `<span class="sender-name">👤 ${msg.sender_name}</span>`;

    // Process strategy & sector tags for footer display
    const sectors = msg.sectors ? msg.sectors.split(',').filter(Boolean) : [];
    const strategies = msg.strategies ? msg.strategies.split(',').filter(Boolean) : [];
    
    const contextBtnHtml = `<button class="btn-msg-context" onclick="event.stopPropagation(); showMessageContext('${msg.id}')">🔍 附近消息</button>`;

    let footerHtml = '';
    if (sectors.length > 0 || strategies.length > 0 || true) {
      footerHtml += '<div class="message-card-footer">';
      if (sectors.length > 0 || strategies.length > 0) {
        footerHtml += '<div class="message-tags">';
        sectors.forEach(s => {
          footerHtml += `<span class="msg-meta-badge sector-badge">📁 ${s}</span>`;
        });
        strategies.forEach(s => {
          footerHtml += `<span class="msg-meta-badge strategy-badge">⚡ ${s}</span>`;
        });
        footerHtml += '</div>';
      }
      footerHtml += contextBtnHtml;
      footerHtml += '</div>';
    }

    bubble.innerHTML = `
      <div class="message-bubble-header">
        ${senderBadge}
        ${msg.channel_name ? `<span class="channel-tag">${msg.channel_name}</span>` : ''}
        <span class="message-time">${dateStr}</span>
      </div>
      <div class="message-text">${html}</div>
      ${footerHtml}
    `;
    container.appendChild(bubble);
  });

  // Append Load More button if we have more messages to load
  if (messages.length < total) {
    const loadMoreContainer = document.createElement('div');
    loadMoreContainer.className = 'load-more-container';

    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary btn-load-more';
    btn.innerText = '加载更多发言';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.innerText = '正在加载...';
      state.messagesOffset += state.messagesLimit;
      fetchMessages(state.searchQuery, true);
    });

    loadMoreContainer.appendChild(btn);
    container.appendChild(loadMoreContainer);
  }
}

function renderReports(reports) {
  const container = document.getElementById('reports-list');
  
  if (reports.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📊</div>
        <p>暂无 AI 研报，请点击右上方“立即同步”生成第一篇报告</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  reports.forEach((rep) => {
    const card = document.createElement('div');
    card.className = 'report-card';
    card.addEventListener('click', () => openReportDetailModal(rep));
    
    const dateStr = new Date(rep.created_at).toLocaleString('zh-CN');
    
    const textPreview = rep.summary_content
      .replace(/[#\*`_\-\[\]\(\)]/g, ' ')
      .trim();

    card.innerHTML = `
      <div class="report-card-header">
        <h3 class="report-card-title">🤖 智能投资策略研报</h3>
        <span class="report-card-date">${dateStr}</span>
      </div>
      <div class="report-card-meta">
        <span class="meta-tag model">🤖 ${rep.ai_model}</span>
        <span class="meta-tag">📝 ${rep.raw_messages_count} 条发言分析</span>
      </div>
      <div class="report-card-snippet">${textPreview}</div>
    `;
    container.appendChild(card);
  });
}

// Render portfolio assets
function renderPortfolio(p) {
  document.getElementById('equity-value').innerText = `$${p.total_equity.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('cash-value').innerText = `$${p.cash.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('positions-value').innerText = `$${p.positions_value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  
  const pnlEl = document.getElementById('pnl-value');
  pnlEl.innerText = `${p.unrealized_pnl >= 0 ? '+' : ''}$${p.unrealized_pnl.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  
  if (p.unrealized_pnl > 0) {
    pnlEl.className = 'value positive';
  } else if (p.unrealized_pnl < 0) {
    pnlEl.className = 'value negative';
  } else {
    pnlEl.className = 'value number';
  }

  // Update trading mode badge
  const modeBadge = document.getElementById('trade-mode-badge');
  const isMock = state.config.MOCK_TRADING_MODE === 'true';
  modeBadge.innerText = isMock ? '沙盒模拟模式' : '实盘交易激活 (长桥/盈立)';
  if (isMock) {
    modeBadge.className = 'trading-mode-indicator';
  } else {
    modeBadge.className = 'trading-mode-indicator live';
  }
}

// Render positions list
function renderPositions(positions) {
  const tbody = document.getElementById('positions-table-body');
  
  if (positions.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="table-empty">暂无持仓记录 (AI 尚未触发买入或模拟账户已清空)</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = '';
  positions.forEach(pos => {
    const tr = document.createElement('tr');
    
    const pnlClass = pos.unrealized_pnl > 0 ? 'positive' : (pos.unrealized_pnl < 0 ? 'negative' : '');
    const pnlSign = pos.unrealized_pnl > 0 ? '+' : '';

    tr.innerHTML = `
      <td><strong>${pos.ticker}</strong></td>
      <td>${pos.quantity}</td>
      <td>$${pos.average_entry_price.toFixed(2)}</td>
      <td>$${pos.current_price.toFixed(2)}</td>
      <td>$${pos.market_value.toFixed(2)}</td>
      <td class="${pnlClass}"><strong>${pnlSign}$${pos.unrealized_pnl.toFixed(2)}</strong></td>
    `;
    tbody.appendChild(tr);
  });
}

// Render trading orders history log
function renderOrders(orders) {
  const tbody = document.getElementById('orders-table-body');
  
  if (orders.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="table-empty">暂无跟单订单日志记录</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = '';
  orders.forEach(ord => {
    const tr = document.createElement('tr');
    const timeStr = new Date(ord.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    
    // Status Badge classes
    let statusClass = 'pending';
    let statusZh = '排队中';
    if (ord.status === 'FILLED') {
      statusClass = 'filled';
      statusZh = '已成交';
    } else if (ord.status === 'REJECTED') {
      statusClass = 'rejected';
      statusZh = '已拦截';
    }

    tr.innerHTML = `
      <td style="color: var(--color-text-muted); font-size: 0.75rem;">${timeStr}</td>
      <td><strong>${ord.ticker}</strong></td>
      <td><span style="color: ${ord.action === 'BUY' ? 'var(--accent-green)' : 'var(--accent-red)'}; font-weight: 700;">${ord.action === 'BUY' ? '买入' : '卖出'}</span></td>
      <td>$${ord.price.toFixed(2)}</td>
      <td>${ord.quantity}</td>
      <td><span class="status-badge ${statusClass}">${statusZh}</span></td>
      <td style="font-size: 0.75rem; color: ${ord.status === 'REJECTED' ? 'var(--accent-red)' : 'var(--color-text-secondary)'};">${ord.reason || '-'}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ==========================================================================
// Modal Operations
// ==========================================================================

function openSettingsModal() {
  document.getElementById('settings-modal').style.display = 'flex';
}

function closeSettingsModal() {
  document.getElementById('settings-modal').style.display = 'none';
  document.getElementById('settings-status-msg').innerText = '';
}

function toggleAIFields() {
  const provider = document.getElementById('ai_provider').value;
  const geminiFields = document.getElementById('gemini-fields');
  const ollamaFields = document.getElementById('ollama-fields');
  const lmStudioFields = document.getElementById('lm-studio-fields');
  
  if (provider === 'gemini') {
    geminiFields.style.display = 'block';
    ollamaFields.style.display = 'none';
    lmStudioFields.style.display = 'none';
  } else if (provider === 'ollama') {
    geminiFields.style.display = 'none';
    ollamaFields.style.display = 'grid';
    lmStudioFields.style.display = 'none';
  } else if (provider === 'lm-studio') {
    geminiFields.style.display = 'none';
    ollamaFields.style.display = 'none';
    lmStudioFields.style.display = 'grid';
  }
}

function populateSettingsForm(config) {
  document.getElementById('ai_provider').value = config.AI_PROVIDER || 'gemini';
  document.getElementById('whop_chat_channel_id').value = config.WHOP_CHAT_CHANNEL_ID || '';
  document.getElementById('whop_signal_channel_ids').value = config.WHOP_SIGNAL_CHANNEL_IDS || '';
  document.getElementById('target_speaker_user_ids').value = config.TARGET_SPEAKER_USER_IDS || '';
  document.getElementById('monitor_interval_minutes').value = config.MONITOR_INTERVAL_MINUTES || '15';
  document.getElementById('ollama_base_url').value = config.OLLAMA_BASE_URL || 'http://localhost:11434';
  document.getElementById('ollama_model').value = config.OLLAMA_MODEL || 'deepseek-r1';
  document.getElementById('lm_studio_base_url').value = config.LM_STUDIO_BASE_URL || 'http://localhost:1234';
  document.getElementById('lm_studio_model').value = config.LM_STUDIO_MODEL || 'qwen3.5-35b-a3b';
  
  // Set risk controls
  document.getElementById('mock_trading_mode').value = config.MOCK_TRADING_MODE || 'true';
  document.getElementById('auto_trading_level').value = config.AUTO_TRADING_LEVEL || 'strict';
  document.getElementById('use_dynamic_sizing').value = config.USE_DYNAMIC_SIZING || 'true';
  document.getElementById('default_position_pct').value = config.DEFAULT_POSITION_PCT || '0.10';
  document.getElementById('auto_substitute_leveraged_etfs').value = config.AUTO_SUBSTITUTE_LEVERAGED_ETFS || 'false';
  document.getElementById('leveraged_etf_mapping').value = config.LEVERAGED_ETF_MAPPING || 'NVDA:NVDL,TSLA:TSLL,LITE:LITX';
  document.getElementById('risk_per_trade_pct').value = config.RISK_PER_TRADE_PCT || '0.01';
  document.getElementById('max_concentration_pct').value = config.MAX_CONCENTRATION_PCT || '0.20';
  document.getElementById('cash_buffer_pct').value = config.CASH_BUFFER_PCT || '0.15';

  // Set placeholders for masked secrets
  document.getElementById('whop_user_token').placeholder = config.WHOP_USER_TOKEN_MASKED ? '已保存加密 Token (输入新 Token 以更新)' : '未配置';
  document.getElementById('gemini_api_key').placeholder = config.GEMINI_API_KEY_MASKED ? '已保存 API 密钥 (输入新 Key 以更新)' : '未配置';
  document.getElementById('wechat_work_webhook_url').placeholder = config.WECHAT_WORK_WEBHOOK_URL_MASKED ? '已保存 Webhook 地址 (输入新地址以更新)' : '未配置';
  document.getElementById('whop_webhook_secret').placeholder = config.WHOP_WEBHOOK_SECRET_MASKED ? '已保存签名密钥 (输入新 Secret 以更新)' : '未配置';
  
  toggleAIFields();
}

// Current open report details
let activeReport = null;

function openReportDetailModal(report) {
  activeReport = report;
  const modal = document.getElementById('report-modal');
  const content = document.getElementById('report-modal-content');
  const meta = document.getElementById('report-modal-meta');
  
  const createdDate = new Date(report.created_at).toLocaleString('zh-CN');
  
  content.innerHTML = renderMarkdownToHtml(report.summary_content);
  
  meta.innerHTML = `
    <span>模型: <strong>${report.ai_model}</strong></span> | 
    <span>归档消息数: <strong>${report.raw_messages_count} 条</strong></span> | 
    <span>生成时间: <strong>${createdDate}</strong></span>
  `;
  
  modal.style.display = 'flex';
}

function closeReportModal() {
  document.getElementById('report-modal').style.display = 'none';
  activeReport = null;
}

function closeContextModal() {
  document.getElementById('context-modal').style.display = 'none';
}

function copyReportToClipboard() {
  if (!activeReport) return;
  
  navigator.clipboard.writeText(activeReport.summary_content).then(() => {
    showNotification('报告已成功复制到剪贴板！', 'success');
  }).catch((err) => {
    console.error('Failed to copy text:', err);
    showNotification('复制失败，请手动选择复制。', 'error');
  });
}

// ==========================================================================
// Custom Markdown to HTML Parser
// ==========================================================================
function renderMarkdownToHtml(md) {
  if (!md) return '';
  
  let html = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Bold (**text**)
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Inline Code (`code`)
  html = html.replace(/`(.*?)`/g, '<code>$1</code>');
  
  // Headings (### h3, ## h2, # h1)
  html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');
  
  // Blockquotes (> text)
  html = html.replace(/^&gt; (.*?)$/gm, '<blockquote>$1</blockquote>');
  
  // Horizontal Rules (---)
  html = html.replace(/^---$/gm, '<hr>');
  
  // Unordered list items (- item)
  html = html.replace(/^\s*-\s+(.*?)$/gm, '<li>$1</li>');
  
  // Group <li> elements together into <ul> lists
  html = html.replace(/(<li>.*?<\/li>)/gs, '<ul>$1</ul>');
  
  // Remove empty lists if any
  html = html.replace(/<\/ul>\s*<ul>/g, '');

  // Line breaks
  html = html.split('\n\n').map(p => {
    if (p.trim().startsWith('<h') || p.trim().startsWith('<ul') || p.trim().startsWith('<hr') || p.trim().startsWith('<blockquote')) {
      return p;
    }
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('');

  return html;
}

// ==========================================================================
// Custom Notification Alert banner
// ==========================================================================
function showNotification(text, type = 'success') {
  const alertBox = document.createElement('div');
  alertBox.className = `alert-banner ${type}`;
  alertBox.innerText = text;
  
  alertBox.style.position = 'fixed';
  alertBox.style.top = '24px';
  alertBox.style.left = '50%';
  alertBox.style.transform = 'translateX(-50%)';
  alertBox.style.padding = '12px 24px';
  alertBox.style.borderRadius = '12px';
  alertBox.style.backdropFilter = 'blur(10px)';
  alertBox.style.border = '1px solid';
  alertBox.style.zIndex = '999';
  alertBox.style.fontFamily = 'var(--font-sans)';
  alertBox.style.fontWeight = '600';
  alertBox.style.fontSize = '0.9rem';
  alertBox.style.boxShadow = '0 10px 25px rgba(0,0,0,0.3)';
  alertBox.style.transition = 'all 0.3s ease';
  
  if (type === 'success') {
    alertBox.style.backgroundColor = 'rgba(16, 185, 129, 0.9)';
    alertBox.style.borderColor = 'rgba(16, 185, 129, 0.3)';
    alertBox.style.color = '#fff';
  } else {
    alertBox.style.backgroundColor = 'rgba(239, 68, 68, 0.9)';
    alertBox.style.borderColor = 'rgba(239, 68, 68, 0.3)';
    alertBox.style.color = '#fff';
  }
  
  document.body.appendChild(alertBox);
  
  setTimeout(() => {
    alertBox.style.opacity = '0';
    alertBox.style.transform = 'translateX(-50%) translateY(-10px)';
    setTimeout(() => alertBox.remove(), 300);
  }, 4000);
}

// CSS Animation helpers
const style = document.createElement('style');
style.innerHTML = `
  .spin-animation {
    animation: rotate-sync 1.5s linear infinite;
  }
  @keyframes rotate-sync {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .alert-banner {
    animation: slideDownFade 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  @keyframes slideDownFade {
    from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
`;
document.head.appendChild(style);
// Generate customized AI report from currently filtered messages
async function triggerAIReview() {
  const reviewBtn = document.getElementById('btn-ai-review');
  
  if (state.messages.length === 0) {
    showNotification('当前过滤条件下无消息，无法进行 AI 复盘总结。', 'error');
    return;
  }
  
  reviewBtn.disabled = true;
  const originalHtml = reviewBtn.innerHTML;
  reviewBtn.innerHTML = '<span class="btn-icon spin-animation">🤖</span><span>正在分析复盘...</span>';
  
  showNotification('AI 正在深度复盘该维度历史发言并生成学习总结报告，请稍候...', 'success');
  
  const payload = {
    search: state.searchQuery,
    onlySpeakers: document.getElementById('chk-only-speakers')?.checked !== false,
    sector: document.getElementById('filter-sector')?.value || '',
    strategy: document.getElementById('filter-strategy')?.value || '',
    startDate: document.getElementById('filter-start-date')?.value || '',
    endDate: document.getElementById('filter-end-date')?.value || ''
  };
  
  try {
    const response = await fetch('/api/reports/dimensional-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    if (result.success) {
      showNotification('AI 维度复盘总结报告生成成功！', 'success');
      
      // Refresh left reports archive list
      await fetchReports();
      
      // Open modal automatically
      openReportDetailModal({
        summary_content: result.summary_content,
        ai_model: result.ai_model,
        raw_messages_count: result.raw_messages_count,
        created_at: result.created_at
      });
    } else {
      showNotification(`复盘总结生成失败: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error('Error generating AI review:', error);
    showNotification('网络连接错误，无法触发复盘总结。', 'error');
  } finally {
    reviewBtn.disabled = false;
    reviewBtn.innerHTML = originalHtml;
  }
}

// ==========================================================================
// RAG Knowledge Base Q&A Interactions
// ==========================================================================

async function handleRagSubmit(e) {
  e.preventDefault();
  const inputEl = document.getElementById('rag-chat-input');
  const submitBtn = document.getElementById('btn-rag-submit');
  const chatMessages = document.getElementById('rag-chat-messages');
  const citationCountBadge = document.getElementById('citation-count-badge');
  
  const question = inputEl.value.trim();
  if (!question) return;
  
  inputEl.value = '';
  inputEl.disabled = true;
  submitBtn.disabled = true;
  
  appendRagMessage('user', question);
  
  const loadingMsg = appendRagMessage('assistant', '', true);
  
  chatMessages.scrollTop = chatMessages.scrollHeight;
  
  try {
    const response = await fetch('/api/rag/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question })
    });
    
    const result = await response.json();
    
    loadingMsg.remove();
    
    if (result.success) {
      const modeLabel = document.getElementById('rag-retrieval-mode-label');
      if (modeLabel && result.retrieval_mode) {
        modeLabel.innerText = `检索模式: ${result.retrieval_mode}`;
      }
      
      const formattedAnswer = formatAnswerWithCitations(result.answer);
      appendRagMessage('assistant', formattedAnswer);
      
      renderCitationsList(result.citations);
      
      if (citationCountBadge) {
        citationCountBadge.innerText = `${result.citations.length} 引用`;
      }
    } else {
      appendRagMessage('assistant', `<p style="color: var(--accent-red);">提问发生错误: ${result.error || '未知错误'}</p>`);
    }
  } catch (err) {
    if (loadingMsg) loadingMsg.remove();
    appendRagMessage('assistant', `<p style="color: var(--accent-red);">网络连接失败，无法与知识库建立连接。</p>`);
    console.error('RAG Query Error:', err);
  } finally {
    inputEl.disabled = false;
    submitBtn.disabled = false;
    inputEl.focus();
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

function appendRagMessage(role, htmlContent, isLoading = false) {
  const chatMessages = document.getElementById('rag-chat-messages');
  const msgDiv = document.createElement('div');
  msgDiv.className = `rag-message ${role}`;
  
  const bubble = document.createElement('div');
  bubble.className = 'rag-bubble';
  
  if (isLoading) {
    bubble.innerHTML = `
      <div class="rag-loading">
        <span></span>
        <span></span>
        <span></span>
      </div>
    `;
  } else {
    if (role === 'user') {
      bubble.innerText = htmlContent;
    } else {
      bubble.innerHTML = htmlContent;
    }
  }
  
  msgDiv.appendChild(bubble);
  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  
  return msgDiv;
}

function formatAnswerWithCitations(answer) {
  if (!answer) return '';
  let html = renderMarkdownToHtml(answer);
  
  // Match single citation brackets [1] and convert to clickable nodes
  html = html.replace(/\[(\d+)\]/g, (match, num) => {
    return `<span class="citation-ref-link" data-citation-id="${num}" onclick="scrollToCitation(${num})">${num}</span>`;
  });
  
  return html;
}

window.scrollToCitation = function(num) {
  const cards = document.querySelectorAll('.citation-card');
  cards.forEach(c => c.classList.remove('highlighted'));
  
  const card = document.getElementById(`citation-card-${num}`);
  if (card) {
    card.classList.add('highlighted');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    
    // Smooth flash animation class triggers border-flash in visual representation
    card.style.borderColor = '#fbbf24';
    card.style.boxShadow = '0 0 15px rgba(245, 158, 11, 0.4)';
    setTimeout(() => {
      card.style.borderColor = '';
      card.style.boxShadow = '';
    }, 2000);
  }
};

function renderCitationsList(citations) {
  const container = document.getElementById('rag-citations-list');
  if (!container) return;
  
  if (!citations || citations.length === 0) {
    container.innerHTML = `
      <div class="citations-empty-state">
        <div class="citations-placeholder-icon">📖</div>
        <p>本次回答中没有引用任何具体的历史发言记录。</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = '';
  citations.forEach(cit => {
    const card = document.createElement('div');
    card.className = 'citation-card';
    card.id = `citation-card-${cit.citationId}`;
    
    const dateStr = new Date(cit.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    
    card.innerHTML = `
      <div class="citation-card-header">
        <div>
          <span class="citation-index-badge">[${cit.citationId}]</span>
          <span class="citation-sender" style="color: #fbbf24; font-weight:700;">👤 ${cit.sender_name}</span>
        </div>
        <span class="citation-channel">${cit.channel_name || '讨论区'}</span>
      </div>
      <div class="citation-content">${escapeHtml(cit.content)}</div>
      <div class="citation-card-header" style="margin-top: 0.5rem; margin-bottom: 0;">
        <span class="citation-time">🕒 ${dateStr}</span>
      </div>
    `;
    
    card.addEventListener('click', () => {
      const cards = document.querySelectorAll('.citation-card');
      cards.forEach(c => c.classList.remove('highlighted'));
      card.classList.add('highlighted');
      
      const inlineLink = document.querySelector(`.citation-ref-link[data-citation-id="${cit.citationId}"]`);
      if (inlineLink) {
        inlineLink.scrollIntoView({ behavior: 'smooth', block: 'center' });
        inlineLink.style.transform = 'scale(1.3)';
        inlineLink.style.backgroundColor = '#d97706';
        inlineLink.style.color = '#fff';
        
        setTimeout(() => {
          inlineLink.style.transform = '';
          inlineLink.style.backgroundColor = '';
          inlineLink.style.color = '';
        }, 2000);
      }
    });
    
    container.appendChild(card);
  });
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Fetch and display message context
async function showMessageContext(messageId) {
  const container = document.getElementById('context-modal-content');
  container.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>正在获取上下文消息...</p>
    </div>
  `;
  document.getElementById('context-modal').style.display = 'flex';
  
  try {
    const response = await fetch(`/api/messages/${messageId}/context?limit=10`);
    const result = await response.json();
    
    if (result.success) {
      renderContextMessages(result.messages, result.targetId);
    } else {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-state-icon">⚠️</span>
          <p>加载上下文失败: ${result.error}</p>
        </div>
      `;
    }
  } catch (error) {
    console.error('Error fetching message context:', error);
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-state-icon">❌</span>
        <p>网络错误，获取上下文失败</p>
      </div>
    `;
  }
}

// Render context messages in modal
function renderContextMessages(messages, targetId) {
  const container = document.getElementById('context-modal-content');
  if (messages.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>暂无上下文消息</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = '';
  
  messages.forEach(msg => {
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble context-bubble';
    
    // Highlight target message
    if (msg.id === targetId) {
      bubble.classList.add('target-message-highlight');
    }
    
    const dateStr = new Date(msg.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    
    let text = msg.content || '';
    const images = [];
    text = text.replace(/\[IMAGE:(https?:\/\/[^\]]+)\]/g, (match, url) => {
      images.push(url);
      return `__IMAGE_PLACEHOLDER_${images.length - 1}__`;
    });
    
    let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html = html.replace(/(\b[A-Z]{2,5}\b|\$[a-zA-Z]{2,5})/g, '<span class="ticker-highlight">$1</span>');
    
    images.forEach((url, index) => {
      const imgHtml = `<div class="message-image-container"><img class="message-image" src="${url}" alt="图片" onclick="window.open('${url}', '_blank')"></div>`;
      html = html.replace(`__IMAGE_PLACEHOLDER_${index}__`, imgHtml);
    });
    
    const isVip = msg.sender_name === 'xiaozhaolucky' || msg.sender_id === 'user_4yeplXgbguTu4';
    const senderBadge = isVip 
      ? `<span class="sender-name vip-sender">⭐ ${msg.sender_name} <span class="vip-badge">大V</span></span>` 
      : `<span class="sender-name">👤 ${msg.sender_name}</span>`;
      
    const sectors = msg.sectors ? msg.sectors.split(',').filter(Boolean) : [];
    const strategies = msg.strategies ? msg.strategies.split(',').filter(Boolean) : [];
    
    let tagsHtml = '';
    if (sectors.length > 0 || strategies.length > 0) {
      tagsHtml += '<div class="message-tags-footer">';
      sectors.forEach(s => {
        tagsHtml += `<span class="msg-meta-badge sector-badge">📁 ${s}</span>`;
      });
      strategies.forEach(s => {
        tagsHtml += `<span class="msg-meta-badge strategy-badge">⚡ ${s}</span>`;
      });
      tagsHtml += '</div>';
    }
    
    bubble.innerHTML = `
      <div class="message-bubble-header">
        ${senderBadge}
        ${msg.channel_name ? `<span class="channel-tag">${msg.channel_name}</span>` : ''}
        <span class="message-time">${dateStr}</span>
      </div>
      <div class="message-text">${html}</div>
      ${tagsHtml}
    `;
    container.appendChild(bubble);
  });
  
  // Scroll target message into view
  setTimeout(() => {
    const highlighted = container.querySelector('.target-message-highlight');
    if (highlighted) {
      highlighted.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 150);
}

// ==========================================================================
// 战法策略看板渲染与 API 交互逻辑
// ==========================================================================

let currentStrategiesData = [];

// 获取所有策略的状态与发言统计数据
async function fetchStrategyData() {
  const grid = document.getElementById('strategies-card-grid');
  try {
    const res = await fetch('/api/strategies');
    const result = await res.json();
    if (result.success) {
      currentStrategiesData = result.data;
      renderStrategies(result.data);
    } else {
      grid.innerHTML = `<div class="empty-state"><span class="empty-state-icon">⚠️</span><p>加载战法数据失败: ${result.error}</p></div>`;
    }
  } catch (error) {
    console.error('Error fetching strategies:', error);
    grid.innerHTML = `<div class="empty-state"><span class="empty-state-icon">❌</span><p>网络请求错误，请稍后重试</p></div>`;
  }
}

// 动态渲染 7 大战法策略卡片
function renderStrategies(strategies) {
  const grid = document.getElementById('strategies-card-grid');
  const countBadge = document.getElementById('generated-strategies-count');
  if (!grid) return;

  grid.innerHTML = '';
  let generatedCount = 0;

  strategies.forEach(strat => {
    const card = document.createElement('div');
    card.className = 'strategy-card';
    
    const hasReport = !!strat.latestReport;
    if (hasReport) generatedCount++;

    const dateStr = hasReport 
      ? new Date(strat.latestReport.created_at).toLocaleString('zh-CN', { hour12: false }) 
      : '尚未分析';

    const statusBadge = hasReport
      ? `<span class="strat-badge badge-success">✓ 最新研报已生成</span>`
      : `<span class="strat-badge badge-amber">⚠ 尚未生成研报</span>`;

    const viewBtnDisabled = hasReport ? '' : 'disabled';

    card.innerHTML = `
      <div class="strategy-card-header">
        <div class="strategy-card-title-group">
          <span class="strategy-emoji">${getStrategyEmoji(strat.key)}</span>
          <div>
            <h3>${strat.name}</h3>
            <span class="strategy-subtext">专项战法策略</span>
          </div>
        </div>
      </div>
      <div class="strategy-card-body">
        <p class="strategy-desc">${strat.desc}</p>
        <div class="strategy-status-row">
          ${statusBadge}
        </div>
        <div class="strategy-metrics">
          <div class="metric-item">
            <span class="metric-label">归档发言基数</span>
            <span class="metric-value number">${strat.messageCount} 条</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">上次生成时间</span>
            <span class="metric-value date">${dateStr}</span>
          </div>
        </div>
        ${hasReport ? `
        <div class="strategy-report-meta">
          <span>分析模型: <strong>${strat.latestReport.ai_model}</strong></span>
          <span>使用消息: <strong>${strat.latestReport.raw_messages_count} 条</strong></span>
        </div>
        ` : ''}
      </div>
      <div class="strategy-card-footer">
        <button class="btn btn-secondary btn-small" onclick="viewStrategyReport('${strat.key}')" ${viewBtnDisabled}>
          📖 查看专项研报
        </button>
        <button class="btn btn-primary btn-small btn-glow btn-update-strat" data-strategy="${strat.key}" onclick="updateStrategyAnalysis(this, '${strat.key}')">
          ⚡ AI 自动更新
        </button>
      </div>
    `;
    
    grid.appendChild(card);
  });

  if (countBadge) {
    countBadge.innerText = `${generatedCount} / ${strategies.length}`;
  }
}

// 战法图标映射助手
function getStrategyEmoji(key) {
  switch (key) {
    case '财报战法': return '📊';
    case '节日被动减': return '🎋';
    case '单调减': return '📉';
    case '尾盘强平': return '⏰';
    case '做T': return '🔄';
    case '弹性股防御': return '🛡️';
    case '规律总结': return '💡';
    default: return '⚡';
  }
}

// 查看指定策略研报
window.viewStrategyReport = function(strategyKey) {
  const strat = currentStrategiesData.find(s => s.key === strategyKey);
  if (strat && strat.latestReport) {
    openReportDetailModal({
      summary_content: strat.latestReport.summary_content,
      ai_model: strat.latestReport.ai_model,
      raw_messages_count: strat.latestReport.raw_messages_count,
      created_at: strat.latestReport.created_at
    });
  } else {
    showNotification('该战法尚未生成 AI 研报！请点击 AI 自动更新生成。', 'error');
  }
};

// 触发 AI 分析更新
window.updateStrategyAnalysis = async function(btn, strategyKey) {
  btn.disabled = true;
  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<span class="btn-spinner-inline animate-spin">🔄</span> 正在分析...';

  showNotification(`AI 正在深度分析【${strategyKey}】相关的历史发言并更新专项文档，这可能需要数十秒，请稍候...`, 'success');

  try {
    const response = await fetch('/api/strategies/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy: strategyKey })
    });
    
    const result = await response.json();
    if (result.success) {
      showNotification(`【${strategyKey}】战法专项 AI 研报更新成功！`, 'success');
      
      // 重新拉取状态
      await fetchStrategyData();
      
      // 自动弹窗展示详情
      openReportDetailModal({
        summary_content: result.summary_content,
        ai_model: result.ai_model,
        raw_messages_count: result.raw_messages_count,
        created_at: result.created_at
      });
    } else {
      showNotification(`更新失败: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error('Error updating strategy analysis:', error);
    showNotification('网络错误，无法更新 AI 研报。', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
};

