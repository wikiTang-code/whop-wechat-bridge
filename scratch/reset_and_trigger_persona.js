import { getDb } from '../database.js';
import { generatePersonaPlaybook } from '../persona-engine.js';

const db = getDb();

console.log('====================================================');
console.log('🔄 重置历史失败任务 & 清除脏白皮书 & 触发全量生成');
console.log('====================================================\n');

// 1. 重置失败的任务
const resetRes = db.prepare("UPDATE task_queue SET status = 'pending', retry_count = 0 WHERE task_type LIKE 'persona_%' AND status = 'failed'").run();
console.log(`✅ 1. 已将 ${resetRes.changes} 个历史挂掉的 persona_* 任务重置为 [pending] 待消费状态！`);

// 2. 清除带有 ```markdown 污染的旧版白皮书
const delRes = db.prepare("DELETE FROM reports WHERE strategy = 'PERSONA_PLAYBOOK' AND summary_content LIKE '```markdown%'").run();
console.log(`🧹 2. 已清除 ${delRes.changes} 篇带有污染格式的旧版本白皮书！`);

// 3. 触发全量 1.29万条大V消息画像生成
generatePersonaPlaybook({ forceRefresh: true, maxMonths: 24 }).then(res => {
  console.log('\n🚀 3. 全量大V行为画像白皮书生成成功派发！', res);
  process.exit(0);
}).catch(err => {
  console.error('❌ 派发失败:', err.message);
  process.exit(1);
});
