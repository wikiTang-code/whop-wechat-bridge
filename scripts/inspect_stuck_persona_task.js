/**
 * @file scripts/inspect_stuck_persona_task.js
 * @description 只读查看卡住的 persona_community / persona_reduce 任务
 */
import Database from 'better-sqlite3';
import path from 'path';

const db = new Database(path.resolve('whop_archive.db'), { readonly: true, timeout: 2000 });

const running = db.prepare(`
  SELECT id, task_type, status, retry_count, max_retries, created_at, updated_at,
         substr(COALESCE(error_message, ''), 1, 200) AS err
  FROM task_queue
  WHERE task_type LIKE 'persona%' AND status IN ('pending', 'running', 'retry')
  ORDER BY id
`).all();

const now = Date.now();
for (const r of running) {
  r.ageMin = Math.round((now - Number(r.updated_at || r.created_at)) / 60000);
  r.createdAtIso = new Date(Number(r.created_at)).toISOString();
  r.updatedAtIso = r.updated_at ? new Date(Number(r.updated_at)).toISOString() : null;
}

console.log(JSON.stringify(running, null, 2));
