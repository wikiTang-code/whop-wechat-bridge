/**
 * pipeline_tasks schema compat for the live VM.
 *
 * ingest_dispatcher.js historically created pipeline_tasks with
 * PRIMARY KEY (queue_name, message_id) and no task_id column.
 * init_ingest_pipeline_schema.js (and media_worker SELECT pt.task_id)
 * expect task_id / retry_count / error_message / result_payload.
 * CREATE TABLE IF NOT EXISTS does not add those columns later, which
 * surfaces as: [DPC Media Worker] 异步下半部异常: no such column: pt.task_id
 */

const PIPELINE_TASK_COLUMNS = [
  ['task_id', 'INTEGER'],
  ['retry_count', 'INTEGER DEFAULT 0'],
  ['error_message', 'TEXT'],
  ['result_payload', 'TEXT'],
  ['event_id', 'INTEGER']
];

export function listPipelineTaskColumns(db) {
  try {
    return db.prepare(`PRAGMA table_info(pipeline_tasks)`).all().map((c) => c.name);
  } catch (err) {
    return [];
  }
}

export function ensurePipelineTasksCompat(db) {
  const cols = listPipelineTaskColumns(db);
  if (cols.length === 0) return { added: [], backfilled: 0 };

  const colSet = new Set(cols);
  const added = [];

  for (const [name, sqlType] of PIPELINE_TASK_COLUMNS) {
    if (!colSet.has(name)) {
      db.exec(`ALTER TABLE pipeline_tasks ADD COLUMN ${name} ${sqlType}`);
      added.push(name);
      colSet.add(name);
    }
  }

  let backfilled = 0;
  if (colSet.has('task_id')) {
    const info = db.prepare(`
      UPDATE pipeline_tasks SET task_id = rowid WHERE task_id IS NULL
    `).run();
    backfilled = info.changes || 0;
  }

  if (added.length > 0 || backfilled > 0) {
    console.log(
      `[pipeline_tasks] schema compat: added=[${added.join(',') || 'none'}] backfilled_task_id=${backfilled}`
    );
  }

  return { added, backfilled };
}
