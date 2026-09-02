import Database from 'better-sqlite3';
import { ensurePipelineTasksCompat, listPipelineTaskColumns } from '../scripts/pipeline_tasks_compat.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const db = new Database(':memory:');

db.exec(`
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    sender_name TEXT,
    created_at INTEGER,
    channel_name TEXT,
    attachments TEXT
  );
  CREATE TABLE pipeline_tasks (
    queue_name TEXT NOT NULL,
    message_id TEXT NOT NULL,
    event_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (queue_name, message_id)
  );
`);

db.prepare(`INSERT INTO messages (id, sender_name, created_at, channel_name, attachments) VALUES (?, ?, ?, ?, ?)`)
  .run('post_test_1', 'zhou', Date.now(), 'test', '[]');
db.prepare(`INSERT INTO pipeline_tasks (queue_name, message_id, event_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
  .run('media', 'post_test_1', 1, 'pending', Date.now(), Date.now());

const before = listPipelineTaskColumns(db);
assert(!before.includes('task_id'), 'fixture must lack task_id (live dispatcher schema)');
assert(!before.includes('retry_count'), 'fixture must lack retry_count');

let threw = false;
try {
  db.prepare(`SELECT pt.task_id FROM pipeline_tasks pt`).all();
} catch (err) {
  threw = /no such column: pt\.task_id/i.test(err.message);
  assert(threw, `expected pt.task_id error, got: ${err.message}`);
}
assert(threw, 'SELECT pt.task_id should fail before compat');

const result = ensurePipelineTasksCompat(db);
assert(result.added.includes('task_id'), 'compat should add task_id');
assert(result.added.includes('retry_count'), 'compat should add retry_count');
assert(result.added.includes('error_message'), 'compat should add error_message');
assert(result.added.includes('result_payload'), 'compat should add result_payload');
assert(result.backfilled >= 1, 'compat should backfill task_id from rowid');

const after = listPipelineTaskColumns(db);
assert(after.includes('task_id'), 'task_id present after compat');

const rows = db.prepare(`
  SELECT COALESCE(pt.task_id, pt.rowid) AS task_id, pt.rowid AS rowid, pt.message_id,
         COALESCE(pt.retry_count, 0) AS retry_count
  FROM pipeline_tasks pt
  JOIN messages m ON pt.message_id = m.id
  WHERE pt.queue_name = 'media' AND pt.status = 'pending'
`).all();
assert(rows.length === 1, 'media worker query should return the pending task');
assert(rows[0].task_id > 0, 'task_id/rowid must be a positive integer');

db.prepare(`
  UPDATE pipeline_tasks
  SET status = ?, error_message = ?, result_payload = ?, updated_at = ?
  WHERE rowid = ?
`).run('done', null, '{"note":"ok"}', Date.now(), rows[0].rowid);

const updated = db.prepare(`SELECT status, task_id FROM pipeline_tasks WHERE message_id = ?`).get('post_test_1');
assert(updated.status === 'done', 'rowid update should mark task done');
assert(updated.task_id != null, 'task_id remains after update');

const second = ensurePipelineTasksCompat(db);
assert(second.added.length === 0, 'second ensure is idempotent');

console.log('test_pipeline_tasks_compat: PASS');
