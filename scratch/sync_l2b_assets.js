import fs from 'fs';
import path from 'path';

// 1. 同步 post_processor_l2b.js
if (fs.existsSync('data/eval/post_processor_l2b.js')) {
  fs.copyFileSync('data/eval/post_processor_l2b.js', 'scratch/post_processor_l2b.js');
  console.log('✅ 已同步: data/eval/post_processor_l2b.js -> scratch/post_processor_l2b.js');
}

// 2. 归档 l3_strategy_schema.json 到 data/specs/
if (fs.existsSync('data/eval/l3_strategy_schema.json')) {
  fs.copyFileSync('data/eval/l3_strategy_schema.json', 'data/specs/l3_strategy_schema.json');
  console.log('✅ 已归档 (暂不执行): data/specs/l3_strategy_schema.json');
}
