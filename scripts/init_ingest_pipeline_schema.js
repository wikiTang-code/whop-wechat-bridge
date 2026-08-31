import Database from 'better-sqlite3';
import path from 'path';

console.log('========================================================================================');
console.log('🏛️ 初始化 Top Half / Bottom Half (ISR / DPC) 中断分发数据库架构');
console.log('========================================================================================\n');

const dbPath = path.resolve('whop_archive.db');
const db = new Database(dbPath);

// 1. 创建 ingest_events 表 (上半部事件总线)
db.exec(`
  CREATE TABLE IF NOT EXISTS ingest_events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    channel_id TEXT NOT NULL,
    channel_name TEXT,
    channel_class TEXT NOT NULL,
    speaker TEXT NOT NULL,
    flags TEXT NOT NULL,
    dispatched_queues TEXT NOT NULL,
    created_ts INTEGER NOT NULL,
    UNIQUE(message_id)
  );
  CREATE INDEX IF NOT EXISTS idx_ingest_events_ts ON ingest_events(created_at);
  CREATE INDEX IF NOT EXISTS idx_ingest_events_speaker ON ingest_events(speaker);
`);

// 2. 创建 pipeline_tasks 队列状态表 (下半部 DPC 任务管理)
db.exec(`
  CREATE TABLE IF NOT EXISTS pipeline_tasks (
    task_id INTEGER PRIMARY KEY AUTOINCREMENT,
    queue_name TEXT NOT NULL,
    message_id TEXT NOT NULL,
    event_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    retry_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    result_payload TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(queue_name, message_id)
  );
  CREATE INDEX IF NOT EXISTS idx_pipeline_tasks_queue_status ON pipeline_tasks(queue_name, status);
`);

// 3. 创建 pipeline_watermarks 表 (各产线独立水位线)
db.exec(`
  CREATE TABLE IF NOT EXISTS pipeline_watermarks (
    pipeline_name TEXT PRIMARY KEY,
    last_processed_ts INTEGER NOT NULL,
    last_processed_id TEXT,
    updated_at INTEGER NOT NULL
  );
`);

console.log('✅ SQLite 中断处理流水线表结构初始化完毕：');
console.log('   - ingest_events: 上半部事件总线');
console.log('   - pipeline_tasks: 下半部 DPC 任务队列 (pending | running | done | failed)');
console.log('   - pipeline_watermarks: 产线独立水位线');
