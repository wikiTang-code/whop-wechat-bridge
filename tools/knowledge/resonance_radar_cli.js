/**
 * tools/knowledge/resonance_radar_cli.js
 * REQ-038-T3: 三点共振只读雷达 CLI 运行器
 * 权威规范: docs/project/req038-t3-resonance-radar-spec.md
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { getDb } from '../../database.js';
import { computeResonanceRadar, RADAR_DISCLAIMER } from './resonance_radar_engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../');
const GEX_LATEST_PATH = path.join(ROOT_DIR, 'data/gex/latest.json');

/**
 * 从 data/gex/latest.json 解析指定标的的做市商结构
 */
export function extractGexSummary(gexData, ticker) {
  const t = ticker.toUpperCase();
  let spot = null;
  let callWall = null;
  let putWall = null;
  let zeroGamma = null;

  // 1. 优先查 zero_dte
  if (gexData.zero_dte && gexData.zero_dte[t]) {
    const item = gexData.zero_dte[t];
    spot = item.spot;
    if (item.floor?.strike) callWall = item.floor.strike;
    if (item.king?.strike) putWall = item.king.strike;
    if (item.flip_point) zeroGamma = item.flip_point;
  }

  // 2. 次查 matrix
  if (gexData.matrix && gexData.matrix[t]) {
    const item = gexData.matrix[t];
    if (!spot && item.spot) spot = item.spot;
    if (!callWall && item.floor?.strike) callWall = item.floor.strike;
    if (!putWall && item.king?.strike) putWall = item.king.strike;
    if (!zeroGamma && item.flip_point) zeroGamma = item.flip_point;
  }

  return {
    spot,
    callWall,
    putWall,
    zeroGamma,
  };
}

/**
 * 执行多标的共振雷达扫描
 */
export function runResonanceRadarScan(options = {}) {
  const {
    dbInstance = getDb(),
    tickers = ['SPY', 'TSLA', 'QQQ'],
    gexPath = GEX_LATEST_PATH,
  } = options;

  console.log('===========================================================');
  console.log('📡 [REQ-038-T3] 三点共振只读雷达实战扫描');
  console.log('===========================================================');

  let gexData = {};
  if (fs.existsSync(gexPath)) {
    try {
      gexData = JSON.parse(fs.readFileSync(gexPath, 'utf8'));
      console.log(`[Radar CLI] 📊 载入 GEX 快照: ${gexData.generated_at || 'unknown'}`);
    } catch (e) {
      console.warn(`[Radar CLI] ⚠️ GEX 快照解析失败: ${e.message}`);
    }
  } else {
    console.warn(`[Radar CLI] ⚠️ GEX 快照文件不存在: ${gexPath}`);
  }

  const selectCardsStmt = dbInstance.prepare(`
    SELECT * FROM ontology_card 
    WHERE status = 'active'
    ORDER BY created_at DESC
  `);

  const allCards = selectCardsStmt.all();
  console.log(`[Radar CLI] 🗃️ 载入活跃战法卡片: ${allCards.length} 张`);

  const reports = [];

  for (const ticker of tickers) {
    const t = ticker.toUpperCase();
    const gex = extractGexSummary(gexData, t);

    // 过滤该标的的卡片
    const tickerCards = allCards.filter((c) => {
      try {
        const list = JSON.parse(c.tickers_json || '[]');
        return list.includes(t);
      } catch {
        return false;
      }
    });

    console.log(`\n--- 🎯 标的: ${t} (命中大V卡片: ${tickerCards.length} 张) ---`);
    console.log(`  GEX 结构: 现价=${gex.spot || '无'}, Call Wall=${gex.callWall || '无'}, Put Wall=${gex.putWall || '无'}`);

    // 若当前 GEX 现价缺失，根据卡片内点位或默认合理值进行回测
    const currentPrice = gex.spot || (tickerCards[0]?.schema_json ? JSON.parse(tickerCards[0].schema_json).support_resistance?.support?.[0] : null);

    const radarResult = computeResonanceRadar({
      ticker: t,
      currentPrice: currentPrice || 100,
      gexSummary: {
        call_wall: gex.callWall,
        put_wall: gex.putWall,
        zero_gamma: gex.zeroGamma,
      },
      cards: tickerCards,
    });

    console.log(`  共振评估: 状态=${radarResult.radar_status}, 共振带数量=${radarResult.resonance_zones.length}`);
    if (radarResult.resonance_zones.length > 0) {
      for (const z of radarResult.resonance_zones) {
        console.log(`    ⚡ [${z.zone_type}] 空间位: ${z.price_center} (置信度: ${z.resonance_score})`);
        console.log(`       观察: ${z.structural_observation}`);
      }
    } else {
      console.log('    ℹ️ 当前未发现 ±1.2% 内高置信度共振区');
    }

    reports.push(radarResult);
  }

  return reports;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runResonanceRadarScan();
}
