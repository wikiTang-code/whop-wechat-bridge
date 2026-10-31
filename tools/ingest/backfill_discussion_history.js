/**
 * tools/ingest/backfill_discussion_history.js
 * 专项历史数据回溯工具：补齐「不用翻墙美股讨论区」等频道的历史盲区
 */

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { saveMessages } from '../../database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');

const monitorSrc = fs.readFileSync(path.join(ROOT_DIR, 'monitor.js'), 'utf8');
const queryMatch = monitorSrc.match(/const MESSAGES_FETCH_FEED_POSTS_QUERY = `([\s\S]*?)`;/);
const MESSAGES_FETCH_FEED_POSTS_QUERY = queryMatch[1];

// 命令行参数
const args = process.argv.slice(2);
function getArg(flag, defaultVal) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const TARGET_CHANNEL_ID = getArg('--channel', 'chat_feed_1CTr5VAdNHtbZAFaTitvoT');
const MAX_PAGES = parseInt(getArg('--max-pages', '2000'), 10); // 默认最多回溯 2000 页 (10万条)
const PAGE_SIZE = 50;
const DELAY_MS = 350;

async function runBackfill() {
  const cookie = process.env.WHOP_COOKIE;
  if (!cookie) {
    console.error('❌ 缺少 WHOP_COOKIE，无法调用 Whop GraphQL API');
    process.exit(1);
  }

  // 1. 查询当前频道在库中的最早时间戳
  const dbPath = process.env.SQLITE_PATH || path.join(ROOT_DIR, 'whop_archive.db');
  const db = new Database(dbPath, { readonly: true });
  const minRow = db.prepare('SELECT MIN(created_at) as min_ts, COUNT(*) as cnt FROM messages WHERE channel_id = ?').get(TARGET_CHANNEL_ID);
  db.close();

  let beforeCursor = null;
  if (minRow && minRow.min_ts) {
    beforeCursor = minRow.min_ts.toString();
    console.log(`[Backfill] 目标频道: ${TARGET_CHANNEL_ID}`);
    console.log(`[Backfill] 库中现有消息数: ${minRow.cnt} 条 | 最早时间戳: ${minRow.min_ts} (${new Date(Number(minRow.min_ts)).toISOString()})`);
    console.log(`[Backfill] 将从 ${new Date(Number(minRow.min_ts)).toISOString()} 开始向前回溯...`);
  } else {
    console.log(`[Backfill] 库中无该频道记录，从最新消息向前回溯...`);
  }

  let totalFetched = 0;
  let totalSaved = 0;
  let zhaoCount = 0;
  let consecutiveEmptyPages = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const cursorDisplay = beforeCursor ? new Date(Number(beforeCursor)).toISOString() : 'LATEST';
    process.stdout.write(`[第 ${page} 页] 正在拉取 (游标 before: ${cursorDisplay})... `);

    let resJson = null;
    let retries = 3;
    while (retries > 0) {
      try {
        const response = await fetch('https://whop.com/api/graphql/MessagesFetchFeedPosts/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': cookie,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          body: JSON.stringify({
            query: MESSAGES_FETCH_FEED_POSTS_QUERY,
            variables: {
              feedId: TARGET_CHANNEL_ID,
              feedType: TARGET_CHANNEL_ID.startsWith('forum_feed_') ? 'forum_feed' : 'chat_feed',
              limit: PAGE_SIZE,
              before: beforeCursor,
              direction: 'desc',
              includeDeleted: false
            },
            operationName: 'MessagesFetchFeedPosts'
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        resJson = await response.json();
        break;
      } catch (err) {
        retries--;
        console.warn(`网络抖动 (${err.message})，剩余重试 ${retries} 次...`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (!resJson || !resJson.data?.feedPosts) {
      console.log(`❌ 无法获取数据，退出。`);
      break;
    }

    const posts = resJson.data.feedPosts.posts || [];
    const users = resJson.data.feedPosts.users || [];

    if (posts.length === 0) {
      consecutiveEmptyPages++;
      console.log(`⚪ 已经没有更早的消息了 (已到达创群第一条或最早记录)。`);
      if (consecutiveEmptyPages >= 2) break;
      continue;
    }
    consecutiveEmptyPages = 0;

    // 用户字典
    const userMap = new Map();
    if (Array.isArray(users)) {
      for (const u of users) {
        userMap.set(u.id, u.name || u.username || 'Unknown User');
      }
    }

    // 格式化消息为 saveMessages 接收格式
    const formattedMessages = [];
    for (const post of posts) {
      const timeNum = Number(post.createdAt || Date.now());
      const timeMs = timeNum < 9999999999 ? timeNum * 1000 : timeNum;

      let content = post.content || '';
      if (post.title) {
        content = `【${post.title}】\n${content}`;
      }
      if (Array.isArray(post.attachments)) {
        const imageUrls = post.attachments
          .filter(a => a.contentType?.startsWith('image/') || a.__typename === 'ImageAttachment')
          .map(a => a.source?.url)
          .filter(Boolean);
        if (imageUrls.length > 0) {
          content += '\n' + imageUrls.map(url => `[IMAGE:${url}]`).join('\n');
        }
      }

      const senderId = post.userId || 'unknown';
      const senderName = userMap.get(post.userId) || post.customAuthor?.displayName || 'Unknown User';
      if (senderId === 'user_4yeplXgbguTu4') {
        zhaoCount++;
      }

      formattedMessages.push({
        id: post.id,
        channel_id: TARGET_CHANNEL_ID,
        channel_name: '不用翻墙美股讨论区',
        sender_id: senderId,
        sender_name: senderName,
        content: content,
        created_at: timeMs,
        attachments: post.attachments || null
      });
    }

    // 批量存入数据库
    const saved = await saveMessages(formattedMessages, { chunkSize: 50, yieldEventLoop: false });
    totalFetched += posts.length;
    totalSaved += saved;

    const oldestOfPage = posts[posts.length - 1];
    beforeCursor = oldestOfPage.createdAt.toString();
    const oldestDateStr = new Date(Number(oldestOfPage.createdAt)).toISOString().slice(0, 19).replace('T', ' ');

    console.log(`✅ 拉取 ${posts.length} 条 (入库: ${saved}) | 最早到达: ${oldestDateStr} | 赵哥累计: ${zhaoCount} 条`);

    // 适度冷却
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log(`\n============================================================`);
  console.log(`🎉 [回溯完成] 历史数据补齐任务执行完毕！`);
  console.log(`- 总拉取消息数: ${totalFetched}`);
  console.log(`- 成功入库数: ${totalSaved}`);
  console.log(`- 包含赵哥发言: ${zhaoCount} 条`);
}

runBackfill().catch(console.error);
