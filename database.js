import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { trackSlowOp } from './monitoring/slow-log-tracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'whop_archive.db');
let db;

// Prepared statement cache for hot-path queries
const stmtCache = new Map();
function getCachedStmt(sql) {
  if (!stmtCache.has(sql)) {
    stmtCache.set(sql, getDb().prepare(sql));
  }
  return stmtCache.get(sql);
}

// 权威频道登记册加载器 (全系统唯一频道来源)
let channelRegistryMap = null;
function getChannelRegistryMap() {
  if (channelRegistryMap) return channelRegistryMap;
  try {
    const regPath = path.join(process.cwd(), 'config', 'channel_registry.json');
    if (fs.existsSync(regPath)) {
      channelRegistryMap = JSON.parse(fs.readFileSync(regPath, 'utf-8'));
    }
  } catch (e) {
    console.error('[DB Channel Registry] 加载失败:', e.message);
  }
  return channelRegistryMap || {};
}

export function initDb() {
  db = new Database(dbPath, { timeout: 10000 });
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 10000');

  // 快速检查：如果 messages 表已存在，确保新表存在后秒级返回！
  const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'").get();
  if (tableCheck) {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS trade_review_pool (
        id TEXT PRIMARY KEY,
        message_id TEXT,
        ticker TEXT NOT NULL,
        action TEXT NOT NULL,
        price REAL NOT NULL,
        fraction_name TEXT,
        fraction_ratio REAL,
        confidence REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'candidate',
        is_manual INTEGER DEFAULT 0,
        raw_content TEXT NOT NULL,
        before_qty INTEGER DEFAULT 0,
        before_avg_cost REAL DEFAULT 0,
        after_qty INTEGER DEFAULT 0,
        after_avg_cost REAL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `).run();
    try {
      db.prepare("ALTER TABLE trade_review_pool ADD COLUMN is_manual INTEGER DEFAULT 0").run();
    } catch (e) {}
    try {
      db.prepare("ALTER TABLE messages ADD COLUMN attachments TEXT").run();
    } catch (e) {}
    console.log('[initDb] Database already initialized and ready (0ms).');
    return;
  }
  console.log('[initDb] step 4: creating messages table');
  db.prepare(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      channel_name TEXT,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      tickers TEXT,
      sectors TEXT,
      strategies TEXT
    )
  `).run();
  console.log('[initDb] step 5: table messages ready');

  // Migration: Add channel_name column if it doesn't exist (已在库中，避免每次启动锁表)
  /*
  try {
    db.prepare("ALTER TABLE messages ADD COLUMN channel_name TEXT").run();
  } catch (err) {}
  */

  // Indices already exist on messages table, skipped at startup
  /*
  try {
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_tickers ON messages(tickers)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_sectors ON messages(sectors)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_strategies ON messages(strategies)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_is_traded ON messages(is_traded)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_sender_traded ON messages(sender_id, is_traded, is_pushed)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_sender_created ON messages(sender_id, created_at DESC)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_channel_id ON messages(channel_id)`).run();
  } catch (err) {}
  */

  // Perform one-time migration to re-evaluate tickers, sectors, strategies for existing messages (case-insensitive fix)
  // Commented out as it has already successfully run to prevent database locking on startup.
  /*
  try {
    console.log("[Database Migration] Re-evaluating tickers/sectors/strategies for all archived messages (applying case-insensitive fixes)...");
    const allMsgs = db.prepare("SELECT id, content FROM messages").all();
    const updateStmt = db.prepare("UPDATE messages SET tickers = ?, sectors = ?, strategies = ? WHERE id = ?");
    const migrateTx = db.transaction((rows) => {
      for (const row of rows) {
        const dims = extractTradingDimensions(row.content);
        updateStmt.run(dims.tickers, dims.sectors, dims.strategies, row.id);
      }
    });
    migrateTx(allMsgs);
    console.log(`[Database Migration] Successfully updated tags for ${allMsgs.length} messages.`);
  } catch (err) {
    console.error("Failed to run data migration re-extraction:", err.message);
  }
  */

  // Create reports table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER NOT NULL,
      summary_content TEXT NOT NULL,
      ai_model TEXT NOT NULL,
      raw_messages_count INTEGER NOT NULL,
      strategy TEXT
    )
  `).run();

  // Create index on reports created_at
  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_reports_created_at 
    ON reports(created_at DESC)
  `).run();

  // 量化模块表 1: 订单表 (orders)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      ticker TEXT NOT NULL,
      action TEXT NOT NULL,
      price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      reason TEXT
    )
  `).run();

  // 量化模块表 2: 持仓表 (positions)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS positions (
      ticker TEXT PRIMARY KEY,
      quantity INTEGER NOT NULL,
      average_entry_price REAL NOT NULL,
      current_price REAL NOT NULL,
      market_value REAL NOT NULL,
      unrealized_pnl REAL NOT NULL
    )
  `).run();

  // 量化模块表 3: 虚拟账户状态表 (portfolio)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS portfolio (
      key TEXT PRIMARY KEY,
      value REAL NOT NULL
    )
  `).run();

  // 量化模块表 4: 交易消息审核与置信度候选池表 (trade_review_pool)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS trade_review_pool (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      ticker TEXT NOT NULL,
      action TEXT NOT NULL,
      price REAL NOT NULL,
      fraction_name TEXT,
      fraction_ratio REAL,
      confidence REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'candidate',
      raw_content TEXT NOT NULL,
      before_qty INTEGER DEFAULT 0,
      before_avg_cost REAL DEFAULT 0,
      after_qty INTEGER DEFAULT 0,
      after_avg_cost REAL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();

  // 初始化虚拟资金 (如账户不存在，默认存入 100,000 美元沙盒资金)
  const cashCheck = db.prepare('SELECT value FROM portfolio WHERE key = ?').get('cash');
  if (!cashCheck) {
    db.prepare('INSERT INTO portfolio (key, value) VALUES (?, ?)').run('cash', 100000.00);
    db.prepare('INSERT INTO portfolio (key, value) VALUES (?, ?)').run('initial_deposit', 100000.00);
  }

  // Update old channel names to Chinese names (only if needed)
  try {
    const checkStmt = db.prepare("SELECT 1 FROM messages WHERE channel_id = ? AND (channel_name IS NULL OR channel_name != ?) LIMIT 1");
    const updateStmt = db.prepare("UPDATE messages SET channel_name = ? WHERE channel_id = ?");
    
    for (const [id, name] of Object.entries(CHANNEL_NAME_FALLBACKS)) {
      const needsUpdate = checkStmt.get(id, name);
      if (needsUpdate) {
        updateStmt.run(name, id);
        console.log(`Migration: Updated channel name to '${name}' for channel ID ${id}.`);
      }
    }
  } catch (err) {
    console.warn("Migration warning for channel names:", err.message);
  }

  // Register custom sqlite function for cosine distance
  try {
    db.function('cosine_dist', (a, b) => {
      if (!a || !b) return 0;
      const bufA = Buffer.isBuffer(a) ? a : Buffer.from(a);
      const bufB = Buffer.isBuffer(b) ? b : Buffer.from(b);
      
      const lenA = bufA.length / 4;
      const lenB = bufB.length / 4;
      const len = Math.min(lenA, lenB);
      
      let dot = 0;
      let normA = 0;
      let normB = 0;
      
      for (let i = 0; i < len; i++) {
        const valA = bufA.readFloatLE(i * 4);
        const valB = bufB.readFloatLE(i * 4);
        dot += valA * valB;
        normA += valA * valA;
        normB += valB * valB;
      }
      
      if (normA === 0 || normB === 0) return 0;
      return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    });
    console.log("SQLite function cosine_dist registered successfully.");
  } catch (err) {
    console.error("Failed to register SQLite function cosine_dist:", err.message);
  }

  // Register custom sqlite functions for secondary filters: text/image/link
  try {
    db.function('has_image', (content) => {
      if (!content) return 0;
      return /\[IMAGE:https?:\/\/[^\]]+\]/i.test(content) ? 1 : 0;
    });
    db.function('has_link', (content) => {
      if (!content) return 0;
      // Remove all [IMAGE:url] tags first, then check if there is any http:// or https:// left
      const cleanContent = content.replace(/\[IMAGE:https?:\/\/[^\]]+\]/gi, '');
      return /https?:\/\//i.test(cleanContent) ? 1 : 0;
    });
    db.function('is_text_only', (content) => {
      if (!content) return 1;
      const hasImage = /\[IMAGE:https?:\/\/[^\]]+\]/i.test(content);
      const cleanContent = content.replace(/\[IMAGE:https?:\/\/[^\]]+\]/gi, '');
      const hasLink = /https?:\/\//i.test(cleanContent);
      return (!hasImage && !hasLink) ? 1 : 0;
    });
    console.log("SQLite custom filter functions registered successfully.");
  } catch (err) {
    console.error("Failed to register SQLite custom filter functions:", err.message);
  }


  // Create FTS5 virtual table for keyword search
  try {
    db.prepare(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        id UNINDEXED,
        content,
        tokenize='unicode61'
      )
    `).run();
    console.log("FTS5 table messages_fts initialized successfully.");
  } catch (err) {
    console.error("Error creating FTS5 table:", err.message);
  }

  // Create triggers to sync messages to messages_fts
  try {
    db.prepare(`
      CREATE TRIGGER IF NOT EXISTS trg_messages_ai AFTER INSERT ON messages BEGIN
        INSERT OR IGNORE INTO messages_fts(id, content) VALUES(new.id, new.content);
      END;
    `).run();
    db.prepare(`
      CREATE TRIGGER IF NOT EXISTS trg_messages_ad AFTER DELETE ON messages BEGIN
        DELETE FROM messages_fts WHERE id = old.id;
      END;
    `).run();
    db.prepare(`
      CREATE TRIGGER IF NOT EXISTS trg_messages_au AFTER UPDATE ON messages BEGIN
        DELETE FROM messages_fts WHERE id = old.id;
        INSERT OR IGNORE INTO messages_fts(id, content) VALUES(new.id, new.content);
      END;
    `).run();
    console.log("SQLite sync triggers for FTS5 initialized.");
  } catch (err) {
    console.error("Error creating FTS5 triggers:", err.message);
  }

  // Backfill FTS index with existing messages (已完成回填，注释避免启动长耗时卡顿)
  /*
  try {
    const existingUnindexed = db.prepare(`
      SELECT id, content FROM messages 
      WHERE id NOT IN (SELECT id FROM messages_fts)
    `).all();
    if (existingUnindexed.length > 0) {
      console.log(`[FTS Migration] Found ${existingUnindexed.length} messages missing from FTS index. Backfilling...`);
      const insertFts = db.prepare("INSERT OR IGNORE INTO messages_fts(id, content) VALUES(?, ?)");
      const ftsTx = db.transaction((rows) => {
        for (const row of rows) {
          insertFts.run(row.id, row.content || '');
        }
      });
      ftsTx(existingUnindexed);
      console.log(`[FTS Migration] Successfully backfilled ${existingUnindexed.length} messages into FTS index.`);
    }
  } catch (err) {
    console.error("Failed to backfill FTS index:", err.message);
  }
  */

  // Create message embeddings table
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS message_embeddings (
        id TEXT PRIMARY KEY,
        embedding BLOB NOT NULL
      )
    `).run();
    console.log("Message embeddings table initialized.");
  } catch (err) {
    console.error("Error creating message_embeddings table:", err.message);
  }

  // Create task_queue table
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS task_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_type TEXT NOT NULL,
        priority INTEGER DEFAULT 1,
        payload TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        result TEXT,
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 5,
        run_after INTEGER DEFAULT 0,
        error_message TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000)
      )
    `).run();
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_task_queue_poll 
      ON task_queue (status, run_after, priority DESC, created_at ASC)
    `).run();
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_task_queue_batch_id 
      ON task_queue (json_extract(payload, '$.batchId'))
    `).run();
    console.log("task_queue table and index initialized.");
  } catch (err) {
    console.error("Error creating task_queue table:", err.message);
  }

  // Create campaigns table
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        influencer_id TEXT NOT NULL,
        ticker TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        open_time INTEGER NOT NULL,
        close_time INTEGER,
        open_reason TEXT,
        close_reason TEXT,
        initial_price REAL,
        exit_price REAL,
        pnl_ratio REAL,
        strategy_type TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000)
      )
    `).run();
    db.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_active_unique 
      ON campaigns (influencer_id, ticker) WHERE status = 'active'
    `).run();
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_campaigns_status 
      ON campaigns(status, open_time DESC)
    `).run();
    console.log("campaigns table and index initialized.");
  } catch (err) {
    console.error("Error creating campaigns table:", err.message);
  }

  // Migration: Add strategy_type column to campaigns table if it doesn't exist
  try {
    db.prepare("ALTER TABLE campaigns ADD COLUMN strategy_type TEXT").run();
    console.log("Migration: Added strategy_type column to campaigns table.");
  } catch (err) {
    if (!err.message.includes('duplicate column name') && !err.message.includes('already exists')) {
      console.warn("Migration warning for campaigns strategy_type:", err.message);
    }
  }

  // Create campaign_messages table
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS campaign_messages (
        campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000),
        PRIMARY KEY (campaign_id, message_id)
      )
    `).run();
    console.log("campaign_messages table initialized.");
  } catch (err) {
    console.error("Error creating campaign_messages table:", err.message);
  }

  // Create campaign_rules table
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS campaign_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        influencer_id TEXT NOT NULL,
        pattern_type TEXT NOT NULL,
        keyword_regex TEXT NOT NULL,
        confidence_weight REAL DEFAULT 1.0,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000)
      )
    `).run();
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_campaign_rules_lookup 
      ON campaign_rules (influencer_id, pattern_type)
    `).run();
    console.log("campaign_rules table and index initialized.");
  } catch (err) {
    console.error("Error creating campaign_rules table:", err.message);
  }

  // Create macro_events table
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS macro_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_timestamp INTEGER NOT NULL,
        date_str TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_name TEXT NOT NULL,
        description TEXT,
        actual_value TEXT,
        expected_value TEXT,
        market_regime TEXT,
        spy_change REAL,
        vix_close REAL,
        source TEXT DEFAULT 'auto',
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000)
      )
    `).run();
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_macro_events_time 
      ON macro_events (event_timestamp DESC, event_type)
    `).run();
    console.log("macro_events table and index initialized.");
  } catch (err) {
    console.error("Error creating macro_events table:", err.message);
  }

  // Create news_summaries table
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS news_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT NOT NULL,
        summary_type TEXT NOT NULL,
        title TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL,
        summary_content TEXT NOT NULL,
        raw_messages_count INTEGER,
        created_at INTEGER NOT NULL
      )
    `).run();
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_news_summaries_type 
      ON news_summaries(summary_type)
    `).run();
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_news_summaries_type_time 
      ON news_summaries(summary_type, start_time, end_time)
    `).run();
    console.log("news_summaries table and index initialized.");
  } catch (err) {
    console.error("Error creating news_summaries table:", err.message);
  }

  // Migration: Add event_tag column to messages table if it doesn't exist
  try {
    db.prepare("ALTER TABLE messages ADD COLUMN event_tag TEXT").run();
    console.log("Migration: Added event_tag column to messages table.");
  } catch (err) {
    if (!err.message.includes('duplicate column name')) {
      console.warn("Migration warning for messages event_tag:", err.message);
    }
  }

  console.log('SQLite Database initialized successfully at:', dbPath);
}

// Get the database instance
export function getDb() {
  if (!db) initDb();
  return db;
}

// Save messages to database (chunked with event loop yielding)
export async function saveMessages(messages, { chunkSize = 50, yieldEventLoop = true } = {}) {
  if (!messages || messages.length === 0) return 0;
  const conn = getDb();
  const insert = conn.prepare(`
    INSERT INTO messages (id, channel_id, channel_name, sender_id, sender_name, content, created_at, tickers, sectors, strategies, attachments)
    VALUES (@id, @channel_id, @channel_name, @sender_id, @sender_name, @content, @created_at, @tickers, @sectors, @strategies, @attachments)
    ON CONFLICT(id) DO UPDATE SET
      attachments = COALESCE(excluded.attachments, messages.attachments)
  `);

  const registry = getChannelRegistryMap();
  const insertChunk = conn.transaction((msgs) => {
    for (const msg of msgs) {
      const dims = extractTradingDimensions(msg.content);
      const regInfo = registry[msg.channel_id];
      let channelName = regInfo ? regInfo.name : (msg.channel_name || msg.channel_id);
      let attachJson = null;
      if (msg.attachments) {
        attachJson = typeof msg.attachments === 'string' ? msg.attachments : JSON.stringify(msg.attachments);
      }
      insert.run({
        id: msg.id,
        channel_id: msg.channel_id,
        channel_name: channelName,
        sender_id: msg.sender_id,
        sender_name: msg.sender_name,
        content: msg.content,
        created_at: msg.created_at,
        tickers: dims.tickers,
        sectors: dims.sectors,
        strategies: dims.strategies,
        attachments: attachJson
      });
    }
  });

  try {
    // 小批量数据 (<= chunkSize)：单次同步事务极速写入，零异步等待开销
    if (messages.length <= chunkSize) {
      trackSlowOp('database:saveMessages', messages.length, () => {
        insertChunk(messages);
      });
      return messages.length;
    }

    // 大批量数据：按 chunkSize (50条) 分片入库，事务间主动释放事件循环保全 HTTP 看板
    await trackSlowOp('database:saveMessages', messages.length, async () => {
      for (let i = 0; i < messages.length; i += chunkSize) {
        const chunk = messages.slice(i, i + chunkSize);
        insertChunk(chunk);
        if (yieldEventLoop && i + chunkSize < messages.length) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
    });
    return messages.length;
  } catch (err) {
    console.error('[Database] saveMessages transaction failed:', err.message);
    throw err;
  }
}

// Explicitly update attachments for an existing message
export function updateMessageAttachments(id, attachments) {
  if (!id || !attachments) return;
  const conn = getDb();
  const attachJson = typeof attachments === 'string' ? attachments : JSON.stringify(attachments);
  try {
    conn.prepare(`
      UPDATE messages
      SET attachments = ?
      WHERE id = ?
    `).run(attachJson, id);
  } catch (err) {
    console.error(`[Database] updateMessageAttachments failed for message ${id}:`, err.message);
  }
}

// Check if a message is already in the database
export function isMessageArchived(id) {
  const stmt = getCachedStmt('SELECT 1 FROM messages WHERE id = ?');
  const row = stmt.get(id);
  return !!row;
}

// Retrieve messages with optional search and pagination and speaker filtering
export function getMessages({ search, limit = 50, offset = 0, senderIds = [], excludeSenderIds = [], channelId = '', channelName = '', ticker = '', sector = '', strategy = '', startDate = '', endDate = '', msgType = '' } = {}) {
  // Input validation: clamp limit and offset to safe ranges
  limit = Math.max(1, Math.min(500, parseInt(limit, 10) || 50));
  offset = Math.max(0, parseInt(offset, 10) || 0);
  const conn = getDb();
  let query = 'SELECT * FROM messages';
  let countQuery = 'SELECT COUNT(*) as count FROM messages';
  const params = [];
  const clauses = [];

  if (msgType === 'image') {
    clauses.push('has_image(content) = 1');
  } else if (msgType === 'link') {
    clauses.push('has_link(content) = 1');
  } else if (msgType === 'text') {
    clauses.push('is_text_only(content) = 1');
  }

  if (search) {
    clauses.push('content LIKE ?');
    params.push(`%${search}%`);
  }

  if (channelId) {
    clauses.push('channel_id = ?');
    params.push(channelId);
  }

  if (channelName) {
    clauses.push('channel_name = ?');
    params.push(channelName);
  }

  if (ticker) {
    clauses.push('tickers LIKE ?');
    params.push(`%,${ticker},%`);
  }

  if (sector) {
    clauses.push('sectors LIKE ?');
    params.push(`%,${sector},%`);
  }

  if (strategy) {
    clauses.push('strategies LIKE ?');
    params.push(`%,${strategy},%`);
  }

  if (startDate) {
    const startMs = new Date(`${startDate}T00:00:00`).getTime();
    if (!isNaN(startMs)) {
      clauses.push('created_at >= ?');
      params.push(startMs);
    }
  }

  if (endDate) {
    const endMs = new Date(`${endDate}T23:59:59.999`).getTime();
    if (!isNaN(endMs)) {
      clauses.push('created_at <= ?');
      params.push(endMs);
    }
  }

  if (Array.isArray(senderIds) && senderIds.length > 0) {
    const placeholders = senderIds.map(() => '?').join(',');
    clauses.push(`sender_id IN (${placeholders})`);
    params.push(...senderIds);
  }

  if (Array.isArray(excludeSenderIds) && excludeSenderIds.length > 0) {
    const placeholders = excludeSenderIds.map(() => '?').join(',');
    clauses.push(`sender_id NOT IN (${placeholders})`);
    params.push(...excludeSenderIds);
  }

  if (clauses.length > 0) {
    const where = ' WHERE ' + clauses.join(' AND ');
    query += where;
    countQuery += where;
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  
  const stmt = conn.prepare(query);
  const countStmt = conn.prepare(countQuery);

  const rawMessages = stmt.all(...params, limit, offset);
  const total = countStmt.get(...params)?.count || 0;

  const registry = getChannelRegistryMap();
  const messages = rawMessages.map(m => {
    const regInfo = registry[m.channel_id];
    return {
      ...m,
      channel_name: regInfo ? regInfo.name : (m.channel_name || m.channel_id)
    };
  });

  return { messages, total };
}

// Get the latest message ID we have stored for a specific channel and sender
export function getLatestMessageId(channelId, senderId) {
  const conn = getDb();
  const stmt = conn.prepare(`
    SELECT id FROM messages 
    WHERE channel_id = ? AND sender_id = ? 
    ORDER BY created_at DESC LIMIT 1
  `);
  const result = stmt.get(channelId, senderId);
  return result ? result.id : null;
}

// Save AI report
export function saveReport({ startTime, endTime, summaryContent, aiModel, rawMessagesCount, strategy = null }) {
  const conn = getDb();
  const stmt = conn.prepare(`
    INSERT INTO reports (created_at, start_time, end_time, summary_content, ai_model, raw_messages_count, strategy)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  const info = stmt.run(
    Date.now(),
    startTime,
    endTime,
    summaryContent,
    aiModel,
    rawMessagesCount,
    strategy
  );
  
  return info.lastInsertRowid;
}

// Retrieve reports with pagination
export function getReports({ limit = 10, offset = 0 } = {}) {
  limit = Math.max(1, Math.min(500, parseInt(limit, 10) || 10));
  offset = Math.max(0, parseInt(offset, 10) || 0);
  const conn = getDb();
  const stmt = conn.prepare(`
    SELECT * FROM reports 
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `);
  const countStmt = conn.prepare('SELECT COUNT(*) as count FROM reports');

  const reports = stmt.all(limit, offset);
  const total = countStmt.get()?.count || 0;

  return { reports, total };
}

// Retrieve latest AI report for a specific strategy
export function getLatestReportForStrategy(strategy) {
  const conn = getDb();
  return conn.prepare(`
    SELECT * FROM reports 
    WHERE strategy = ? 
    ORDER BY created_at DESC LIMIT 1
  `).get(strategy);
}

// ==========================================================================
// 量化跟单数据操作 API
// ==========================================================================

// 获取账户资产信息
export function getPortfolio() {
  const conn = getDb();
  const cash = conn.prepare('SELECT value FROM portfolio WHERE key = ?').get('cash')?.value || 0;
  const deposit = conn.prepare('SELECT value FROM portfolio WHERE key = ?').get('initial_deposit')?.value || 0;
  
  // 计算总持仓市值
  const positions = conn.prepare('SELECT * FROM positions').all();
  const positionsValue = positions.reduce((sum, pos) => sum + pos.market_value, 0);
  const totalEquity = cash + positionsValue;
  
  return {
    cash,
    initial_deposit: deposit,
    positions_value: positionsValue,
    total_equity: totalEquity,
    unrealized_pnl: positions.reduce((sum, pos) => sum + pos.unrealized_pnl, 0)
  };
}

// 更新账户现金
export function updatePortfolioCash(cash) {
  const conn = getDb();
  conn.prepare('UPDATE portfolio SET value = ? WHERE key = ?').run(cash, 'cash');
}

// 重置模拟账户资金
export function resetPortfolioCash(amount = 100000.00) {
  const conn = getDb();
  conn.prepare('UPDATE portfolio SET value = ? WHERE key = ?').run(amount, 'cash');
  conn.prepare('UPDATE portfolio SET value = ? WHERE key = ?').run(amount, 'initial_deposit');
  conn.prepare('DELETE FROM positions').run();
  conn.prepare('DELETE FROM orders').run();
}

// 设置上次同步时间
export function setLastSyncTime(timestamp) {
  const conn = getDb();
  conn.prepare(`
    INSERT INTO portfolio (key, value) VALUES ('last_sync_time', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(timestamp);
}

// 获取上次同步时间
export function getLastSyncTime() {
  const conn = getDb();
  const row = conn.prepare("SELECT value FROM portfolio WHERE key = 'last_sync_time'").get();
  return row ? row.value : null;
}


// 获取所有持仓
export function getPositions() {
  const conn = getDb();
  return conn.prepare('SELECT * FROM positions WHERE quantity > 0').all();
}

// 更新持仓
export function savePosition(position) {
  const conn = getDb();
  if (position.quantity <= 0) {
    conn.prepare('DELETE FROM positions WHERE ticker = ?').run(position.ticker);
  } else {
    conn.prepare(`
      INSERT INTO positions (ticker, quantity, average_entry_price, current_price, market_value, unrealized_pnl)
      VALUES (@ticker, @quantity, @average_entry_price, @current_price, @market_value, @unrealized_pnl)
      ON CONFLICT(ticker) DO UPDATE SET
        quantity = excluded.quantity,
        average_entry_price = excluded.average_entry_price,
        current_price = excluded.current_price,
        market_value = excluded.market_value,
        unrealized_pnl = excluded.unrealized_pnl
    `).run(position);
  }
}

// 保存订单
export function saveOrder(order) {
  const conn = getDb();
  conn.prepare(`
    INSERT INTO orders (id, ticker, action, price, quantity, status, created_at, reason)
    VALUES (@id, @ticker, @action, @price, @quantity, @status, @created_at, @reason)
  `).run(order);
}

// 获取订单历史
export function getOrders({ limit = 50, offset = 0 } = {}) {
  limit = Math.max(1, Math.min(500, parseInt(limit, 10) || 50));
  offset = Math.max(0, parseInt(offset, 10) || 0);
  const conn = getDb();
  const stmt = conn.prepare(`
    SELECT * FROM orders 
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `);
  const countStmt = conn.prepare('SELECT COUNT(*) as count FROM orders');
  
  const orders = stmt.all(limit, offset);
  const total = countStmt.get()?.count || 0;
  
  return { orders, total };
}

// Sector mapping (module level)
const SECTOR_MAPPING = {
  // 科技/AI芯片
  'NVDA': '科技/AI芯片', 'NVDL': '科技/AI芯片', 'AMD': '科技/AI芯片', 'AVGO': '科技/AI芯片',
  'TSM': '科技/AI芯片', 'ASML': '科技/AI芯片', 'ARM': '科技/AI芯片', 'MU': '科技/AI芯片',
  'INTC': '科技/AI芯片', 'QCOM': '科技/AI芯片', 'MRVL': '科技/AI芯片', 'SMCI': '科技/AI芯片',
  // 新能源汽车
  'TSLA': '新能源汽车', 'TSLL': '新能源汽车', 'BYD': '新能源汽车', 'BYDDY': '新能源汽车',
  'RIVN': '新能源汽车', 'LCID': '新能源汽车',
  // 巨头/科技龙头
  'AAPL': '巨头/科技龙头', 'MSFT': '巨头/科技龙头', 'GOOG': '巨头/科技龙头', 'GOOGL': '巨头/科技龙头',
  'META': '巨头/科技龙头', 'AMZN': '巨头/科技龙头', 'NFLX': '巨头/科技龙头',
  // 加密货币/区块链
  'COIN': '加密货币/区块链', 'MSTR': '加密货币/区块链', 'MARA': '加密货币/区块链', 'RIOT': '加密货币/区块链',
  'CLSK': '加密货币/区块链', 'BTC': '加密货币/区块链', 'ETH': '加密货币/区块链',
  // 中概股
  'BABA': '中概股', 'PDD': '中概股', 'JD': '中概股', 'BIDU': '中概股', 'FUTU': '中概股',
  'YINN': '中概股', 'CQQQ': '中概股', 'YANG': '中概股',
  // 大盘/债汇/指数
  'SPY': '大盘/债汇/指数', 'QQQ': '大盘/债汇/指数', 'DIA': '大盘/债汇/指数', 'IWM': '大盘/债汇/指数',
  'TLT': '大盘/债汇/指数', 'TMF': '大盘/债汇/指数', 'SQQQ': '大盘/债汇/指数', 'TQQQ': '大盘/债汇/指数',
  'UUP': '大盘/债汇/指数', 'DXY': '大盘/债汇/指数',
  // 光通信/其他
  'LITE': '光通信/其他', 'COHR': '光通信/其他', 'LUNA': '光通信/其他'
};

const KNOWN_TICKERS_REGEX = new RegExp(`\\b\\$?(${Object.keys(SECTOR_MAPPING).join('|')})\\b`, 'gi');

const STOP_WORDS = new Set([
  'BUY', 'SELL', 'CALL', 'PUT', 'GET', 'POST', 'JSON', 'USD', 'CAD', 'EUR', 'GBP', 'CNY', 'HKD', 'ETF', 'ETFS', 'API', 
  'REST', 'HTML', 'CSS', 'JS', 'AI', 'GPT', 'USA', 'SEC', 'FED', 'FOMC', 'GDP', 
  'CPI', 'PPI', 'PMI', 'VIX', 'FOR', 'AND', 'THE', 'YOU', 'OUR', 'NOW', 'BUT',
  'IPO', 'SPAC', 'IV', 'ITM', 'OTM', 'ATM', 'TA', 'DD', 'ATH', 'EOD', 'PM', 'AH',
  'PNL', 'PL', 'NAV', 'CEO', 'CFO', 'COO', 'UTC', 'EST', 'EDT', 'MACD', 'RSI',
  'EMA', 'SMA', 'PDF', 'PPT', 'DOC', 'URL', 'URI', 'AWS', 'SSL', 'TLS', 'DNS',
  'IP', 'VPN', 'APP', 'WEB', 'PC', 'FAQ', 'VS', 'OK', 'FYI', 'DIY', 'NEW', 'OLD', 'NA',
  'IMAGE', 'HMAC', 'SHA', 'SHA256', 'AMZ', 'CALLS', 'PUTS'
]);

const GENERIC_TICKER_REGEX = /\b\$?([A-Z]{2,5})\b/g;

// Extract trading dimensions (tickers, sectors, strategies) from content
export function extractTradingDimensions(content) {
  if (!content) return { tickers: '', sectors: '', strategies: '' };
  
  // 0. Clean content: strip image tags [IMAGE:...] and standard URLs
  let cleanContent = content.replace(/\[IMAGE:[^\]]+\]/gi, '');
  cleanContent = cleanContent.replace(/https?:\/\/[^\s]+/gi, '');
  
  const tickersFound = new Set();

  // 1. Single-pass match for known mapped tickers case-insensitively
  KNOWN_TICKERS_REGEX.lastIndex = 0;
  let kMatch;
  while ((kMatch = KNOWN_TICKERS_REGEX.exec(cleanContent)) !== null) {
    tickersFound.add(kMatch[1].toUpperCase());
  }

  // 2. Fallback to match other uppercase words (e.g. unknown new tickers)
  GENERIC_TICKER_REGEX.lastIndex = 0;
  let match;
  while ((match = GENERIC_TICKER_REGEX.exec(cleanContent)) !== null) {
    const sym = match[1].toUpperCase();
    if (!STOP_WORDS.has(sym)) {
      tickersFound.add(sym);
    }
  }
  
  const sectorsFound = new Set();
  tickersFound.forEach(t => {
    if (SECTOR_MAPPING[t]) {
      sectorsFound.add(SECTOR_MAPPING[t]);
    } else {
      sectorsFound.add('其他个股');
    }
  });
  
  // Strategy extraction
  const strategiesFound = new Set();
  const lowerContent = content.toLowerCase();
  
  if (/财报|季报|年报|业绩|earning/i.test(lowerContent)) {
    strategiesFound.add('财报战法');
  }
  if (/节日|被动减|假前|节前/i.test(lowerContent)) {
    strategiesFound.add('节日被动减');
  }
  if (/单调减|单调递减|只减不加/i.test(lowerContent)) {
    strategiesFound.add('单调减');
  }
  if (/尾盘强平|尾盘平仓|尾盘平|强平|尾盘杀|尾盘退/i.test(lowerContent)) {
    strategiesFound.add('尾盘强平');
  }
  if (/做t|做T|刷t|刷T|底仓T|底仓t|t\+0|T\+0/i.test(lowerContent)) {
    strategiesFound.add('做T');
  }
  if (/弹性股|弹性防御|弹性股防御|防守|避险/i.test(lowerContent)) {
    strategiesFound.add('弹性股防御');
  }
  if (/规律|总结|经验/i.test(lowerContent)) {
    strategiesFound.add('规律总结');
  }
  
  // Comma-separated format with wrapping commas for perfect SQL LIKE match (e.g. ,TSLA,NVDA,)
  const tickersStr = tickersFound.size > 0 ? `,${Array.from(tickersFound).join(',')},` : '';
  const sectorsStr = sectorsFound.size > 0 ? `,${Array.from(sectorsFound).join(',')},` : '';
  const strategiesStr = strategiesFound.size > 0 ? `,${Array.from(strategiesFound).join(',')},` : '';
  
  return {
    tickers: tickersStr,
    sectors: sectorsStr,
    strategies: strategiesStr
  };
}

// ==========================================================================
// RAG & Vector Database Helper Functions
// ==========================================================================

export function saveMessageEmbedding(id, embeddingArray) {
  const conn = getDb();
  const buffer = Buffer.alloc(embeddingArray.length * 4);
  for (let i = 0; i < embeddingArray.length; i++) {
    buffer.writeFloatLE(embeddingArray[i], i * 4);
  }
  conn.prepare(`
    INSERT INTO message_embeddings (id, embedding)
    VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET embedding = excluded.embedding
  `).run(id, buffer);
}

export function getMessagesWithoutEmbeddings(limit = 100) {
  const conn = getDb();
  return conn.prepare(`
    SELECT m.id, m.content FROM messages m
    LEFT JOIN message_embeddings me ON m.id = me.id
    WHERE me.id IS NULL
    ORDER BY m.created_at DESC
    LIMIT ?
  `).all(limit);
}

export function getEmbeddingsCount() {
  const conn = getDb();
  return conn.prepare('SELECT COUNT(*) as count FROM message_embeddings').get()?.count || 0;
}

export function searchFTSMessages(queryText, limit = 30, senderIds = []) {
  limit = Math.max(1, Math.min(500, parseInt(limit, 10) || 30));
  const conn = getDb();
  try {
    const asciiWords = queryText.match(/\b[A-Za-z0-9_-]+\b/g) || [];
    const cleanFtsQuery = asciiWords.join(' ');
    
    let ftsResults = [];
    if (cleanFtsQuery) {
      let queryStr = `
        SELECT m.*, f.content
        FROM messages m
        JOIN messages_fts f ON m.id = f.id
        WHERE messages_fts MATCH ?
      `;
      const params = [cleanFtsQuery];
      if (Array.isArray(senderIds) && senderIds.length > 0) {
        const placeholders = senderIds.map(() => '?').join(',');
        queryStr += ` AND m.sender_id IN (${placeholders})`;
        params.push(...senderIds);
      }
      queryStr += ` ORDER BY bm25(messages_fts) ASC LIMIT ?`;
      params.push(limit);
      
      ftsResults = conn.prepare(queryStr).all(...params);
    }
    
    const chineseRegex = /[\u4e00-\u9fa5]+/g;
    const chineseWords = queryText.match(chineseRegex) || [];
    
    let likeResults = [];
    if (chineseWords.length > 0) {
      const clauses = chineseWords.map(() => 'content LIKE ?');
      const params = chineseWords.map(w => `%${w}%`);
      
      let query = `SELECT * FROM messages WHERE ${clauses.join(' AND ')}`;
      if (Array.isArray(senderIds) && senderIds.length > 0) {
        const placeholders = senderIds.map(() => '?').join(',');
        query += ` AND sender_id IN (${placeholders})`;
        params.push(...senderIds);
      }
      query += ` ORDER BY created_at DESC LIMIT ?`;
      params.push(limit);
      
      likeResults = conn.prepare(query).all(...params);
    }
    
    const seen = new Set();
    const merged = [];
    
    likeResults.forEach(r => {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        merged.push(r);
      }
    });
    
    ftsResults.forEach(r => {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        delete r.content;
        const origMsg = conn.prepare('SELECT content FROM messages WHERE id = ?').get(r.id);
        if (origMsg) r.content = origMsg.content;
        merged.push(r);
      }
    });
    
    return merged.slice(0, limit);
  } catch (err) {
    console.warn("FTS5 query failed, falling back to LIKE search:", err.message);
    let fallbackQuery = `SELECT * FROM messages WHERE content LIKE ?`;
    const params = [`%${queryText}%`];
    if (Array.isArray(senderIds) && senderIds.length > 0) {
      const placeholders = senderIds.map(() => '?').join(',');
      fallbackQuery += ` AND sender_id IN (${placeholders})`;
      params.push(...senderIds);
    }
    fallbackQuery += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);
    return conn.prepare(fallbackQuery).all(...params);
  }
}

export function searchVectorMessages(embeddingArray, limit = 30, senderIds = []) {
  const conn = getDb();
  const buffer = Buffer.alloc(embeddingArray.length * 4);
  for (let i = 0; i < embeddingArray.length; i++) {
    buffer.writeFloatLE(embeddingArray[i], i * 4);
  }
  
  let query = `
    SELECT m.*, cosine_dist(e.embedding, ?) as similarity
    FROM messages m
    JOIN message_embeddings e ON m.id = e.id
  `;
  const params = [buffer];
  
  if (Array.isArray(senderIds) && senderIds.length > 0) {
    const placeholders = senderIds.map(() => '?').join(',');
    query += ` WHERE m.sender_id IN (${placeholders})`;
    params.push(...senderIds);
  }
  
  query += ` ORDER BY similarity DESC LIMIT ?`;
  params.push(limit);
  
  return conn.prepare(query).all(...params);
}

// 获取指定消息的前后上下文消息
export function getMessageContext({ messageId, limit = 10 }) {
  const conn = getDb();
  
  // 1. 先查出目标消息的定位参数 (created_at, channel_id)
  const target = conn.prepare('SELECT created_at, channel_id FROM messages WHERE id = ?').get(messageId);
  if (!target) return { messages: [], targetId: messageId };
  
  // 2. 查出在此之前最邻近且严格同一 channel_id 的 limit 条消息
  const before = conn.prepare(`
    SELECT * FROM messages 
    WHERE channel_id = ? AND created_at < ? 
    ORDER BY created_at DESC LIMIT ?
  `).all(target.channel_id, target.created_at, limit);
  
  // 3. 查出在此之后最邻近且严格同一 channel_id 的 limit 条消息
  const after = conn.prepare(`
    SELECT * FROM messages 
    WHERE channel_id = ? AND created_at > ? 
    ORDER BY created_at ASC LIMIT ?
  `).all(target.channel_id, target.created_at, limit);
  
  // 4. 查出目标消息本身
  const targetMsg = conn.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
  
  // 5. 组合并按时间线正序排序 (before 需要反转以保持时间正序)
  const combined = [
    ...before.reverse(),
    targetMsg,
    ...after
  ];

  // 6. 统一通过权威登记册修正 channel_name，杜绝历史脏标或旧别名
  const registry = getChannelRegistryMap();
  const normalized = combined.map(m => {
    const regInfo = registry[m.channel_id];
    return {
      ...m,
      channel_name: regInfo ? regInfo.name : (m.channel_name || m.channel_id)
    };
  });
  
  return {
    messages: normalized,
    targetId: messageId,
    channel_id: target.channel_id,
    channel_name: registry[target.channel_id]?.name || target.channel_id
  };
}

// Update message is_traded status
export function markMessageTraded(id, status = 1) {
  const stmt = getCachedStmt('UPDATE messages SET is_traded = ? WHERE id = ?');
  stmt.run(status, id);
}

// Update message is_pushed status
export function markMessagePushed(id, status = 1) {
  const stmt = getCachedStmt('UPDATE messages SET is_pushed = ? WHERE id = ?');
  stmt.run(status, id);
}

// ==========================================================================
// 画像引擎数据查询 API
// ==========================================================================

/**
 * 获取排除指定发言人之外的所有消息（群友消息）
 * 用于提取社区洞察
 */
export function getMessagesExcludingSpeakers(excludeSenderIds = [], { limit = 5000, offset = 0, startDate = '', endDate = '' } = {}) {
  const conn = getDb();
  const clauses = [];
  const params = [];

  if (Array.isArray(excludeSenderIds) && excludeSenderIds.length > 0) {
    const placeholders = excludeSenderIds.map(() => '?').join(',');
    clauses.push(`sender_id NOT IN (${placeholders})`);
    params.push(...excludeSenderIds);
  }

  // Filter out very short/empty messages
  clauses.push('LENGTH(TRIM(content)) > 5');

  if (startDate) {
    const startMs = new Date(`${startDate}T00:00:00`).getTime();
    if (!isNaN(startMs)) {
      clauses.push('created_at >= ?');
      params.push(startMs);
    }
  }

  if (endDate) {
    const endMs = new Date(`${endDate}T23:59:59.999`).getTime();
    if (!isNaN(endMs)) {
      clauses.push('created_at <= ?');
      params.push(endMs);
    }
  }

  let query = 'SELECT * FROM messages';
  if (clauses.length > 0) {
    query += ' WHERE ' + clauses.join(' AND ');
  }
  query += ' ORDER BY created_at ASC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return conn.prepare(query).all(...params);
}

/**
 * 动态查询 mrzhoulucky 关联的所有 sender_id
 */
export function getLuckyUserIds() {
  const conn = getDb();
  const rows = conn.prepare(`
    SELECT DISTINCT sender_id 
    FROM messages 
    WHERE sender_name LIKE '%mrzhoulucky%' 
       OR sender_name LIKE '%zhouzhoulucky%'
  `).all();
  return rows.map(r => r.sender_id);
}

/**
 * 获取特定群友（如 mrzhoulucky）的全部消息
 */
export function getSpecificCommunityMessages(senderIds = [], { limit = 5000, startDate = '', endDate = '' } = {}) {
  const conn = getDb();
  if (!senderIds || senderIds.length === 0) return [];
  
  const clauses = [];
  const params = [];
  
  const placeholders = senderIds.map(() => '?').join(',');
  clauses.push(`sender_id IN (${placeholders})`);
  params.push(...senderIds);
  
  if (startDate) {
    const startMs = new Date(`${startDate}T00:00:00`).getTime();
    if (!isNaN(startMs)) {
      clauses.push('created_at >= ?');
      params.push(startMs);
    }
  }

  if (endDate) {
    const endMs = new Date(`${endDate}T23:59:59.999`).getTime();
    if (!isNaN(endMs)) {
      clauses.push('created_at <= ?');
      params.push(endMs);
    }
  }
  
  let query = 'SELECT * FROM messages';
  if (clauses.length > 0) {
    query += ' WHERE ' + clauses.join(' AND ');
  }
  query += ' ORDER BY created_at ASC LIMIT ?';
  params.push(limit);
  
  return conn.prepare(query).all(...params);
}

/**
 * 获取排除指定发言人和特定群友之外的，且包含特定讨论关键字的消息
 */
export function getFilteredCommunityMessages(excludeSenderIds = [], { limit = 5000, startDate = '', endDate = '' } = {}) {
  const conn = getDb();
  const clauses = [];
  const params = [];

  if (Array.isArray(excludeSenderIds) && excludeSenderIds.length > 0) {
    const placeholders = excludeSenderIds.map(() => '?').join(',');
    clauses.push(`sender_id NOT IN (${placeholders})`);
    params.push(...excludeSenderIds);
  }

  // Filter out very short/empty messages
  clauses.push('LENGTH(TRIM(content)) > 5');

  // Add keyword filters for valuable tool/strategy discussions
  const keywords = ['工具', '策略', '量化', '代码', '开发', '数据', '系统', '回测', 'Cursor', 'API', '接口', '指标', '券商', '回放'];
  const kwClauses = keywords.map(() => 'content LIKE ?').join(' OR ');
  clauses.push(`(${kwClauses})`);
  keywords.forEach(kw => params.push(`%${kw}%`));

  if (startDate) {
    const startMs = new Date(`${startDate}T00:00:00`).getTime();
    if (!isNaN(startMs)) {
      clauses.push('created_at >= ?');
      params.push(startMs);
    }
  }

  if (endDate) {
    const endMs = new Date(`${endDate}T23:59:59.999`).getTime();
    if (!isNaN(endMs)) {
      clauses.push('created_at <= ?');
      params.push(endMs);
    }
  }

  let query = 'SELECT * FROM messages';
  if (clauses.length > 0) {
    query += ' WHERE ' + clauses.join(' AND ');
  }
  query += ' ORDER BY created_at ASC LIMIT ?';
  params.push(limit);

  return conn.prepare(query).all(...params);
}

/**
 * 获取指定发言人的所有消息，按时间正序排列
 * 用于时间线事件分段
 */
export function getAllSpeakerMessagesChronological(senderIds = [], { limit = 10000, startDate = '', endDate = '' } = {}) {
  const conn = getDb();
  const clauses = [];
  const params = [];

  if (Array.isArray(senderIds) && senderIds.length > 0) {
    const placeholders = senderIds.map(() => '?').join(',');
    clauses.push(`sender_id IN (${placeholders})`);
    params.push(...senderIds);
  }

  if (startDate) {
    const startMs = new Date(`${startDate}T00:00:00`).getTime();
    if (!isNaN(startMs)) {
      clauses.push('created_at >= ?');
      params.push(startMs);
    }
  }

  if (endDate) {
    const endMs = new Date(`${endDate}T23:59:59.999`).getTime();
    if (!isNaN(endMs)) {
      clauses.push('created_at <= ?');
      params.push(endMs);
    }
  }

  let query = 'SELECT * FROM messages';
  if (clauses.length > 0) {
    query += ' WHERE ' + clauses.join(' AND ');
  }
  query += ' ORDER BY created_at ASC LIMIT ?';
  params.push(limit);

  return conn.prepare(query).all(...params);
}

/**
 * 获取最新的画像白皮书报告
 */
export function getLatestPersonaPlaybook() {
  return getLatestReportForStrategy('PERSONA_PLAYBOOK');
}

/**
 * 获取指定消息ID前后的上下文消息（包含群友消息）
 * 用于画像引擎获取每条大V消息的群友对话上下文
 */
export function getContextAroundMessages(messageIds, contextBefore = 3, contextAfter = 1) {
  const conn = getDb();
  const results = new Map();

  for (const msgId of messageIds) {
    const targetMsg = conn.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
    if (!targetMsg) continue;

    const before = conn.prepare(`
      SELECT * FROM messages
      WHERE created_at < ? AND channel_id = ?
      ORDER BY created_at DESC LIMIT ?
    `).all(targetMsg.created_at, targetMsg.channel_id, contextBefore);

    const after = conn.prepare(`
      SELECT * FROM messages
      WHERE created_at > ? AND channel_id = ? AND id != ?
      ORDER BY created_at ASC LIMIT ?
    `).all(targetMsg.created_at, targetMsg.channel_id, msgId, contextAfter);

    results.set(msgId, {
      before: before.reverse(),
      target: targetMsg,
      after
    });
  }

  return results;
}

/**
 * 获取数据库中所有唯一的频道信息 (channel_id 和 channel_name)
 * 🏛️ 强制通过权威登记册收口为 1:1 规范名称
 */
export function getDistinctChannels() {
  const conn = getDb();
  const rows = conn.prepare(`
    SELECT DISTINCT channel_id
    FROM messages 
    WHERE channel_id IS NOT NULL AND channel_id != ''
  `).all();

  const registry = getChannelRegistryMap();
  return rows.map(r => ({
    channel_id: r.channel_id,
    channel_name: registry[r.channel_id]?.name || r.channel_id
  }));
}

/**
 * 获取当前每日 API 调用计数 (不递增)
 */
export function getDailyApiCount() {
  const db = getDb();
  // 使用北京时间本地日期 (sv-SE 格式化输出 YYYY-MM-DD)
  const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const row = db.prepare("SELECT value FROM portfolio WHERE key = ?").get(`gemini_requests_${todayStr}`);
  
  if (row && parseInt(row.value, 10) > 0) {
    return parseInt(row.value, 10);
  }
  
  // 容灾兜底：查寻近 24 小时内的打点，防止跨天衔接漏洞
  const fallbackRow = db.prepare("SELECT value FROM portfolio WHERE key LIKE 'gemini_requests_%' ORDER BY key DESC LIMIT 1").get();
  return fallbackRow ? parseInt(fallbackRow.value, 10) : 0;
}

/**
 * 递增每日 API 调用计数 (仅在确认未超限时调用)
 */
export function incrementDailyApiCount() {
  const db = getDb();
  const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });

  db.prepare(`
    INSERT INTO portfolio (key, value) VALUES (?, 1)
    ON CONFLICT(key) DO UPDATE SET value = value + 1
  `).run(`gemini_requests_${todayStr}`);

  return getDailyApiCount();
}

/**
 * 保存一条新的资讯总结
 */
export function saveNewsSummary(summary) {
  const conn = getDb();
  const stmt = conn.prepare(`
    INSERT INTO news_summaries (batch_id, summary_type, title, start_time, end_time, summary_content, raw_messages_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = Date.now();
  const info = stmt.run(
    summary.batchId,
    summary.summaryType,
    summary.title,
    summary.startTime,
    summary.endTime,
    summary.summaryContent,
    summary.rawMessagesCount || null,
    now
  );
  return info.lastInsertRowid;
}

/**
 * 获取历史资讯总结列表
 */
export function getNewsSummaries(limit = 10, offset = 0) {
  limit = Math.max(1, Math.min(500, parseInt(limit, 10) || 10));
  offset = Math.max(0, parseInt(offset, 10) || 0);
  const conn = getDb();
  return conn.prepare(`
    SELECT * FROM news_summaries 
    ORDER BY created_at DESC 
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}

/**
 * 获取最新一期资讯总结 (可按类型过滤)
 */
export function getLatestNewsSummary(type = null) {
  const conn = getDb();
  if (type) {
    return conn.prepare(`
      SELECT * FROM news_summaries 
      WHERE summary_type = ? 
      ORDER BY created_at DESC LIMIT 1
    `).get(type);
  } else {
    return conn.prepare(`
      SELECT * FROM news_summaries 
      ORDER BY created_at DESC LIMIT 1
    `).get();
  }
}


