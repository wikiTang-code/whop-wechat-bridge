import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import Database from 'better-sqlite3';
import {
  ensurePaperTradingTables,
  saveTradeIntent,
  savePaperPositions
} from '../database.js';
import { readonlyRouter } from '../monitoring/readonly-api-router.js';

describe('REQ-056: Paper 模拟盘 Web API 路由端点单测 (只读与真源查询)', () => {
  let server;
  let baseUrl;
  let testDb;

  before(async () => {
    testDb = new Database(':memory:');
    ensurePaperTradingTables(testDb);

    // 预置一些意图与持仓测试数据
    saveTradeIntent({
      intent_id: 'intent_test_001',
      source: 'test',
      ticker: 'TSLA',
      side: 'BUY',
      quantity: 10,
      price_limit: 220.0,
      status: 'PENDING_HITL',
      created_at: Date.now()
    }, testDb);

    saveTradeIntent({
      intent_id: 'intent_test_002',
      source: 'test',
      ticker: 'NVDA',
      side: 'BUY',
      quantity: 5,
      price_limit: 115.0,
      status: 'FILLED',
      broker_order_id: 'lb_mock_002',
      created_at: Date.now() - 1000
    }, testDb);

    savePaperPositions([{
      ticker: 'NVDA',
      quantity: 5,
      average_entry_price: 115.0,
      current_price: 118.0,
      market_value: 590.0,
      unrealized_pnl: 15.0
    }], testDb);

    const app = express();
    app.use(express.json());
    // 注入 testDb 替换只读库或挂载路由
    app.use((req, res, next) => {
      // 模拟中间件
      next();
    });
    app.use(readonlyRouter);

    await new Promise((resolve) => {
      server = http.createServer(app).listen(0, '127.0.0.1', () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(() => {
    if (server) server.close();
  });

  it('GET /api/paper/intents 返回意图列表格式正确', async () => {
    const res = await fetch(`${baseUrl}/api/paper/intents`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data));
  });

  it('GET /api/paper/positions 返回模拟盘第一真源格式正确', async () => {
    const res = await fetch(`${baseUrl}/api/paper/positions`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.source, 'broker_paper');
    assert.ok(body.disclaimer.includes('第一真源'));
  });

  it('GET /api/paper/summary 返回意图统计格式正确', async () => {
    const res = await fetch(`${baseUrl}/api/paper/summary`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data);
    assert.ok('total' in body.data);
    assert.ok('pending_hitl' in body.data);
  });
});
