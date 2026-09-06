/**
 * @file scripts/check_persona_queue_status.js
 * @description 只读查看 Persona 任务队列与最新 Playbook 时间（运维探针）
 */
import Database from 'better-sqlite3';
import path from 'path';

const db = new Database(path.resolve('whop_archive.db'), { readonly: true, timeout: 2000 });

const byStatus = db.prepare(`
  SELECT task_type, status, COUNT(1) AS c
  FROM task_queue
  WHERE task_type LIKE 'persona%'
  GROUP BY task_type, status
  ORDER BY task_type, status
`).all();

const pending = db.prepare(`
  SELECT COUNT(1) AS c FROM task_queue
  WHERE task_type LIKE 'persona%' AND status IN ('pending','running','retry')
`).get().c;

const latest = db.prepare(`
  SELECT created_at, ai_model, LENGTH(summary_content) AS len
  FROM reports
  WHERE strategy = 'PERSONA_PLAYBOOK'
  ORDER BY created_at DESC LIMIT 1
`).get();

const lagDays = latest
  ? Math.round(((Date.now() - Number(latest.created_at)) / 86400000) * 10) / 10
  : null;

console.log(JSON.stringify({
  byStatus,
  activeOrPending: pending,
  latestPlaybook: latest
    ? {
        createdAt: new Date(Number(latest.created_at)).toISOString(),
        lagDays,
        aiModel: latest.ai_model,
        contentLen: latest.len,
      }
    : null,
}, null, 2));
