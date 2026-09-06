/**
 * @file test/test_ingest_heartbeat.js
 * @description T7: ingest_heartbeat 写入/读取 + liveness 纯函数
 */
import fs from 'fs';
import path from 'path';
import {
  initMonitoringDb,
  closeMonitoringDb,
  recordIngestHeartbeat,
  getIngestHeartbeat,
  getMonitoringDbPath,
} from '../monitoring/monitoring-db.js';
import { evaluateIngestLiveness } from '../monitoring/ingest-liveness.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`[AssertionFailed] ${msg}`);
}

const testDbPath = path.resolve('data/test_ingest_heartbeat.db');

function cleanup() {
  closeMonitoringDb();
  for (const p of [testDbPath, `${testDbPath}-wal`, `${testDbPath}-shm`]) {
    try { fs.unlinkSync(p); } catch (_) {}
  }
}

function run() {
  console.log('--- test_ingest_heartbeat ---');
  cleanup();
  process.env.MONITORING_DB_PATH = testDbPath;

  initMonitoringDb(testDbPath);
  const t0 = Date.now();
  recordIngestHeartbeat({ outcome: 'ok', pollMs: 1200, detail: { tick: 1 }, nowMs: t0 });
  const row = getIngestHeartbeat('primary', { nowMs: t0 + 5_000 });
  assert(row.exists === true, 'heartbeat exists');
  assert(row.outcome === 'ok', 'outcome ok');
  assert(row.delayMs >= 4000 && row.delayMs <= 6000, `delay ~5s got ${row.delayMs}`);

  recordIngestHeartbeat({ outcome: 'skipped', pollMs: 10, nowMs: t0 + 10_000 });
  const row2 = getIngestHeartbeat('primary', { nowMs: t0 + 10_500 });
  assert(row2.outcome === 'skipped', 'upsert skipped');

  assert(evaluateIngestLiveness({ exists: true, delayMs: 30_000 }).status === 'ok', '30s ok');
  assert(evaluateIngestLiveness({ exists: true, delayMs: 100_000 }).status === 'warn', '100s warn');
  assert(evaluateIngestLiveness({ exists: true, delayMs: 200_000 }).status === 'critical', '200s critical');
  assert(evaluateIngestLiveness({ exists: false }).httpSuggest === 503, 'missing → 503');

  closeMonitoringDb();
  cleanup();
  delete process.env.MONITORING_DB_PATH;
  console.log('🎉 ALL test_ingest_heartbeat PASSED\n');
}

run();
