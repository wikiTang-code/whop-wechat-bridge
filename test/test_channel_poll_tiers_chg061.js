import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadChannelRegistry,
  channelsForTier,
  intersectEnvChannels,
  getPollIntervalMs,
  shouldSkipUnchangedFeed,
  _resetLastSeenForTests
} from '../tools/ingest/channel_poll_config.js';
import { shouldThrottleHot, getEffectivePollIntervalSec, _resetBackpressureForTests, updateBackpressureMetrics } from '../monitoring/backpressure-controller.js';

const FORUM = 'forum_feed_1CTr7SqVMzFfuFiiRJLEHN';
const OPTION = 'chat_feed_1CTrCEx44dP13jW3RVkYiS';
const BROADCAST = 'chat_feed_1CTr7QocNpDZ9FXZ6fvWe4';
const INTRADAY = 'chat_feed_1CaEnj8BrNBr95YSbgabYZ';
const ANALYSIS = 'chat_feed_1CaPyASfSWTuruMgL2u3sT';
const PICK = 'chat_feed_1CaChz8Ru2cjRfAFKi7KbF';

describe('CHG-061 channel poll tiers', () => {
  beforeEach(() => {
    _resetLastSeenForTests();
    _resetBackpressureForTests();
    loadChannelRegistry();
  });

  it('HOT is Zhao trade channels at 2s / 5 posts', () => {
    const hot = channelsForTier('hot');
    assert.deepEqual(hot.map((c) => c.id).sort(), [OPTION, FORUM].sort());
    assert.ok(hot.every((c) => c.poll_limit === 5));
    assert.equal(getPollIntervalMs('hot', { isTrading: true }), 2000);
    assert.equal(getPollIntervalMs('hot', { isTrading: false }), 60000);
  });

  it('WARM includes 美股发布 + 日内波段@5s + 股票分析, not HOT', () => {
    const warm = channelsForTier('warm');
    const ids = warm.map((c) => c.id);
    assert.ok(ids.includes(BROADCAST));
    assert.ok(ids.includes(INTRADAY));
    assert.ok(ids.includes(ANALYSIS));
    assert.equal(ids.includes(FORUM), false);
    assert.ok(warm.every((c) => c.poll_limit === 10));
    assert.equal(getPollIntervalMs('warm', { isTrading: true }), 5000);
  });

  it('COLD includes 每日选股 and throttles only COLD', () => {
    const cold = channelsForTier('cold');
    assert.ok(cold.map((c) => c.id).includes(PICK));
    assert.equal(getPollIntervalMs('cold', { isTrading: true }), 30000);
    assert.equal(getPollIntervalMs('cold', { isTrading: false }), 120000);
    assert.equal(shouldThrottleHot(), false);
    updateBackpressureMetrics({ p99Ms: 5500, httpOk: true });
    assert.equal(getEffectivePollIntervalSec(), 120);
    assert.equal(getPollIntervalMs('hot', { isTrading: true, throttleCold: true, coldThrottleMs: 120000 }), 2000);
    assert.equal(getPollIntervalMs('warm', { isTrading: true, throttleCold: true, coldThrottleMs: 120000 }), 5000);
    assert.equal(getPollIntervalMs('cold', { isTrading: true, throttleCold: true, coldThrottleMs: 120000 }), 120000);
  });

  it('fast-diff skip when newest remote id matches cache', () => {
    assert.equal(shouldSkipUnchangedFeed('post_a', 'post_a'), true);
    assert.equal(shouldSkipUnchangedFeed('post_a', 'post_b'), false);
    assert.equal(shouldSkipUnchangedFeed(null, 'post_b'), false);
  });

  it('intersects env channel allow-list', () => {
    const hot = channelsForTier('hot');
    const sliced = intersectEnvChannels(hot, [FORUM]);
    assert.deepEqual(sliced.map((c) => c.id), [FORUM]);
  });
});
