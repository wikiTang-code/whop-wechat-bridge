import fs from 'fs';

console.log('====================================================');
console.log('🔍 对 1,447 条教材文本进行绝对严格的原子与共现统计');
console.log('====================================================\n');

const raw = fs.readFileSync('data/curriculum/mrzhou/messages.jsonl', 'utf-8').trim().split('\n').filter(Boolean);
const items = raw.map(l => JSON.parse(l));

console.log(`📦 总样本条数: ${items.length} 条\n`);

// 1. 统计命中信号组合
const comboFreq = {};
const atomFreq = {};
let intradayCount = 0;
let stockPickCount = 0;

for (const it of items) {
  const text = it.text || '';
  if (it.channel_name === '日内波段信号检测' || text.includes('【日内波段信号检测】')) {
    intradayCount++;
    const m = text.match(/命中信号组合:\s*(.+)/);
    if (m) {
      const combo = m[1].trim();
      comboFreq[combo] = (comboFreq[combo] || 0) + 1;
      const atoms = combo.split('/').map(s => s.trim()).filter(Boolean);
      for (const a of atoms) {
        atomFreq[a] = (atomFreq[a] || 0) + 1;
      }
    }
  } else if (it.channel_name === '每日选股' || text.includes('每日选股')) {
    stockPickCount++;
    const m = text.match(/信号[：:]\s*(.+)/);
    if (m) {
      const combo = m[1].trim();
      comboFreq[combo] = (comboFreq[combo] || 0) + 1;
      const atoms = combo.split(/[,、，/]/).map(s => s.trim()).filter(Boolean);
      for (const a of atoms) {
        atomFreq[a] = (atomFreq[a] || 0) + 1;
      }
    }
  }
}

console.log('📊 1. 真实信号组合频次榜 (Top 15):');
const sortedCombos = Object.entries(comboFreq).sort((a, b) => b[1] - a[1]);
for (const [c, f] of sortedCombos.slice(0, 15)) {
  console.log(`  - [${f} 次]: ${c}`);
}

console.log('\n📊 2. 单原子真实出现总频次榜:');
const sortedAtoms = Object.entries(atomFreq).sort((a, b) => b[1] - a[1]);
for (const [a, f] of sortedAtoms) {
  console.log(`  - [${f} 次]: ${a}`);
}

// 3. 统计股票分析中的行情体制
const regimeFreq = {};
for (const it of items) {
  const text = it.text || '';
  if (text.includes('行情体制')) {
    const m = text.match(/当前[：:]\s*([^\n\r]+)/);
    if (m) {
      const reg = m[1].trim();
      regimeFreq[reg] = (regimeFreq[reg] || 0) + 1;
    }
  }
}

console.log('\n📊 3. 股票分析频道真实【行情体制】全集:');
for (const [r, f] of Object.entries(regimeFreq).sort((a, b) => b[1] - a[1])) {
  console.log(`  - [${f} 次]: ${r}`);
}
