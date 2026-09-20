import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  checkMilestoneTrigger,
  generateMilestoneAuditReport,
  getFlywheelState
} from '../scripts/slm/flywheel_engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

test('SLM 10% 里程碑判定状态机测试 (checkMilestoneTrigger)', async (t) => {
  await t.test('未达首个 10% 阈值时不触发', () => {
    const metrics = { total: 830, reviewed: 50 }; // 6.02%
    const state = { last_milestone_pct: 0 };
    const res = checkMilestoneTrigger(metrics, state);
    assert.equal(res.shouldTrigger, false);
    assert.equal(res.currentMilestone, 0);
    assert.equal(res.reviewedPct, 6.02);
  });

  await t.test('达到 10% 且上次为 0% 时应触发', () => {
    const metrics = { total: 830, reviewed: 90 }; // 10.84%
    const state = { last_milestone_pct: 0 };
    const res = checkMilestoneTrigger(metrics, state);
    assert.equal(res.shouldTrigger, true);
    assert.equal(res.currentMilestone, 10);
    assert.equal(res.lastMilestone, 0);
  });

  await t.test('达到 15% 但上次已在 10% 迭代时不重复触发', () => {
    const metrics = { total: 830, reviewed: 125 }; // 15.06%
    const state = { last_milestone_pct: 10 };
    const res = checkMilestoneTrigger(metrics, state);
    assert.equal(res.shouldTrigger, false);
    assert.equal(res.currentMilestone, 10);
  });

  await t.test('达到 20% 且上次为 10% 时应触发 20% 里程碑', () => {
    const metrics = { total: 830, reviewed: 170 }; // 20.48%
    const state = { last_milestone_pct: 10 };
    const res = checkMilestoneTrigger(metrics, state);
    assert.equal(res.shouldTrigger, true);
    assert.equal(res.currentMilestone, 20);
    assert.equal(res.lastMilestone, 10);
  });
});

test('SLM 里程碑实战对账单生成与内容契约测试 (generateMilestoneAuditReport)', () => {
  const dummyMetrics = {
    total: 830,
    reviewed: 90,
    corrected: 10,
    confirmed_skip: 74,
    classified_strategy: 6
  };
  const dummyExportResult = {
    total_samples: 1030,
    dpo_contrast_pairs: 17
  };
  const dummyState = {
    version: 'v1.1.0-audit-10pct'
  };

  const reportPath = generateMilestoneAuditReport(10, dummyMetrics, dummyExportResult, dummyState);
  assert.ok(fs.existsSync(reportPath), '对账单文件应存在');

  const content = fs.readFileSync(reportPath, 'utf-8');
  assert.ok(content.includes('# REQ-055: 大V专有 SLM 审核进度 10% 里程碑微调与实战对账单'));
  assert.ok(content.includes('v1.1.0-audit-10pct'));
  assert.ok(content.includes('Strategic Gap Audit'));
  assert.ok(content.includes('Dual-Gate DoD'));
  assert.ok(content.includes('done-eng (accepted-with-gap)'));
});
