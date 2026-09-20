import assert from 'assert';
import {
  TacticalState,
  createEmptyPosition,
  parseTacticalIntent,
  transitionPositionState
} from '../tools/trade/position_lifecycle_manager.js';

console.log('===========================================================');
console.log('🧪 [Test REQ-053] 实战战术持仓动态生命周期状态机单测套件');
console.log('===========================================================\n');

// 1. 验证大V原话自然语言解析
console.log('--- 1. 验证大V原话战术意图解析器 ---');

const intent1 = parseTacticalIntent('211.4加了6分之一常规仓nbis');
assert.strictEqual(intent1.actionType, 'FRACTIONAL_BUY');
assert.strictEqual(intent1.price, 211.4);
console.log('  ✅ 成功识别 1/6 常规仓分批建仓: 动作=FRACTIONAL_BUY, 价位=$211.4');

const intent2 = parseTacticalIntent('45.6出掉41.85一半的iren');
assert.strictEqual(intent2.actionType, 'HALF_TAKE_PROFIT');
assert.strictEqual(intent2.price, 45.6);
assert.strictEqual(intent2.referencePrice, 41.85);
console.log('  ✅ 成功识别阶梯半仓止盈: 动作=HALF_TAKE_PROFIT, 卖价=$45.6, 参考底仓=$41.85');

const intent3 = parseTacticalIntent('422加回433卖出的wdc');
assert.strictEqual(intent3.actionType, 'GAP_REBUY_T');
assert.strictEqual(intent3.price, 422);
assert.strictEqual(intent3.referencePrice, 433);
console.log('  ✅ 成功识别同标的做T差价加回: 动作=GAP_REBUY_T, 加回价=$422, 高抛价=$433');


// 2. 验证 TAC-001: 初始 1/6 建仓与二次平摊
console.log('\n--- 2. 验证 TAC-001 分批建仓与成本平摊状态机 ---');

let pos = createEmptyPosition('IREN');
assert.strictEqual(pos.tacticalState, TacticalState.EMPTY);

// 初始买入 100 股 @ $40
const step1 = transitionPositionState(pos, {
  actionType: 'FRACTIONAL_BUY',
  price: 40,
  quantity: 100
});
pos = step1.updatedPosition;

assert.strictEqual(pos.quantity, 100);
assert.strictEqual(pos.avgCost, 40);
assert.strictEqual(pos.tacticalState, TacticalState.INITIAL_PROBE);
assert.strictEqual(pos.hardStopLoss, 38); // 40 * 0.95 = 38
console.log(`  ✅ 初始试探仓成立: 股数=${pos.quantity}, 成本=$${pos.avgCost}, 止损=$${pos.hardStopLoss}`);

// 二次加仓 100 股 @ $42
const step2 = transitionPositionState(pos, {
  actionType: 'FRACTIONAL_BUY',
  price: 42,
  quantity: 100
});
pos = step2.updatedPosition;

assert.strictEqual(pos.quantity, 200);
assert.strictEqual(pos.avgCost, 41); // (100*40 + 100*42)/200 = 41
assert.strictEqual(pos.tacticalState, TacticalState.SCALED_IN);
console.log(`  ✅ 二次加仓成本平摊完成: 股数=${pos.quantity}, 综合均价=$${pos.avgCost}, 状态=${pos.tacticalState}`);


// 3. 验证 TAC-002: 直线脉冲半仓止盈与保本损上移
console.log('\n--- 3. 验证 TAC-002 直线拉升半仓止盈与保本损保护 ---');

// 股价冲高至 $46，出掉一半 (100股)
const step3 = transitionPositionState(pos, {
  actionType: 'HALF_TAKE_PROFIT',
  price: 46,
  fraction: 0.5
});
pos = step3.updatedPosition;

assert.strictEqual(pos.quantity, 100);
assert.strictEqual(pos.realizedPnl, 500); // (46 - 41) * 100 = 500
assert.strictEqual(pos.tacticalState, TacticalState.HALF_LOCKED);
assert.strictEqual(pos.breakevenStop, 41); // 保本损自动上提至成本价 41
assert.strictEqual(pos.hardStopLoss, 41);
console.log(`  ✅ 半仓止盈锁利成功: 锁定收益=$${pos.realizedPnl}, 剩余=${pos.quantity}股, 剩余保本损已强制提升至 $${pos.breakevenStop}`);


// 4. 验证 TAC-003: 同标的高抛低吸差价加回做T与成本摊薄
console.log('\n--- 4. 验证 TAC-003 做T差价加回与底仓成本摊薄 ---');

// 假设股价冲高到 $48 时又卖出 50 股，随后在 $44 加回 50 股 (吃到 4 块差价做T)
const sellStep = transitionPositionState(pos, {
  actionType: 'HALF_TAKE_PROFIT',
  price: 48,
  fraction: 0.5
});
pos = sellStep.updatedPosition; // 剩 50 股

// 在 44 加回 50 股
const rebuyStep = transitionPositionState(pos, {
  actionType: 'GAP_REBUY_T',
  price: 44,
  quantity: 50,
  referencePrice: 48
});
pos = rebuyStep.updatedPosition;

assert.strictEqual(pos.quantity, 100);
// 做T赚取差价 = (48 - 44) * 50 = $200
// 底仓成本被做T利润进一步摊薄
console.log(`  ✅ 差价做T加回成功: 当前总持仓=${pos.quantity}股, 摊薄后底仓成本=$${pos.avgCost}, 累计已实现盈亏=$${pos.realizedPnl}`);


// 5. 验证清仓
console.log('\n--- 5. 验证最终清仓 ---');
const closeStep = transitionPositionState(pos, {
  actionType: 'FULL_CLOSE',
  price: 50
});
pos = closeStep.updatedPosition;

assert.strictEqual(pos.quantity, 0);
assert.strictEqual(pos.tacticalState, TacticalState.CLOSED);
assert.ok(pos.realizedPnl > 1000);
console.log(`  ✅ 全程闭环完成: 累计最终总已实现利润=$${pos.realizedPnl}, 最终状态=${pos.tacticalState}`);

console.log('\n===========================================================');
console.log('🎉 [Test REQ-053] 实战战术持仓动态生命周期状态机单测全部 PASS！');
console.log('===========================================================');
