import assert from 'assert';
import { parseDateFilterToMs, getMessages } from '../database.js';

console.log('=== [Test] Dashboard Date Filter Timezone (+08:00) ===');

// 1. 测试解析纯日期 YYYY-MM-DD
const startMs = parseDateFilterToMs('2026-05-20', false);
const endMs = parseDateFilterToMs('2026-05-20', true);

const startBj = new Date(startMs).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
const endBj = new Date(endMs).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

console.log('startMs:', startMs, 'BJ:', startBj);
console.log('endMs:  ', endMs, 'BJ:', endBj);

assert(startBj.includes('00:00:00') || startBj.includes('0:00:00'), 'startMs must be 00:00:00 BJ time');
assert(endBj.includes('23:59:59'), 'endMs must be 23:59:59 BJ time');
assert.strictEqual(endMs - startMs, 86399999, 'Day duration ms must be exactly 86399999');

// 2. 测试带毫秒戳与带时区字符串兼容
assert.strictEqual(parseDateFilterToMs(1779206400000), 1779206400000);
assert.strictEqual(parseDateFilterToMs('1779206400000'), 1779206400000);
assert.strictEqual(parseDateFilterToMs('2026-05-20T00:00:00.000Z'), 1779235200000);

// 3. 查询真实 2026-05-20 消息
const res = getMessages({ startDate: '2026-05-20', endDate: '2026-05-20', limit: 500 });
assert(res.total > 0, 'Should find messages on 2026-05-20');
assert(res.messages.length > 0, 'Should return messages');

// 验证所有返回消息全部属于北京时间 2026-05-20
for (const msg of res.messages) {
  const bjDate = new Date(msg.created_at).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
  assert(bjDate.includes('2026/5/20') || bjDate.includes('2026-05-20'), `Message created_at ${msg.created_at} is out of bounds: ${bjDate}`);
}

// 验证能查到凌晨发言 (通过 offset 查最早的消息)
const earliestBatch = getMessages({ startDate: '2026-05-20', endDate: '2026-05-20', limit: 50, offset: res.total - 10 });
assert(earliestBatch.messages.length > 0, 'Should return earliest messages');
const earliestMsg = earliestBatch.messages[earliestBatch.messages.length - 1];
const earliestHour = parseInt(new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: 'numeric', hour12: false }).format(new Date(earliestMsg.created_at)), 10);
assert(earliestHour < 9, `Earliest message hour must be before 9 AM BJ time, got ${earliestHour}`);

console.log('✅ 所有看板日期过滤时区绑定测试全部通过！');
