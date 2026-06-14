import { syncAndAnalyze } from './monitor.js';
import { initDb } from './database.js';
import * as dotenv from 'dotenv';
dotenv.config();

initDb();
console.log('Running sync and analysis directly via CLI...');

// Only backfill the signal channels (not the discussion channels)
// to avoid OOM from massive chat history
const signalChannelIds = (process.env.WHOP_SIGNAL_CHANNEL_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
if (signalChannelIds.length > 0) {
  console.log(`Backfill mode: using signal channels only: ${signalChannelIds.join(', ')}`);
  // Temporarily override the channel IDs for this backfill run
  process.env.WHOP_CHAT_CHANNEL_ID = signalChannelIds.join(',');
}

syncAndAnalyze({ backfill: true })
  .then(res => {
    console.log('Sync completed. Result:', JSON.stringify(res, null, 2));
    process.exit(0);
  })
  .catch(err => {
    console.error('Sync failed with error:', err);
    process.exit(1);
  });
