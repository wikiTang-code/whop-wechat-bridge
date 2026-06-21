import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'whop_archive.db');
let db;

const CHANNEL_NAME_FALLBACKS = {
  'chat_feed_1CTr5VAdNHtbZAFaTitvoT': '不用翻墙美股讨论区',
  'chat_feed_1CTr7QocNpDZ9FXZ6fvWe4': '不用翻墙美股发布',
  'chat_feed_1CTrCEx44dP13jW3RVkYiS': '不用翻墙期权',
  'chat_feed_1CWLuNUVYVVYttro8gAvJ5': '历史股票期权记录区',
  'chat_feed_1CU95KbtifP1JtuqTiVXZb': '讨论区股票记录'
};

export function initDb() {
  db = new Database(dbPath, { timeout: 10000 });
  
  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 10000');

  // Create messages table
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

  // Migration: Add channel_name column if it doesn't exist
  try {
    db.prepare("ALTER TABLE messages ADD COLUMN channel_name TEXT").run();
    console.log("Migration: Added channel_name column to messages table.");
  } catch (err) {
    if (!err.message.includes('duplicate column name')) {
      console.warn("Migration warning for messages table:", err.message);
    }
  }

  // Migration: Add tickers, sectors, strategies columns if they don't exist
  const cols = ['tickers', 'sectors', 'strategies'];
  for (const col of cols) {
    try {
      db.prepare(`ALTER TABLE messages ADD COLUMN ${col} TEXT`).run();
      console.log(`Migration: Added ${col} column to messages table.`);
    } catch (err) {
      if (!err.message.includes('duplicate column name')) {
        console.warn(`Migration warning for column ${col}:`, err.message);
      }
    }
  }

  // Migration: Add is_traded and is_pushed columns if they don't exist
  try {
    db.prepare("ALTER TABLE messages ADD COLUMN is_traded INTEGER DEFAULT 0").run();
    console.log("Migration: Added is_traded column to messages table.");
  } catch (err) {
    if (!err.message.includes('duplicate column name')) {
      console.warn("Migration warning for is_traded:", err.message);
    }
  }

  try {
    db.prepare("ALTER TABLE messages ADD COLUMN is_pushed INTEGER DEFAULT 0").run();
    console.log("Migration: Added is_pushed column to messages table.");
  } catch (err) {
    if (!err.message.includes('duplicate column name')) {
      console.warn("Migration warning for is_pushed:", err.message);
    }
  }

  // Create indices on search columns
  try {
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_tickers ON messages(tickers)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_sectors ON messages(sectors)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_strategies ON messages(strategies)`).run();
  } catch (err) {
    console.warn("Indices creation warning:", err.message);
  }

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

  // Migration: Add strategy column to reports table if it doesn't exist
  try {
    db.prepare("ALTER TABLE reports ADD COLUMN strategy TEXT").run();
    console.log("Migration: Added strategy column to reports table.");
  } catch (err) {
    if (!err.message.includes('duplicate column name')) {
      console.warn("Migration warning for reports table:", err.message);
    }
  }

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

  // Backfill FTS index with existing messages
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

  console.log('SQLite Database initialized successfully at:', dbPath);
}

// Get the database instance
export function getDb() {
  if (!db) initDb();
  return db;
}

// Save messages to database
export function saveMessages(messages) {
  const conn = getDb();
  const insert = conn.prepare(`
    INSERT OR IGNORE INTO messages (id, channel_id, channel_name, sender_id, sender_name, content, created_at, tickers, sectors, strategies)
    VALUES (@id, @channel_id, @channel_name, @sender_id, @sender_name, @content, @created_at, @tickers, @sectors, @strategies)
  `);

  const insertMany = conn.transaction((msgs) => {
    for (const msg of msgs) {
      const dims = extractTradingDimensions(msg.content);
      let channelName = msg.channel_name;
      if (!channelName || channelName.startsWith('频道:')) {
        channelName = CHANNEL_NAME_FALLBACKS[msg.channel_id] || channelName;
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
        strategies: dims.strategies
      });
    }
  });

  insertMany(messages);
}

// Check if a message is already in the database
export function isMessageArchived(id) {
  const conn = getDb();
  const row = conn.prepare('SELECT 1 FROM messages WHERE id = ?').get(id);
  return !!row;
}

// Retrieve messages with optional search and pagination and speaker filtering
export function getMessages({ search, limit = 50, offset = 0, senderIds = [], excludeSenderIds = [], channelId = '', channelName = '', ticker = '', sector = '', strategy = '', startDate = '', endDate = '' } = {}) {
  const conn = getDb();
  let query = 'SELECT * FROM messages';
  let countQuery = 'SELECT COUNT(*) as count FROM messages';
  const params = [];
  const clauses = [];

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

  const messages = stmt.all(...params, limit, offset);
  const total = countStmt.get(...params)?.count || 0;

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

// Extract trading dimensions (tickers, sectors, strategies) from content
export function extractTradingDimensions(content) {
  if (!content) return { tickers: '', sectors: '', strategies: '' };
  
  // Sector mapping
  const sectorMapping = {
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

  const tickersFound = new Set();

  // 1. Match known mapped tickers case-insensitively to capture lowercase inputs like 'lite', 'tsla'
  const knownTickers = Object.keys(sectorMapping);
  for (const ticker of knownTickers) {
    const regex = new RegExp(`\\b\\$?${ticker}\\b`, 'i');
    if (regex.test(content)) {
      tickersFound.add(ticker);
    }
  }

  // 2. Fallback to match other uppercase words (e.g. unknown new tickers)
  const stopWords = new Set([
    'BUY', 'SELL', 'CALL', 'PUT', 'GET', 'POST', 'JSON', 'USD', 'CAD', 'ETF', 'API', 
    'REST', 'HTML', 'CSS', 'JS', 'AI', 'GPT', 'USA', 'SEC', 'FED', 'FOMC', 'GDP', 
    'CPI', 'PPI', 'PMI', 'VIX', 'FOR', 'AND', 'THE', 'YOU', 'OUR', 'NOW', 'BUT'
  ]);
  
  const tickerRegex = /\b\$?([A-Z]{2,5})\b/g;
  let match;
  while ((match = tickerRegex.exec(content)) !== null) {
    const sym = match[1].toUpperCase();
    if (!stopWords.has(sym)) {
      tickersFound.add(sym);
    }
  }
  
  const sectorsFound = new Set();
  tickersFound.forEach(t => {
    if (sectorMapping[t]) {
      sectorsFound.add(sectorMapping[t]);
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
    SELECT id, content FROM messages
    WHERE id NOT IN (SELECT id FROM message_embeddings)
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}

export function getEmbeddingsCount() {
  const conn = getDb();
  return conn.prepare('SELECT COUNT(*) as count FROM message_embeddings').get()?.count || 0;
}

export function searchFTSMessages(queryText, limit = 30, senderIds = []) {
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
  
  // 2. 查出在此之前最邻近的 limit 条消息
  const before = conn.prepare(`
    SELECT * FROM messages 
    WHERE channel_id = ? AND created_at < ? 
    ORDER BY created_at DESC LIMIT ?
  `).all(target.channel_id, target.created_at, limit);
  
  // 3. 查出在此之后最邻近的 limit 条消息
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
  
  return {
    messages: combined,
    targetId: messageId
  };
}

// Update message is_traded status
export function markMessageTraded(id, status = 1) {
  const conn = getDb();
  conn.prepare('UPDATE messages SET is_traded = ? WHERE id = ?').run(status, id);
}

// Update message is_pushed status
export function markMessagePushed(id, status = 1) {
  const conn = getDb();
  conn.prepare('UPDATE messages SET is_pushed = ? WHERE id = ?').run(status, id);
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
 */
export function getDistinctChannels() {
  const conn = getDb();
  return conn.prepare(`
    SELECT DISTINCT channel_id, channel_name 
    FROM messages 
    WHERE channel_id IS NOT NULL AND channel_id != ''
  `).all();
}

