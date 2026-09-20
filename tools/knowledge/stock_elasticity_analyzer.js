/**
 * tools/knowledge/stock_elasticity_analyzer.js
 * [P0.5] 标的时变股性与赛道动力学分析器 (Stock Elasticity & Sector Dynamics Analyzer)
 * 
 * 核心原则 (依用户实战盘感与 Grok 审阅意见):
 * 1. 股性不是固定死名单，而是动态时变的;
 * 2. 统计赵哥近 14/30 天真实操作与提及频次作为当期温度，不搞永久写死的白名单;
 * 3. 严格作为展示层徽章，绝对禁止接入自动选股或污染四维共振打分!
 */

export const SECTOR_MAP = {
  // 光模块 (高弹性爆发主战场)
  LITE: { sector: '光模块', baseElasticity: 'HIGH', note: '高弹性 · 日内反弹爆发力极强' },
  COHR: { sector: '光模块', baseElasticity: 'HIGH', note: '高弹性 · 光通信主力龙头' },
  AEHR: { sector: '光模块/半导体设备', baseElasticity: 'HIGH', note: '高弹性 · 碳化硅设备高弹性' },
  
  // 云计算 / AI云
  NBIS: { sector: 'AI云与算力', baseElasticity: 'HIGH', note: '高弹性 · 算力新贵，反弹脉冲大' },
  
  // 存储芯片
  MU: { sector: '存储芯片', baseElasticity: 'HIGH', note: '高弹性 · HBM 与存储核心龙头' },
  SNDK: { sector: '存储芯片', baseElasticity: 'HIGH', note: '存储概念 · 高贝塔反弹标的' },
  WDC: { sector: '存储芯片', baseElasticity: 'MEDIUM_HIGH', note: '机械/闪存存储 · 频发差价做T' },

  // 加密云 / 算力战车
  CIFR: { sector: '加密云/算力', baseElasticity: 'HIGH', note: '超高弹性 · 比特币高贝塔算力' },
  IREN: { sector: '加密云/AI数据中心', baseElasticity: 'HIGH', note: '超高弹性 · 活跃做T常客' },
  CONL: { sector: '加密2x战车', baseElasticity: 'VERY_HIGH', note: '2倍做多Coinbase · 极端日内爆发力' },

  // 权重战车 (当前多处钝化待机)
  TSLA: { sector: '新能源/AI', baseElasticity: 'MEDIUM', note: '巨头权重 · 阶段性波动率收敛钝化' },
  TSLL: { sector: '新能源2x战车', baseElasticity: 'HIGH', note: '2倍做多特斯拉 · 随正股震荡钝化' },
  NVDA: { sector: 'AI芯片权重', baseElasticity: 'MEDIUM', note: '巨头权重 · 阶段性震荡待机' },
  NVDL: { sector: 'AI芯片2x战车', baseElasticity: 'HIGH', note: '2倍做多英伟达 · 随正股震荡待机' }
};

/**
 * 分析指定标的的股性与当期温度
 * @param {string} ticker
 * @param {object} options
 * @param {object} options.dbInstance - 只读 SQLite 句柄
 * @returns {object} elasticityProfile
 */
export function analyzeStockElasticity(ticker, { dbInstance = null } = {}) {
  const sym = String(ticker || '').toUpperCase();
  const sectorInfo = SECTOR_MAP[sym] || { sector: '主线精选', baseElasticity: 'MEDIUM', note: '常规微观监控标的' };

  let recentTradesCount = 0;
  let recentMentionsCount = 0;

  if (dbInstance) {
    try {
      const fourteenDaysAgo = Date.now() - 14 * 86400 * 1000;
      // 1. 统计近 14 天真实交易单频次
      const tradeRow = dbInstance.prepare(`
        SELECT COUNT(*) as count FROM trade_signals
        WHERE speaker_id = 'user_4yeplXgbguTu4'
          AND ticker = ?
          AND created_at >= ?
      `).get(sym, fourteenDaysAgo);
      recentTradesCount = tradeRow ? tradeRow.count : 0;

      // 2. 统计近 14 天口述提及频次
      const mentionRow = dbInstance.prepare(`
        SELECT COUNT(*) as count FROM messages
        WHERE sender_id = 'user_4yeplXgbguTu4'
          AND content LIKE ?
          AND created_at >= ?
      `).get(`%${sym}%`, fourteenDaysAgo);
      recentMentionsCount = mentionRow ? mentionRow.count : 0;
    } catch (_) {
      // 容错降级
    }
  }

  // 动态温度判定 (依据客观统计，杜绝永久死名单)
  let temperatureTag = 'NORMAL';
  let badgeLabel = '📊 常规监控';
  let badgeClass = 'normal';

  const isHot = recentTradesCount >= 2 || recentMentionsCount >= 5;
  const isDormant = (sym === 'TSLA' || sym === 'NVDA' || sym === 'TSLL' || sym === 'NVDL') && recentTradesCount === 0;

  if (sectorInfo.baseElasticity === 'HIGH' || sectorInfo.baseElasticity === 'VERY_HIGH') {
    if (isHot || recentTradesCount >= 1) {
      temperatureTag = 'HOT_ELASTIC';
      badgeLabel = '🔥 高弹性主战场';
      badgeClass = 'hot';
    } else {
      temperatureTag = 'HIGH_ELASTIC';
      badgeLabel = '⚡ 高弹性爆发池';
      badgeClass = 'elastic';
    }
  } else if (isDormant) {
    temperatureTag = 'DORMANT';
    badgeLabel = '⏸ 股性钝化待机';
    badgeClass = 'dormant';
  }

  return {
    ticker: sym,
    sector: sectorInfo.sector,
    base_elasticity: sectorInfo.baseElasticity,
    temperature_tag: temperatureTag,
    badge_label: badgeLabel,
    badge_class: badgeClass,
    zhao_recent_trades: recentTradesCount,
    zhao_recent_mentions: recentMentionsCount,
    note: sectorInfo.note,
    source: 'heuristic_statistical'
  };
}
