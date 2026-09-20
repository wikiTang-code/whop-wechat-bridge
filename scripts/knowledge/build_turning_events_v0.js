/**
 * scripts/knowledge/build_turning_events_v0.js
 * 
 * 产出初版标准微观转弯证据库 (turning_events_v0.jsonl)
 * 来源: 
 * 1. 社群赵哥关于转弯/急跌/直线/出一半/回落挂单的第一人称真实口播 (zhao_quote)
 * 2. 近 60 天真实交易单切片 (audited_fill)
 */

import fs from 'fs';
import path from 'path';
import { getReadOnlyArchiveDb } from '../../monitoring/db-readonly.js';
import {
  createTurningEvent,
  TurningEventType,
  TurningSourceType
} from '../../tools/trade/turning_detector.js';

const OUTPUT_FILE = path.join(process.cwd(), 'data', 'runtime', 'turning_events_v0.jsonl');

async function buildTurningEventsV0() {
  const db = getReadOnlyArchiveDb();
  const zhaoId = 'user_4yeplXgbguTu4';

  console.log('=== 正在构建初版微观转弯证据库 (turning_events_v0.jsonl) ===');

  const events = [];

  // 1. 抽取口述确凿的转弯心法与点位 (zhao_quote)
  const quotes = db.prepare(`
    SELECT id, content, created_at
    FROM messages
    WHERE sender_id = ?
      AND (
        content LIKE '%转弯%' OR content LIKE '%直线%' OR content LIKE '%急跌%'
        OR content LIKE '%出一半%' OR content LIKE '%设跌破%'
      )
    ORDER BY created_at DESC
    LIMIT 100
  `).all(zhaoId);

  for (const q of quotes) {
    const text = q.content.replace(/\n/g, ' ');
    let type = null;
    if (text.includes('急跌') || (text.includes('转弯') && text.includes('吸'))) {
      type = TurningEventType.PLUNGE_TURN_UP;
    } else if (text.includes('直线') || text.includes('出一半') || text.includes('设跌破')) {
      type = TurningEventType.SPIKE_TURN_DOWN;
    }

    if (!type) continue;

    // 简单提取涉及的标的 (如 TSLL, OKLO, INTC, RIOT 等)
    const m = text.match(/\b(TSLA|TSLL|NVDA|NVDL|QQQ|INTC|MU|OKLO|RIOT|IREN|CONL|SOXL)\b/i);
    const symbol = m ? m[1].toUpperCase() : 'BASKET';

    const ev = createTurningEvent({
      type,
      symbol,
      tAnchor: q.created_at,
      source: TurningSourceType.ZHAO_QUOTE,
      evidenceNotes: [
        `消息ID: ${q.id}`,
        `大V发言: "${text.slice(0, 120)}..."`
      ]
    });
    events.push(ev);
  }

  // 2. 抽取真实交易单 (audited_fill)
  const trades = db.prepare(`
    SELECT signal_id, ticker, action, price, created_at, reason
    FROM trade_signals
    WHERE speaker_id = ?
      AND action IN ('BUY', 'SELL')
      AND price > 0
    ORDER BY created_at DESC
    LIMIT 50
  `).all(zhaoId);

  for (const t of trades) {
    const isSell = t.action === 'SELL';
    const type = isSell ? TurningEventType.SPIKE_TURN_DOWN : TurningEventType.PLUNGE_TURN_UP;

    const ev = createTurningEvent({
      type,
      symbol: t.ticker,
      tAnchor: t.created_at,
      impulse: {
        extreme_price: t.price
      },
      source: TurningSourceType.AUDITED_FILL,
      evidenceNotes: [
        `真实交易单: ${t.signal_id} (${t.action} @ $${t.price})`,
        `备注: ${t.reason || '无'}`
      ]
    });
    events.push(ev);
  }

  // 写入 jsonl
  const dir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const stream = fs.createWriteStream(OUTPUT_FILE, { encoding: 'utf8' });
  for (const ev of events) {
    stream.write(JSON.stringify(ev) + '\n');
  }
  stream.end();

  console.log(`✅ 成功导出 ${events.length} 条 TurningEvent 至 ${OUTPUT_FILE}`);
}

buildTurningEventsV0().catch(err => {
  console.error('构建失败:', err);
  process.exit(1);
});
