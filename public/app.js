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
  totalMessages: 0,
  csrfToken: null,
  sessionId: 'sess_' + Math.random().toString(36).substr(2, 12),
  selectedMember: '',
  selectedMemberId: '',
  selectedChannel: '',
  selectedChannelId: '',
  selectedMsgType: '',
  selectedReportCategory: 'all',
  cachedSpeakers: [],
  cachedChannels: []
};

// Fetch CSRF token for financial operations
async function ensureCsrfToken() {
  if (state.csrfToken) return state.csrfToken;
  try {
    const response = await fetch('/api/csrf-token', {
      headers: { 'X-Session-Id': state.sessionId }
    });
    const data = await response.json();
    if (data.success) {
      state.csrfToken = data.csrfToken;
      return state.csrfToken;
    }
  } catch (e) {
    console.error('Failed to fetch CSRF token:', e);
  }
  return null;
}

// Safe HTML attribute escape
function escapeAttr(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Validate URL is safe (https only)
function isSafeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

// ==========================================================================
// Initialization & Event Listeners
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  initApp();
  setupEventListeners();
  initLayoutResizer();
});

async function initApp() {
  try {
    await Promise.all([
      fetchSpeakers(),
      fetchChannels()
    ]);
  } catch (err) {
    console.error('Error fetching speakers or channels during initApp:', err);
  }
  
  // Fetch all data in parallel for faster initial load
  Promise.all([
    fetchConfig(),
    fetchMessages(),
    fetchReports(),
    fetchQuantData()
  ]).catch(err => console.error('Init error:', err));
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
  // Sync & Report buttons
  document.getElementById('btn-sync-realtime').addEventListener('click', triggerSyncRealtime);
  document.getElementById('btn-sync-archive').addEventListener('click', triggerSyncArchive);
  document.getElementById('btn-report-rolling').addEventListener('click', triggerReportRolling);
  document.getElementById('btn-report-kline').addEventListener('click', triggerReportKline);
  
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

  // Speaker mode dropdown filter change
  document.getElementById('filter-speaker')?.addEventListener('change', (e) => {
    if (e.target.value === 'speakers') {
      const memberInput = document.getElementById('filter-member-input');
      if (memberInput) memberInput.value = '';
      state.selectedMember = '';
      state.selectedMemberId = '';
      state.selectedMemberName = '';
      const clearMemberBtn = document.getElementById('btn-clear-member');
      if (clearMemberBtn) clearMemberBtn.style.display = 'none';
    }
    fetchMessages(state.searchQuery);
  });

  // Message type dropdown change
  document.getElementById('filter-msg-type')?.addEventListener('change', () => {
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

  // Report archive tab switching
  const reportTabs = document.querySelectorAll('.report-tab-btn');
  reportTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      reportTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.selectedReportCategory = tab.getAttribute('data-category');
      renderReports(state.reports);
    });
  });

  // News summaries console triggers
  document.querySelectorAll('.news-gen-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-type');
      triggerNewsGeneration(type);
    });
  });

  // Copy news markdown
  document.getElementById('btn-copy-news')?.addEventListener('click', copyNewsToClipboard);
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
      // Persona and Campaigns tab use flex layout, not grid
      content.style.display = (tabId === 'tab-persona' || tabId === 'tab-campaigns' || tabId === 'tab-news-summaries') ? 'flex' : 'grid';
    } else {
      content.classList.remove('active');
      content.style.display = 'none';
    }
  });

  // Auto-refresh when entering specific tabs
  if (tabId === 'tab-trading') {
    fetchQuantData();
  } else if (tabId === 'tab-strategies') {
    fetchStrategyData();
  } else if (tabId === 'tab-persona') {
    loadPersonaPlaybook();
  } else if (tabId === 'tab-campaigns') {
    fetchCampaigns();
  } else if (tabId === 'tab-news-summaries') {
    loadNewsSummaries();
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

async function fetchSpeakers() {
  try {
    const response = await fetch('/api/speakers');
    const result = await response.json();
    if (result.success && Array.isArray(result.speakers)) {
      state.cachedSpeakers = result.speakers;
      // Setup members autocomplete list
      setupAutocomplete('filter-member-input', 'member-suggestions', 'btn-clear-member', state.cachedSpeakers, 'sender_name', 'sender_id', (id, name) => {
        state.selectedMember = id;
        state.selectedMemberId = id;
        state.selectedMemberName = name;
        
        // If a specific member is selected, automatically switch speaker mode to 'all'
        const speakerSelect = document.getElementById('filter-speaker');
        if (speakerSelect && speakerSelect.value === 'speakers') {
          speakerSelect.value = 'all';
        }
        fetchMessages(state.searchQuery, false);
      }, () => {
        state.selectedMember = '';
        state.selectedMemberId = '';
        state.selectedMemberName = '';
        fetchMessages(state.searchQuery, false);
      });
    }
  } catch (error) {
    console.error('Error fetching speakers:', error);
  }
}

async function fetchChannels() {
  try {
    const response = await fetch('/api/channels');
    const result = await response.json();
    if (result.success && Array.isArray(result.data)) {
      state.cachedChannels = result.data;
      // Setup channels autocomplete list
      setupAutocomplete('filter-channel-input', 'channel-suggestions', 'btn-clear-channel', state.cachedChannels, 'channel_name', 'channel_id', (id, name) => {
        state.selectedChannel = id;
        state.selectedChannelId = id;
        state.selectedChannelName = name;
        fetchMessages(state.searchQuery, false);
      }, () => {
        state.selectedChannel = '';
        state.selectedChannelId = '';
        state.selectedChannelName = '';
        fetchMessages(state.searchQuery, false);
      });
    }
  } catch (error) {
    console.error('Error fetching channels:', error);
  }
}

function setupAutocomplete(inputId, suggestionsId, clearBtnId, dataList, displayProp, valueProp, onSelect, onClear) {
  const input = document.getElementById(inputId);
  const suggestions = document.getElementById(suggestionsId);
  const clearBtn = document.getElementById(clearBtnId);

  if (!input || !suggestions || !clearBtn) return;

  let activeIndex = -1;

  // Toggle clear button
  function toggleClearButton() {
    clearBtn.style.display = input.value ? 'block' : 'none';
  }

  // Filter and show suggestions
  function showSuggestions() {
    const query = input.value.trim().toLowerCase();
    
    // Filter list
    const filtered = dataList.filter(item => {
      const val = (item[displayProp] || '').toLowerCase();
      const valId = (item[valueProp] || '').toLowerCase();
      // Match display property or match value property
      return val.includes(query) || valId.includes(query);
    });

    if (filtered.length === 0) {
      suggestions.innerHTML = '<div class="suggestion-item" style="cursor: default; color: #888;">无匹配结果</div>';
      suggestions.style.display = 'block';
      return;
    }

    suggestions.innerHTML = '';
    filtered.forEach((item, index) => {
      const div = document.createElement('div');
      div.className = 'suggestion-item';
      div.innerText = item[displayProp] || item[valueProp];
      
      div.addEventListener('mousedown', (e) => {
        // Prevent input blur before click processes
        e.preventDefault();
      });

      div.addEventListener('click', () => {
        input.value = item[displayProp] || item[valueProp];
        suggestions.style.display = 'none';
        toggleClearButton();
        onSelect(item[valueProp], item[displayProp] || item[valueProp]);
      });
      
      suggestions.appendChild(div);
    });
    
    suggestions.style.display = 'block';
    activeIndex = -1;
  }

  input.addEventListener('input', () => {
    toggleClearButton();
    showSuggestions();
  });

  input.addEventListener('focus', () => {
    showSuggestions();
  });

  input.addEventListener('blur', () => {
    // Delay to let click event on suggestion item register
    setTimeout(() => {
      suggestions.style.display = 'none';
    }, 200);
  });

  // Handle keys (up/down/enter)
  input.addEventListener('keydown', (e) => {
    const items = suggestions.querySelectorAll('.suggestion-item');
    if (suggestions.style.display === 'none' || items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (activeIndex < items.length - 1) {
        if (activeIndex >= 0) items[activeIndex].classList.remove('selected');
        activeIndex++;
        items[activeIndex].classList.add('selected');
        items[activeIndex].scrollIntoView({ block: 'nearest' });
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (activeIndex > 0) {
        items[activeIndex].classList.remove('selected');
        activeIndex--;
        items[activeIndex].classList.add('selected');
        items[activeIndex].scrollIntoView({ block: 'nearest' });
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && items[activeIndex]) {
        items[activeIndex].click();
      }
    }
  });

  // Clear button click
  clearBtn.addEventListener('click', () => {
    input.value = '';
    suggestions.style.display = 'none';
    toggleClearButton();
    onClear();
  });
}


async function fetchMessages(search = '', append = false) {
  const container = document.getElementById('messages-list');
  const speakerMode = document.getElementById('filter-speaker')?.value || 'speakers';
  const sector = document.getElementById('filter-sector')?.value || '';
  const strategy = document.getElementById('filter-strategy')?.value || '';
  const startDate = document.getElementById('filter-start-date')?.value || '';
  const endDate = document.getElementById('filter-end-date')?.value || '';
  const msgType = document.getElementById('filter-msg-type')?.value || '';
  
  if (!append) {
    state.messagesOffset = 0;
  }
  
  try {
    let finalSpeakerMode = speakerMode;
    if (speakerMode === 'all' && state.selectedMember) {
      finalSpeakerMode = state.selectedMember;
    }

    let url = `/api/messages?speakerMode=${finalSpeakerMode}&limit=${state.messagesLimit}&offset=${state.messagesOffset}`;
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
    if (msgType) {
      url += `&msgType=${encodeURIComponent(msgType)}`;
    }
    if (state.selectedChannel) {
      url += `&channelId=${encodeURIComponent(state.selectedChannel)}`;
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

async function triggerSyncRealtime() {
  const syncBtn = document.getElementById('btn-sync-realtime');
  const syncBtnText = document.getElementById('sync-realtime-btn-text');
  const syncIcon = document.getElementById('sync-realtime-icon');
  
  syncBtn.disabled = true;
  syncBtnText.innerText = '同步跟单中...';
  syncIcon.classList.add('spin-animation');
  
  try {
    const csrfToken = await ensureCsrfToken();
    const response = await fetch('/api/sync/realtime', {
      method: 'POST',
      headers: {
        'X-CSRF-Token': csrfToken || '',
        'X-Session-Id': state.sessionId
      }
    });
    const result = await response.json();
    
    if (result.success) {
      await fetchConfig();
      await fetchMessages();
      await fetchReports();
      await fetchQuantData();
      
      const newMsgs = result.newSpeakerMessagesCount || 0;
      showNotification(newMsgs > 0 ? `同步成功！发现 ${newMsgs} 条新发言并已触发自动跟单或推送。` : '同步成功，但未发现实时新发言。', 'success');
    } else {
      showNotification(`实时同步失败: ${result.reason || result.error || '未知错误'}`, 'error');
    }
  } catch (error) {
    console.error('Realtime sync error:', error);
    showNotification('网络错误，无法触发实时同步跟单。', 'error');
  } finally {
    syncBtn.disabled = false;
    syncBtnText.innerText = '实时跟单同步';
    syncIcon.classList.remove('spin-animation');
  }
}

async function triggerSyncArchive() {
  const syncBtn = document.getElementById('btn-sync-archive');
  const syncBtnText = document.getElementById('sync-archive-btn-text');
  const syncIcon = document.getElementById('sync-archive-icon');
  
  if (!confirm('您确定要开始历史归档吗？这将回溯拉取大量历史数据，可能会消耗较长的时间。此操作只做数据录入和RAG向量化，绝不上单或推送通知。')) {
    return;
  }

  syncBtn.disabled = true;
  syncBtnText.innerText = '深度归档中...';
  syncIcon.classList.add('spin-animation');
  
  try {
    const csrfToken = await ensureCsrfToken();
    const response = await fetch('/api/sync/archive', {
      method: 'POST',
      headers: {
        'X-CSRF-Token': csrfToken || '',
        'X-Session-Id': state.sessionId
      }
    });
    const result = await response.json();
    
    if (result.success) {
      await fetchConfig();
      await fetchMessages();
      showNotification(`历史归档完成！成功抓取并导入了 ${result.newMessagesCount} 条历史消息归档，已启动后台向量化。`, 'success');
    } else {
      showNotification(`归档失败: ${result.reason || result.error || '未知错误'}`, 'error');
    }
  } catch (error) {
    console.error('Archive sync error:', error);
    showNotification('网络错误，无法触发历史归档任务。', 'error');
  } finally {
    syncBtn.disabled = false;
    syncBtnText.innerText = '历史数据归档';
    syncIcon.classList.remove('spin-animation');
  }
}

async function triggerReportRolling() {
  const btn = document.getElementById('btn-report-rolling');
  const originalText = btn.innerHTML;
  
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon spin-animation">🔄</span><span>分析中...</span>';
  
  try {
    const csrfToken = await ensureCsrfToken();
    const response = await fetch('/api/reports/global-rolling', {
      method: 'POST',
      headers: {
        'X-CSRF-Token': csrfToken || '',
        'X-Session-Id': state.sessionId
      }
    });
    const result = await response.json();
    
    if (result.success) {
      await fetchReports();
      if (result.updated) {
        showNotification('全局滚动投资简报更新成功，已发布并推送企业微信！', 'success');
      } else {
        showNotification('简报已是最新状态，无新发言需合并。', 'info');
      }
    } else {
      showNotification(`策略简报生成失败: ${result.reason || result.error || '未知错误'}`, 'error');
    }
  } catch (error) {
    console.error('Rolling report error:', error);
    showNotification('网络错误，无法生成全局滚动简报。', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

async function triggerReportKline() {
  const btn = document.getElementById('btn-report-kline');
  const originalText = btn.innerHTML;
  
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon spin-animation">🔄</span><span>诊断中...</span>';
  
  try {
    const csrfToken = await ensureCsrfToken();
    const response = await fetch('/api/reports/kline-combined', {
      method: 'POST',
      headers: {
        'X-CSRF-Token': csrfToken || '',
        'X-Session-Id': state.sessionId
      }
    });
    const result = await response.json();
    
    if (result.success) {
      await fetchReports();
      showNotification('K线走势与大V策略融合诊断研报生成成功！已推送到企业微信！', 'success');
    } else {
      showNotification(`融合分析生成失败: ${result.reason || result.error || '未知错误'}`, 'error');
    }
  } catch (error) {
    console.error('Kline report error:', error);
    showNotification('网络错误，无法生成K线走势融合研报。', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
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
    const csrfToken = await ensureCsrfToken();
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken || '',
        'X-Session-Id': state.sessionId
      },
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
    const csrfToken = await ensureCsrfToken();
    const response = await fetch('/api/quant/trade', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken || '',
        'X-Session-Id': state.sessionId
      },
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
      showNotification(`下单失败: ${result.reason || result.error || '未知错误'}`, 'error');
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
    const csrfToken = await ensureCsrfToken();
    const response = await fetch('/api/quant/reset', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken || '',
        'X-Session-Id': state.sessionId
      },
      body: JSON.stringify({ amount: 100000.00 })
    });
    const result = await response.json();
    if (result.success) {
      showNotification(result.message, 'success');
      fetchQuantData();
    } else {
      showNotification(`账户重置失败: ${result.reason || result.error || '未知错误'}`, 'error');
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

    // 4. Re-insert images as HTML tags (with proxy and URL sanitization)
    images.forEach((url, index) => {
      const safeUrl = isSafeUrl(url) ? escapeAttr(url) : '';
      const proxyUrl = safeUrl ? `/api/proxy-image?url=${encodeURIComponent(url)}` : '';
      const imgHtml = proxyUrl
        ? `<div class="message-image-container"><img class="message-image" src="${proxyUrl}" alt="图片" loading="lazy"></div>`
        : '';
      html = html.replace(`__IMAGE_PLACEHOLDER_${index}__`, imgHtml);
    });

    // Check if VIP/Main speaker using configured target speaker IDs
    const targetSpeakerIds = (state.config.TARGET_SPEAKER_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    const isVip = targetSpeakerIds.includes(msg.sender_id);
    const senderBadge = isVip
      ? `<span class="sender-name vip-sender">⭐ ${escapeHtml(msg.sender_name)} <span class="vip-badge">大V</span></span>`
      : `<span class="sender-name">👤 ${escapeHtml(msg.sender_name)}</span>`;

    // Process strategy & sector tags for footer display
    const sectors = msg.sectors ? msg.sectors.split(',').filter(Boolean) : [];
    const strategies = msg.strategies ? msg.strategies.split(',').filter(Boolean) : [];
    
    const contextBtnHtml = `<button class="btn-msg-context" onclick="event.stopPropagation(); showMessageContext('${escapeAttr(msg.id)}')">🔍 附近消息</button>`;

    let footerHtml = '';
    if (sectors.length > 0 || strategies.length > 0 || true) {
      footerHtml += '<div class="message-card-footer">';
      if (sectors.length > 0 || strategies.length > 0) {
        footerHtml += '<div class="message-tags">';
        sectors.forEach(s => {
          footerHtml += `<span class="msg-meta-badge sector-badge">📁 ${escapeHtml(s)}</span>`;
        });
        strategies.forEach(s => {
          footerHtml += `<span class="msg-meta-badge strategy-badge">⚡ ${escapeHtml(s)}</span>`;
        });
        footerHtml += '</div>';
      }
      footerHtml += contextBtnHtml;
      footerHtml += '</div>';
    }

    bubble.innerHTML = `
      <div class="message-bubble-header">
        ${senderBadge}
        ${msg.channel_name ? `<span class="channel-tag">${escapeHtml(msg.channel_name)}</span>` : ''}
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

function getReportTitle(rep) {
  if (rep.strategy === 'GLOBAL_ROLLING') {
    return '🌐 全局 AI 滚动策略研报';
  }
  if (rep.strategy === 'KLINE_COMBINED') {
    return '📊 K线走势与大V策略融合研报';
  }
  if (rep.strategy) {
    return `⚡ ${rep.strategy} 专项技术总结研报`;
  }
  
  // For real-time briefs (strategy is null/empty)
  // Check if it's a "no signals" daily briefing
  if (rep.summary_content.includes('未检测到具体交易信号') || rep.summary_content.includes('没有具体交易信号') || rep.summary_content.includes('未检测到任何相关的历史发言')) {
    return '📝 社区日常讨论与情绪归档';
  }
  
  // Extract bold tickers like **TSLA**, **NVDA**
  const tickerRegex = /\*\*([A-Z]{2,5})\*\*/g;
  const matches = [];
  let match;
  while ((match = tickerRegex.exec(rep.summary_content)) !== null) {
    if (!matches.includes(match[1])) {
      matches.push(match[1]);
    }
    if (matches.length >= 3) break;
  }
  
  if (matches.length > 0) {
    return `🤖 策略简报 (${matches.join('/')})`;
  }
  
  return '🤖 社区实时交易策略简报';
}

function renderReports(reports) {
  const container = document.getElementById('reports-list');
  const countBadge = document.getElementById('report-count');

  // Filter reports according to selected category
  const filteredReports = reports.filter(rep => {
    const cat = state.selectedReportCategory;
    if (cat === 'all') return true;
    if (cat === 'rolling') {
      return rep.strategy === 'GLOBAL_ROLLING' || rep.strategy === 'KLINE_COMBINED';
    }
    if (cat === 'strategy') {
      return rep.strategy && rep.strategy !== 'GLOBAL_ROLLING' && rep.strategy !== 'KLINE_COMBINED';
    }
    if (cat === 'briefing') {
      return !rep.strategy;
    }
    return true;
  });

  if (countBadge) {
    countBadge.innerText = `${filteredReports.length} 篇`;
  }
  
  if (filteredReports.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📊</div>
        <p>该分类下暂无研报数据</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  filteredReports.forEach((rep) => {
    const card = document.createElement('div');
    card.className = 'report-card';
    card.addEventListener('click', () => openReportDetailModal(rep));
    
    const dateStr = new Date(rep.created_at).toLocaleString('zh-CN');
    
    const textPreview = rep.summary_content
      .replace(/[#\*`_\-\[\]\(\)]/g, ' ')
      .trim();

    const title = getReportTitle(rep);

    card.innerHTML = `
      <div class="report-card-header">
        <h3 class="report-card-title">${title}</h3>
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
    speakerMode: document.getElementById('filter-speaker')?.value || 'speakers',
    sector: document.getElementById('filter-sector')?.value || '',
    strategy: document.getElementById('filter-strategy')?.value || '',
    startDate: document.getElementById('filter-start-date')?.value || '',
    endDate: document.getElementById('filter-end-date')?.value || ''
  };
  
  try {
    const csrfToken = await ensureCsrfToken();
    const response = await fetch('/api/reports/dimensional-summary', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken || '',
        'X-Session-Id': state.sessionId
      },
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
      showNotification(`复盘总结生成失败: ${result.reason || result.error || '未知错误'}`, 'error');
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
    const csrfToken = await ensureCsrfToken();
    const response = await fetch('/api/rag/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken || '',
        'X-Session-Id': state.sessionId
      },
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
      appendRagMessage('assistant', `<p style="color: var(--accent-red);">提问发生错误: ${result.error || result.reason || '未知错误'}</p>`);
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
      const safeUrl = isSafeUrl(url) ? escapeAttr(url) : '';
      const proxyUrl = safeUrl ? `/api/proxy-image?url=${encodeURIComponent(url)}` : '';
      const imgHtml = proxyUrl
        ? `<div class="message-image-container"><img class="message-image" src="${proxyUrl}" alt="图片" loading="lazy"></div>`
        : '';
      html = html.replace(`__IMAGE_PLACEHOLDER_${index}__`, imgHtml);
    });
    
    const targetSpeakerIds = (state.config.TARGET_SPEAKER_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    const isVip = targetSpeakerIds.includes(msg.sender_id);
    const senderBadge = isVip
      ? `<span class="sender-name vip-sender">⭐ ${escapeHtml(msg.sender_name)} <span class="vip-badge">大V</span></span>`
      : `<span class="sender-name">👤 ${escapeHtml(msg.sender_name)}</span>`;
      
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
    const csrfToken = await ensureCsrfToken();
    const response = await fetch('/api/strategies/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken || '',
        'X-Session-Id': state.sessionId
      },
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
      showNotification(`更新失败: ${result.error || result.reason || '未知错误'}`, 'error');
    }
  } catch (error) {
    console.error('Error updating strategy analysis:', error);
    showNotification('网络错误，无法更新 AI 研报。', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
};

// ==========================================================================
// 大V行为画像 (Persona Playbook) Feature
// ==========================================================================

// Button: Generate Persona click listener
document.getElementById('btn-generate-persona')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-generate-persona');
  const statusArea = document.getElementById('persona-progress-area');
  const statusText = document.getElementById('persona-status-text');
  const progressBar = document.getElementById('persona-progress-bar');
  const contentArea = document.getElementById('persona-content');
  const metaArea = document.getElementById('persona-meta');
  
  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = '生成中...';
  statusArea.style.display = 'block';
  statusText.textContent = '正在启动画像生成引擎...';
  progressBar.style.width = '0%';
  contentArea.style.display = 'none';
  metaArea.style.display = 'none';
  
  try {
    const csrfToken = await ensureCsrfToken();
    const provider = document.getElementById('ai-provider')?.value || document.getElementById('ai_provider')?.value || 'lm-studio';
    const res = await fetch('/api/persona/generate', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'X-Session-Id': state.sessionId, 
        'X-CSRF-Token': csrfToken || '' 
      },
      body: JSON.stringify({ provider, maxMonths: 6, forceRefresh: true })
    });
    const data = await res.json();
    if (data.success) {
      pollPersonaStatus();
    } else {
      statusText.textContent = '启动失败: ' + (data.reason || data.error || '未知错误');
      btn.disabled = false;
      btn.querySelector('.btn-text').textContent = '生成画像';
    }
  } catch (err) {
    statusText.textContent = '请求错误: ' + err.message;
    btn.disabled = false;
    btn.querySelector('.btn-text').textContent = '生成画像';
  }
});

let personaPollingTimer = null;

async function pollPersonaStatus() {
  const statusText = document.getElementById('persona-status-text');
  const progressBar = document.getElementById('persona-progress-bar');
  const btn = document.getElementById('btn-generate-persona');
  
  try {
    const res = await fetch('/api/persona/status');
    const data = await res.json();
    
    if (data.status === 'running') {
      statusText.textContent = data.progress || '处理中...';
      progressBar.style.width = (data.percent || 0) + '%';
      personaPollingTimer = setTimeout(pollPersonaStatus, 3000);
    } else if (data.status === 'done') {
      statusText.textContent = '✅ 画像生成完成！';
      progressBar.style.width = '100%';
      btn.disabled = false;
      btn.querySelector('.btn-text').textContent = '重新生成';
      setTimeout(loadPersonaPlaybook, 1000);
    } else if (data.status === 'error') {
      btn.disabled = false;
      btn.querySelector('.btn-text').textContent = '重新生成';
      statusText.textContent = '❌ ' + (data.error || '生成失败');
    } else {
      btn.disabled = false;
      btn.querySelector('.btn-text').textContent = '生成画像';
    }
  } catch (err) {
    statusText.textContent = '状态查询失败: ' + err.message;
    personaPollingTimer = setTimeout(pollPersonaStatus, 5000);
  }
}

async function loadPersonaPlaybook() {
  const contentArea = document.getElementById('persona-content');
  const metaArea = document.getElementById('persona-meta');
  const progressArea = document.getElementById('persona-progress-area');
  const btn = document.getElementById('btn-generate-persona');
  const statusText = document.getElementById('persona-status-text');
  const progressBar = document.getElementById('persona-progress-bar');
  
  try {
    // 1. 先查询后台当前的运行状态，看是否已经在构建中
    const statusRes = await fetch('/api/persona/status');
    const statusData = await statusRes.json();
    
    if (statusData.status === 'running') {
      // 正在后台运行，显示进度条，并开启轮询
      progressArea.style.display = 'block';
      contentArea.style.display = 'none';
      metaArea.style.display = 'none';
      btn.disabled = true;
      btn.querySelector('.btn-text').textContent = '生成中...';
      
      statusText.textContent = statusData.progress || '处理中...';
      progressBar.style.width = (statusData.percent || 0) + '%';
      
      if (personaPollingTimer) clearTimeout(personaPollingTimer);
      personaPollingTimer = setTimeout(pollPersonaStatus, 3000);
      return;
    } else if (statusData.status === 'error') {
      statusText.textContent = '❌ 上次生成失败: ' + (statusData.error || '未知错误');
      progressBar.style.width = '0%';
    }

    // 2. 没有正在运行的任务，拉取最新生成的白皮书
    const res = await fetch('/api/persona/latest');
    const data = await res.json();
    
    if (data.success && data.playbook) {
      const pb = data.playbook;
      const genTime = new Date(pb.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
      const startTime = new Date(pb.start_time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
      const endTime = new Date(pb.end_time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
      
      metaArea.innerHTML = `
        <div class="persona-meta-grid">
          <div class="meta-item"><span class="meta-label">📅 生成时间</span><span class="meta-value">${genTime}</span></div>
          <div class="meta-item"><span class="meta-label">📊 分析发言数</span><span class="meta-value">${pb.raw_messages_count} 条</span></div>
          <div class="meta-item"><span class="meta-label">📆 覆盖范围</span><span class="meta-value">${startTime} ~ ${endTime}</span></div>
          <div class="meta-item"><span class="meta-label">🤖 AI 模型</span><span class="meta-value">${pb.ai_model}</span></div>
        </div>
      `;
      metaArea.style.display = 'block';
      contentArea.innerHTML = renderSimpleMarkdown(pb.summary_content);
      contentArea.style.display = 'block';
      progressArea.style.display = 'none';
      btn.disabled = false;
      btn.querySelector('.btn-text').textContent = '重新生成';
    } else {
      contentArea.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">🧠</span>
          <p>尚未生成画像白皮书</p>
          <p class="empty-hint">点击上方「生成画像」按钮开始分析大V历史行为模式</p>
        </div>
      `;
      contentArea.style.display = 'block';
      metaArea.style.display = 'none';
      progressArea.style.display = 'none';
      btn.disabled = false;
      btn.querySelector('.btn-text').textContent = '生成画像';
    }
  } catch (err) {
    contentArea.innerHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span><p>加载失败: ${err.message}</p></div>`;
    contentArea.style.display = 'block';
    btn.disabled = false;
  }
}

function renderSimpleMarkdown(md) {
  if (!md) return '';
  
  // Escape HTML helper
  const escapeHTML = (str) => str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  
  let html = escapeHTML(md);
  
  // Clean thinking tags
  html = html.replace(/&lt;think&gt;[\s\S]*?&lt;\/think&gt;/g, '');
  
  // Convert markdown to HTML
  html = html
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Horizontal rules
    .replace(/^---$/gm, '<hr>')
    // Bullet lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Number lists
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Newlines (paragraphs)
    .replace(/\r?\n\r?\n/g, '</p><p>')
    .replace(/\r?\n/g, '<br>');
    
  // Wrap list items in <ul>
  html = html.replace(/(<li>[\s\S]+?<\/li>)/g, '<ul>$1</ul>');
  // De-nest multiple adjacent <ul> tags
  html = html.replace(/<\/ul>\s*<ul>/g, '');
  
  return `<div class="markdown-body"><p>${html}</p></div>`;
}

// ==========================================================================
// Campaigns Tab Handlers (交易战役时间线)
// ==========================================================================

async function fetchCampaigns() {
  const listContainer = document.getElementById('campaigns-list-container');
  const activeCountEl = document.getElementById('active-campaigns-count');
  const closedCountEl = document.getElementById('closed-campaigns-count');
  
  if (!listContainer) return;
  
  listContainer.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>正在加载战役列表...</p>
    </div>
  `;
  
  try {
    // 1. 获取所有战役
    const res = await fetch('/api/campaigns');
    const data = await res.json();
    
    if (!data.success) {
      listContainer.innerHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span><p>加载失败: ${data.error || '未知错误'}</p></div>`;
      return;
    }
    
    // 2. 同时获取所有宏观事件，用于在时间线上做自动关联对齐
    const macroRes = await fetch('/api/macro-events');
    const macroData = await macroRes.json();
    if (macroData.success) {
      state.macroEvents = macroData.events;
    } else {
      state.macroEvents = [];
    }
    
    const campaigns = data.campaigns || [];
    
    // 3. 更新统计指标
    const activeCount = campaigns.filter(c => c.status === 'active').length;
    const closedCount = campaigns.filter(c => c.status === 'closed').length;
    if (activeCountEl) activeCountEl.textContent = activeCount;
    if (closedCountEl) closedCountEl.textContent = closedCount;
    
    if (campaigns.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">📊</span>
          <p>尚未建立任何交易战役</p>
          <p class="empty-hint">当大V发布新交易观点后，系统将自动识别并开启个股交易战役</p>
        </div>
      `;
      return;
    }
    
    // 4. 将个股战役按时间相近的宏观事件（5天内）或操盘月份，进行两级分组：事件 (战役) -> 标的A/B/C
    const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
    const groups = {}; // key -> { title, dateStr, timestamp, campaigns: [] }
    
    campaigns.forEach(c => {
      let closestEv = null;
      let minDiff = Infinity;
      
      // 匹配最近的宏观经济事件
      (state.macroEvents || []).forEach(ev => {
        const diff = Math.abs(ev.event_timestamp - c.open_time);
        if (diff <= FIVE_DAYS_MS && diff < minDiff) {
          minDiff = diff;
          closestEv = ev;
        }
      });
      
      if (closestEv) {
        const key = `macro_${closestEv.id}`;
        if (!groups[key]) {
          groups[key] = {
            title: closestEv.event_name,
            dateStr: closestEv.date_str,
            timestamp: closestEv.event_timestamp,
            campaigns: []
          };
        }
        groups[key].campaigns.push(c);
      } else {
        // 未匹配到相近宏观事件，则按照开仓月份归档
        const dateObj = new Date(c.open_time);
        const year = dateObj.getFullYear();
        const month = dateObj.getMonth() + 1;
        const key = `month_${year}_${month}`;
        
        if (!groups[key]) {
          groups[key] = {
            title: `${year}年${month}月 常规操盘战役`,
            dateStr: `${year}-${String(month).padStart(2, '0')}`,
            timestamp: new Date(year, month - 1, 1).getTime(),
            campaigns: []
          };
        }
        groups[key].campaigns.push(c);
      }
    });
    
    // 按照时间戳降序排序父级事件组
    const sortedGroups = Object.values(groups).sort((a, b) => b.timestamp - a.timestamp);
    
    // 5. 渲染两级层级列表
    listContainer.innerHTML = sortedGroups.map(group => {
      return `
        <div class="event-group" style="margin-bottom: 1.25rem;">
          <div class="event-group-header" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.25rem; font-weight: 700; font-size: 0.85rem; color: #a78bfa; border-bottom: 1px solid rgba(255,255,255,0.06); margin-bottom: 0.5rem;">
            <span>🌍 ${group.title}</span>
            <span style="font-size: 0.7rem; font-weight: 400; opacity: 0.6;">(${group.dateStr})</span>
          </div>
          <div class="event-group-items" style="display: flex; flex-direction: column; gap: 0.5rem; padding-left: 0.5rem;">
            ${group.campaigns.map(c => {
              const pnlText = c.pnl_ratio !== null ? (c.pnl_ratio >= 0 ? '+' : '') + (c.pnl_ratio * 100).toFixed(2) + '%' : 'N/A';
              const pnlClass = c.pnl_ratio !== null ? (c.pnl_ratio >= 0 ? 'positive' : 'negative') : '';
              const statusText = c.status === 'active' ? '进行中' : '已结束';
              
              return `
                <div class="campaign-item" data-id="${c.id}" style="padding: 0.65rem 0.75rem;">
                  <div class="campaign-item-header" style="margin-bottom: 0.2rem;">
                    <span class="campaign-item-ticker" style="font-size: 0.95rem;">${c.ticker}</span>
                    <span class="campaign-item-status ${c.status}" style="font-size: 0.6rem; padding: 0.1rem 0.3rem;">${statusText}</span>
                  </div>
                  <div class="campaign-item-meta" style="font-size: 0.7rem;">
                    <div class="row">
                      <span>参考收益率:</span>
                      <span class="${pnlClass}" style="font-weight: 700;">${pnlText}</span>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');
    
    // 6. 绑定点击事件，加载个股战役详细时间线
    const items = listContainer.querySelectorAll('.campaign-item');
    items.forEach(item => {
      item.addEventListener('click', () => {
        items.forEach(el => el.classList.remove('active-item'));
        item.classList.add('active-item');
        const id = parseInt(item.getAttribute('data-id'), 10);
        fetchCampaignDetails(id);
      });
    });
    
  } catch (err) {
    listContainer.innerHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span><p>加载异常: ${err.message}</p></div>`;
  }
}

async function fetchCampaignDetails(campaignId) {
  const detailContainer = document.getElementById('campaign-detail-container');
  if (!detailContainer) return;
  
  detailContainer.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>正在获取战役详细时间线...</p>
    </div>
  `;
  
  try {
    const res = await fetch(`/api/campaigns/${campaignId}/messages`);
    const data = await res.json();
    
    if (!data.success) {
      detailContainer.innerHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span><p>获取详情失败: ${data.error || '未知错误'}</p></div>`;
      return;
    }
    
    const c = data.campaign;
    const messages = data.messages || [];
    
    // 1. 格式化战役概览指标
    const pnlText = c.pnl_ratio !== null ? (c.pnl_ratio >= 0 ? '+' : '') + (c.pnl_ratio * 100).toFixed(2) + '%' : 'N/A';
    const pnlClass = c.pnl_ratio !== null ? (c.pnl_ratio >= 0 ? 'positive' : 'negative') : '';
    const openTimeStr = new Date(c.open_time).toLocaleString('zh-CN');
    const closeTimeStr = c.close_time ? new Date(c.close_time).toLocaleString('zh-CN') : '进行中';
    
    // 2. 筛选在战役生命周期内的宏观事件进行混合对齐
    const startMs = c.open_time;
    const endMs = c.close_time || Date.now();
    
    const associatedEvents = (state.macroEvents || []).filter(ev => {
      return ev.event_timestamp >= startMs && ev.event_timestamp <= endMs;
    });
    
    // 3. 将消息与宏观事件合并，并按时间戳升序排序
    const timelineItems = [];
    
    messages.forEach(msg => {
      timelineItems.push({
        type: 'message',
        timestamp: msg.created_at,
        data: msg
      });
    });
    
    associatedEvents.forEach(ev => {
      timelineItems.push({
        type: 'macro_event',
        timestamp: ev.event_timestamp,
        data: ev
      });
    });
    
    timelineItems.sort((a, b) => a.timestamp - b.timestamp);
    
    // 4. 渲染战役详情头部和统计卡片
    let detailHtml = `
      <div class="campaign-detail-header">
        <div class="campaign-detail-title">
          <h3>${c.ticker} 交易战役详情</h3>
          <div class="campaign-detail-time">
            📅 时间线段: ${openTimeStr} ~ ${closeTimeStr}
          </div>
        </div>
      </div>
      
      <div class="campaign-detail-stats">
        <div class="stat-box">
          <span class="stat-label">主导大V</span>
          <span class="stat-value" style="color: var(--accent-purple);">${c.influencer_id}</span>
        </div>
        <div class="stat-box">
          <span class="stat-label">建仓价</span>
          <span class="stat-value">$${c.initial_price ? c.initial_price.toFixed(2) : 'N/A'}</span>
        </div>
        <div class="stat-box">
          <span class="stat-label">当前/平仓价</span>
          <span class="stat-value">$${c.exit_price ? c.exit_price.toFixed(2) : 'N/A'}</span>
        </div>
        <div class="stat-box">
          <span class="stat-label">参考收益率</span>
          <span class="stat-value ${pnlClass}">${pnlText}</span>
        </div>
      </div>
    `;
    
    // 增加 AI 摘要建平仓理由的展示
    if (c.open_reason || c.close_reason) {
      detailHtml += `
        <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); padding: 1rem; border-radius: 8px;">
          ${c.open_reason ? `<p style="margin: 0 0 0.5rem 0; font-size: 0.8rem; line-height: 1.4;"><strong style="color: var(--accent-green);">建仓原因:</strong> ${c.open_reason}</p>` : ''}
          ${c.close_reason ? `<p style="margin: 0; font-size: 0.8rem; line-height: 1.4;"><strong style="color: #ef4444;">平仓原因:</strong> ${c.close_reason}</p>` : ''}
        </div>
      `;
    }
    
    detailHtml += `
      <h4 style="margin: 1.5rem 0 0 0; font-size: 0.95rem; color: #fff;">战役生命周期时间线</h4>
      <div class="campaign-timeline-section">
    `;
    
    if (timelineItems.length === 0) {
      detailHtml += `<div class="empty-state"><p>该战役下暂无关联的发言和事件记录</p></div>`;
    } else {
      detailHtml += timelineItems.map(item => {
        if (item.type === 'message') {
          const msg = item.data;
          let nodeClass = '';
          let tagText = '';
          
          if (msg.event_tag === 'open') {
            nodeClass = 'open-node';
            tagText = '🟢 建仓观点';
          } else if (msg.event_tag === 'close') {
            nodeClass = 'close-node';
            tagText = '🔴 平仓观点';
          } else if (msg.event_tag === 'adjust') {
            nodeClass = 'adjust-node';
            tagText = '🟠 调仓观点';
          }
          
          return `
            <div class="timeline-node ${nodeClass}">
              <div class="timeline-node-time">${new Date(msg.created_at).toLocaleString('zh-CN')}</div>
              <div class="timeline-node-card">
                <div class="timeline-node-sender" style="display:flex; justify-content:space-between; align-items:center;">
                  <span>${msg.sender_name || '大V'}</span>
                  ${tagText ? `<span style="font-size:0.7rem; font-weight:600; padding:0.1rem 0.3rem; background:rgba(255,255,255,0.05); border-radius:4px; margin-left:8px;">${tagText}</span>` : ''}
                </div>
                <div class="timeline-node-content">${msg.content}</div>
              </div>
            </div>
          `;
        } else {
          const ev = item.data;
          const spyChangeClass = ev.spy_change >= 0 ? 'positive' : 'negative';
          const spyChangeSign = ev.spy_change > 0 ? '+' : '';
          
          return `
            <div class="timeline-node">
              <div class="timeline-node-time" style="color: #a78bfa; font-weight: 600;">🌍 宏观事件 • ${new Date(ev.event_timestamp).toLocaleString('zh-CN')}</div>
              <div class="timeline-node-card" style="border: 1px solid rgba(167, 139, 250, 0.25); background: rgba(167, 139, 250, 0.04);">
                <div class="timeline-node-sender" style="color: #c084fc;">${ev.event_name} [${ev.event_type}]</div>
                <div class="timeline-node-content">${ev.description || ''}</div>
                <div class="timeline-node-assoc-event">
                  <div>预期值: ${ev.expected_value || 'N/A'} | 实际值: ${ev.actual_value || 'N/A'}</div>
                  <div style="margin-top: 4px; display:flex; gap: 8px; flex-wrap: wrap;">
                    <span>SPY 日波动: <strong class="${spyChangeClass}">${ev.spy_change !== null ? spyChangeSign + ev.spy_change.toFixed(2) + '%' : 'N/A'}</strong></span>
                    <span>| VIX 收盘: <strong>${ev.vix_close !== null ? ev.vix_close.toFixed(2) : 'N/A'}</strong></span>
                    <span>| 宏观大盘环境: <strong style="color:#c084fc;">${ev.market_regime}</strong></span>
                  </div>
                </div>
              </div>
            </div>
          `;
        }
      }).join('');
    }
    
    detailHtml += `
      </div>
    `;
    
    detailContainer.innerHTML = detailHtml;
    
  } catch (err) {
    detailContainer.innerHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span><p>加载异常: ${err.message}</p></div>`;
  }
}

// ==========================================================================
// 📰 社区资讯总结 Tab 交互控制逻辑
// ==========================================================================

let newsPollingTimer = null;

/**
 * 加载资讯列表
 */
async function loadNewsSummaries() {
  const listContainer = document.getElementById('news-list');
  const countBadge = document.getElementById('news-count');
  
  try {
    // 检查是否有活跃的后台生成任务在跑
    const statusRes = await fetch('/api/news-summaries/status');
    const statusData = await statusRes.json();
    
    if (statusData.status === 'running' || statusData.status === 'pending' || statusData.status === 'retry') {
      document.getElementById('news-progress-area').style.display = 'block';
      document.querySelectorAll('.news-gen-btn').forEach(b => b.disabled = true);
      pollNewsStatus();
    } else {
      document.getElementById('news-progress-area').style.display = 'none';
      document.querySelectorAll('.news-gen-btn').forEach(b => b.disabled = false);
    }

    const res = await fetch('/api/news-summaries?limit=30');
    const data = await res.json();
    
    if (data.success && data.summaries && data.summaries.length > 0) {
      const list = data.summaries;
      countBadge.textContent = list.length + ' 篇';
      renderNewsList(list);
      
      // 默认加载并阅读最新的一篇
      if (!state.selectedNews) {
        viewNewsDetail(list[0]);
      }
    } else {
      countBadge.textContent = '0 篇';
      listContainer.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">📅</span>
          <p>暂无历史速报</p>
          <p class="empty-hint">请点击上方按钮生成第一篇资讯总结</p>
        </div>
      `;
      document.getElementById('news-reader-content').innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">📰</span>
          <p>请点击控制台按钮生成最新的时段资讯总结。</p>
        </div>
      `;
      document.getElementById('btn-copy-news').style.display = 'none';
    }
  } catch (err) {
    listContainer.innerHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span><p>加载失败: ${err.message}</p></div>`;
  }
}

/**
 * 渲染左侧资讯列表卡片墙
 */
function renderNewsList(summaries) {
  const container = document.getElementById('news-list');
  container.innerHTML = summaries.map((s) => {
    let typeClass = '';
    let typeLabel = '';
    
    switch (s.summary_type) {
      case 'briefing':
        typeClass = 'badge-briefing';
        typeLabel = '盘前速报';
        break;
      case 'intraday':
        typeClass = 'badge-intraday';
        typeLabel = '盘中总结';
        break;
      case 'closing':
        typeClass = 'badge-closing';
        typeLabel = '收盘回顾';
        break;
      case 'macro':
        typeClass = 'badge-macro';
        typeLabel = '宏观周报';
        break;
      default:
        typeClass = 'badge-briefing';
        typeLabel = '社区速报';
    }
    
    const timeStr = new Date(s.created_at).toLocaleString('zh-CN', { 
      month: '2-digit', 
      day: '2-digit', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    const isActive = state.selectedNews && state.selectedNews.id === s.id ? 'active' : '';
    
    return `
      <div class="news-summary-card ${isActive}" data-id="${s.id}">
        <div class="news-card-header">
          <span class="news-type-badge ${typeClass}">${typeLabel}</span>
          <span class="news-card-time">${timeStr}</span>
        </div>
        <div class="news-card-title">${escapeAttr(s.title)}</div>
        <div class="news-card-meta">📋 消息源: ${s.raw_messages_count || 0} 条</div>
      </div>
    `;
  }).join('');
  
  // 绑定卡片点击加载事件
  container.querySelectorAll('.news-summary-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = parseInt(card.getAttribute('data-id'), 10);
      const selected = summaries.find(s => s.id === id);
      if (selected) {
        container.querySelectorAll('.news-summary-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        viewNewsDetail(selected);
      }
    });
  });
}

/**
 * 渲染右侧内容阅读器并应用大V防伪高亮标签特效
 */
function viewNewsDetail(summary) {
  state.selectedNews = summary;
  
  document.getElementById('news-reader-title').textContent = '📖 ' + summary.title;
  document.getElementById('btn-copy-news').style.display = 'block';
  
  const contentArea = document.getElementById('news-reader-content');
  
  // 1. 调用已有 renderSimpleMarkdown 函数
  let html = renderSimpleMarkdown(summary.summary_content);
  
  // 2. 将大V确认和群友意见文字转化为漂亮的微标样式
  html = html.replace(/`?\[大V确认\]`?/g, '<span class="badge-source badge-vip">大V确认</span>');
  html = html.replace(/`?\[群友意见\]`?/g, '<span class="badge-source badge-community">群友意见</span>');
  
  contentArea.innerHTML = html;
  
  // 3. 对高亮项进行容器类标记，以提供专属的高光侧边栏色彩
  contentArea.querySelectorAll('li').forEach(li => {
    if (li.querySelector('.badge-vip')) {
      li.classList.add('vip-confirmed-li');
    } else if (li.querySelector('.badge-community')) {
      li.classList.add('community-sentiment-li');
    }
  });
}

/**
 * 手动触发新资讯白皮书的调度
 */
async function triggerNewsGeneration(type) {
  const btn = document.querySelector(`.news-gen-btn[data-type="${type}"]`);
  const statusArea = document.getElementById('news-progress-area');
  const statusText = document.getElementById('news-status-text');
  const progressBar = document.getElementById('news-progress-bar');
  
  document.querySelectorAll('.news-gen-btn').forEach(b => b.disabled = true);
  statusArea.style.display = 'block';
  statusText.textContent = '正在初始化资讯生成任务...';
  progressBar.style.width = '0%';
  
  try {
    const csrfToken = await ensureCsrfToken();
    const res = await fetch('/api/news-summaries/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': state.sessionId,
        'X-CSRF-Token': csrfToken || ''
      },
      body: JSON.stringify({ type, forceRefresh: true })
    });
    
    const data = await res.json();
    if (data.success) {
      pollNewsStatus();
    } else {
      statusText.textContent = '启动失败: ' + (data.reason || data.error || '未知错误');
      document.querySelectorAll('.news-gen-btn').forEach(b => b.disabled = false);
    }
  } catch (err) {
    statusText.textContent = '请求错误: ' + err.message;
    document.querySelectorAll('.news-gen-btn').forEach(b => b.disabled = false);
  }
}

/**
 * 轮询生成进度并反映到进度条
 */
async function pollNewsStatus() {
  const statusText = document.getElementById('news-status-text');
  const progressBar = document.getElementById('news-progress-bar');
  
  try {
    const res = await fetch('/api/news-summaries/status');
    const data = await res.json();
    
    if (data.status === 'pending' || data.status === 'retry') {
      statusText.textContent = '⏳ 任务排队中，等待本地模型分配...';
      progressBar.style.width = '15%';
      if (newsPollingTimer) clearTimeout(newsPollingTimer);
      newsPollingTimer = setTimeout(pollNewsStatus, 3000);
    } else if (data.status === 'running') {
      statusText.textContent = '⚙️ 本地大模型正在提炼发言重点并识别信源真伪...';
      progressBar.style.width = '60%';
      if (newsPollingTimer) clearTimeout(newsPollingTimer);
      newsPollingTimer = setTimeout(pollNewsStatus, 3000);
    } else if (data.status === 'done') {
      statusText.textContent = '✅ 资讯白皮书生成成功！正在刷新列表...';
      progressBar.style.width = '100%';
      document.querySelectorAll('.news-gen-btn').forEach(b => b.disabled = false);
      
      setTimeout(() => {
        document.getElementById('news-progress-area').style.display = 'none';
        loadNewsSummaries();
      }, 1500);
    } else if (data.status === 'failed' || data.status === 'error') {
      document.querySelectorAll('.news-gen-btn').forEach(b => b.disabled = false);
      statusText.textContent = '❌ 生成失败: ' + (data.error || '未知错误');
      progressBar.style.width = '100%';
    } else {
      document.querySelectorAll('.news-gen-btn').forEach(b => b.disabled = false);
      document.getElementById('news-progress-area').style.display = 'none';
    }
  } catch (err) {
    statusText.textContent = '状态获取异常: ' + err.message;
    if (newsPollingTimer) clearTimeout(newsPollingTimer);
    newsPollingTimer = setTimeout(pollNewsStatus, 5000);
  }
}

/**
 * 拷贝资讯内容至剪切板
 */
function copyNewsToClipboard() {
  if (!state.selectedNews) return;
  const tempTextarea = document.createElement('textarea');
  tempTextarea.value = state.selectedNews.summary_content;
  document.body.appendChild(tempTextarea);
  tempTextarea.select();
  try {
    document.execCommand('copy');
    alert('已成功复制资讯白皮书 Markdown 内容到剪贴板！');
  } catch (err) {
    console.error('Failed to copy text:', err);
  }
  document.body.removeChild(tempTextarea);
}

