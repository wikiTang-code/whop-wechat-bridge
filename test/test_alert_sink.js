/**
 * Small unit tests for monitoring/alert-sink.js (no network).
 */
import {
  sendAlert,
  flushWarnBucket,
  getAlertRingBuffer,
  _resetAlertSinkForTests,
} from '../monitoring/alert-sink.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const pushed = [];
let fakeNow = 1_000_000;

_resetAlertSinkForTests({
  now: () => fakeNow,
  push: async (_url, md) => {
    pushed.push(md);
    return { ok: true };
  },
});

// critical edge + 10min dedupe
{
  pushed.length = 0;
  const a = await sendAlert({
    subsystem: 'runtime',
    level: 'critical',
    title: 'event-loop lag',
    detail: 'p99=6s',
  });
  assert(a.action === 'edge' && a.sent === true, 'critical edge should send');
  assert(pushed.length === 1, 'one critical push');

  const b = await sendAlert({
    subsystem: 'runtime',
    level: 'critical',
    title: 'event-loop lag',
    detail: 'p99=7s',
  });
  assert(b.action === 'deduped', 'same critical within 10min deduped');
  assert(pushed.length === 1, 'no second critical push');

  fakeNow += 10 * 60 * 1000 + 1;
  const c = await sendAlert({
    subsystem: 'runtime',
    level: 'critical',
    title: 'event-loop lag',
    detail: 'p99=8s',
  });
  assert(c.action === 'refresh' && pushed.length === 2, 'after 10min may refresh');
}

// recovery edge
{
  pushed.length = 0;
  const r = await sendAlert({
    subsystem: 'runtime',
    level: 'ok',
    title: 'event-loop lag',
  });
  assert(r.action === 'recovery' && r.sent === true, 'recovery should send');
  assert(pushed.some((m) => m.includes('已恢复')), 'recovery markdown');

  const r2 = await sendAlert({
    subsystem: 'runtime',
    level: 'ok',
    title: 'event-loop lag',
  });
  assert(r2.action === 'noop', 'ok while ok is noop');
}

// warn edge then aggregation
{
  pushed.length = 0;
  fakeNow += 1000;
  const w1 = await sendAlert({
    subsystem: 'fetch',
    level: 'warn',
    title: 'slow sync',
    detail: '45s',
  });
  assert(w1.action === 'edge' && pushed.length === 1, 'warn edge sends once');

  const w2 = await sendAlert({
    subsystem: 'fetch',
    level: 'warn',
    title: 'slow sync',
    detail: '50s',
  });
  assert(w2.action === 'queued', 'subsequent warn queued');
  assert(pushed.length === 1, 'queued warn does not push yet');

  const flush = await flushWarnBucket();
  assert(flush.sent === true && flush.count === 1, 'flush sends aggregated warn');
  assert(pushed.length === 2, 'aggregate flush pushed');
  assert(pushed[1].includes('聚合告警'), 'aggregate title');
}

// ring buffer records
{
  const ring = getAlertRingBuffer();
  assert(ring.length >= 3, 'ring has entries');
}

console.log('test_alert_sink: PASS');
