import assert from 'node:assert';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { sendAlert } from '../monitoring/alert-sink.js';
import { saveMessages, updateMessageAttachments, getDb } from '../database.js';
import { runWithRateLimit, getActiveApiCalls } from '../rate-limiter.js';

console.log('--- 开始执行: test_wechat_routing_and_media ---');

// 1. 测试告警分流与 evidence 对象格式化
console.log('1. 验证告警分流与 evidence 格式化...');
const originalFetch = globalThis.fetch;
const interceptedRequests = [];

globalThis.fetch = async (url, options) => {
  interceptedRequests.push({ url, body: JSON.parse(options.body) });
  return {
    ok: true,
    json: async () => ({ errcode: 0, errmsg: 'ok' }),
    text: async () => '{"errcode":0}'
  };
};

try {
  // 1.1 当设置了 WECHAT_ALERT_WEBHOOK_URL 时，告警应路由至独立告警群
  process.env.WECHAT_WORK_WEBHOOK_URL = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=business-key';
  process.env.WECHAT_ALERT_WEBHOOK_URL = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=alert-dedicated-key';

  await sendAlert({
    subsystem: 'test_subsystem',
    level: 'critical',
    title: '测试事件循环尖刺',
    detail: 'p99 延迟超标',
    evidence: {
      meanMs: 23.5,
      thresholds: { warnMs: 1000, criticalMs: 5000 }
    },
    forceImmediate: true
  });

  assert.strictEqual(interceptedRequests.length, 1);
  const req1 = interceptedRequests[0];
  assert.strictEqual(req1.url, 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=alert-dedicated-key', '应推送到专用告警 Webhook');
  const content1 = req1.body.markdown.content;
  assert.ok(!content1.includes('[object Object]'), '告警内容绝不包含 [object Object]');
  assert.ok(content1.includes('thresholds: `{"warnMs":1000,"criticalMs":5000}`'), '嵌套 thresholds 对象应被正确序列化为 JSON 字符串');

  // 1.2 当未配置 WECHAT_ALERT_WEBHOOK_URL 时，应平滑回退到 WECHAT_WORK_WEBHOOK_URL
  delete process.env.WECHAT_ALERT_WEBHOOK_URL;
  await sendAlert({
    subsystem: 'test_subsystem_2',
    level: 'critical',
    title: '回退测试',
    forceImmediate: true
  });

  assert.strictEqual(interceptedRequests.length, 2);
  const req2 = interceptedRequests[1];
  assert.strictEqual(req2.url, 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=business-key', '未配置专属告警群时应平滑回退至业务群');

  console.log('   ✅ 告警分流与 evidence 格式化验证通过！');
} finally {
  globalThis.fetch = originalFetch;
}

// 2. 测试 Database attachments 冲突回填与单独更新
console.log('2. 验证 Database attachments 冲突回填与更新...');
const db = getDb();
const testMsgId = `test_msg_att_${Date.now()}`;

// 2.1 初始写入一条不含 attachments 的消息
saveMessages([{
  id: testMsgId,
  channel_id: 'test_ch',
  channel_name: '测试频道',
  sender_id: 'test_sender',
  sender_name: '赵哥',
  content: '买入 TSLA [IMAGE:https://example.com/test.jpg]',
  created_at: Date.now()
}]);

let row = db.prepare('SELECT attachments FROM messages WHERE id = ?').get(testMsgId);
assert.strictEqual(row.attachments, null, '初次写入时 attachments 应为 null');

// 2.2 使用 saveMessages 再次写入相同的消息（带 attachments），验证 ON CONFLICT 回填
const newAttachments = [{ url: 'https://example.com/test.jpg', status: 'ok', local_path: 'data/media/zhao/test.jpg' }];
saveMessages([{
  id: testMsgId,
  channel_id: 'test_ch',
  channel_name: '测试频道',
  sender_id: 'test_sender',
  sender_name: '赵哥',
  content: '买入 TSLA [IMAGE:https://example.com/test.jpg]',
  created_at: Date.now(),
  attachments: newAttachments
}]);

row = db.prepare('SELECT attachments FROM messages WHERE id = ?').get(testMsgId);
assert.ok(row.attachments !== null, 'ON CONFLICT 后 attachments 应当被正确更新');
const parsed = JSON.parse(row.attachments);
assert.strictEqual(parsed[0].local_path, 'data/media/zhao/test.jpg');

// 2.3 测试 updateMessageAttachments 独立方法
const explicitAttachments = [{ url: 'https://example.com/test_v2.jpg', status: 'ok', local_path: 'data/media/zhao/test_v2.jpg' }];
updateMessageAttachments(testMsgId, explicitAttachments);

row = db.prepare('SELECT attachments FROM messages WHERE id = ?').get(testMsgId);
const parsed2 = JSON.parse(row.attachments);
assert.strictEqual(parsed2[0].local_path, 'data/media/zhao/test_v2.jpg', 'updateMessageAttachments 应成功覆写');

// 清理测试消息
db.prepare('DELETE FROM messages WHERE id = ?').run(testMsgId);
console.log('   ✅ Attachments 冲突更新与独立回填验证通过！');

// 3. 测试 Rate-limiter 零主库写入
console.log('3. 验证 Rate-limiter 纯内存追踪与零主库写入...');
const initialTasksCount = db.prepare(`SELECT COUNT(*) as count FROM task_queue WHERE task_type = 'gemini_api_cloud'`).get().count;

// 模拟调用 runWithRateLimit
let apiCalled = false;
await runWithRateLimit(async () => {
  apiCalled = true;
  return { success: true };
}, { priority: 1, provider: 'gemini' });

assert.strictEqual(apiCalled, true);
const postTasksCount = db.prepare(`SELECT COUNT(*) as count FROM task_queue WHERE task_type = 'gemini_api_cloud'`).get().count;
assert.strictEqual(postTasksCount, initialTasksCount, '调用 API 时绝对不得向 task_queue 写入记录');

console.log('   ✅ Rate-limiter 纯内存追踪验证通过 (task_queue 零写入)！');

console.log('\n🎉 ALL TESTS PASSED: test_wechat_routing_and_media\n');
process.exit(0);
