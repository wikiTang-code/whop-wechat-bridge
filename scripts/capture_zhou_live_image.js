import dotenv from 'dotenv';
import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { initDb, getDb } from '../database.js';

dotenv.config();
initDb();

console.log('========================================================================================');
console.log('📸 周一实盘活链抓图验收：捕捉周哥 8:02 券商隔夜成交条图片并落盘质检');
console.log('========================================================================================\n');

const cookie = process.env.WHOP_COOKIE || '';
const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

async function webFetch(url, options = {}) {
  const agent = url.startsWith('https') ? httpsAgent : httpAgent;
  return fetch(url, { agent, ...options });
}

const MESSAGES_FETCH_FEED_POSTS_QUERY = `
query MessagesFetchFeedPosts($feedType: FeedTypes!, $after: BigInt, $before: BigInt, $aroundId: ID, $feedId: ID!, $includeDeleted: Boolean, $includeReactions: Boolean, $limit: Int, $direction: Direction) {
  feedPosts(
    feedType: $feedType
    after: $after
    before: $before
    aroundId: $aroundId
    feedId: $feedId
    includeDeleted: $includeDeleted
    includeReactions: $includeReactions
    limit: $limit
    direction: $direction
  ) {
    posts {
      __typename
      ... on DmsPost {
        id
        createdAt
        content
        attachments {
          ...Attachment
        }
        user {
          id
          name
          username
        }
      }
      ... on ForumPost {
        id
        createdAt
        title
        content
        attachments {
          ...Attachment
        }
        user {
          id
          name
          username
        }
      }
    }
  }
}

fragment Attachment on AttachmentInterface {
  __typename
  id
  signedId
  contentType
  byteSizeV2
  source(variant: original) {
    url
  }
}
`;

async function runZhouCapture() {
  const channelId = 'chat_feed_1CTr5VAdNHtbZAFaTitvoT'; // 不用翻墙美股讨论区

  console.log('📡 正在从 Whop API 获取讨论区最新消息 (寻找 Mrzhoulucky 发言与最新带图帖)...');
  const response = await webFetch('https://whop.com/api/graphql/MessagesFetchFeedPosts/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookie,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    body: JSON.stringify({
      query: MESSAGES_FETCH_FEED_POSTS_QUERY,
      variables: {
        feedId: channelId,
        feedType: 'chat_feed',
        limit: 50,
        before: null,
        direction: 'desc',
        includeDeleted: false
      },
      operationName: 'MessagesFetchFeedPosts'
    })
  });

  if (!response.ok) {
    console.error(`❌ 获取失败: HTTP ${response.status}`);
    process.exit(1);
  }

  const resJson = await response.json();
  if (resJson.errors) {
    console.error('GraphQL 错误:', JSON.stringify(resJson.errors, null, 2));
  }

  const posts = resJson.data?.feedPosts?.posts || [];
  console.log(`📥 获取到 ${posts.length} 条最新讨论区消息：\n`);

  let targetPosts = [];
  for (const post of posts) {
    const sender = post.user?.name || post.user?.username || '';
    const hasAttachments = Array.isArray(post.attachments) && post.attachments.length > 0;
    const etDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(new Date(Number(post.createdAt)));

    console.log(`[${etDate}] ID: ${post.id.padEnd(25)} | 发言人: ${sender.padEnd(16)} | 附件数: ${post.attachments?.length || 0} | 文本: ${(post.content || post.title || '(无文本)').slice(0, 40)}`);

    if (hasAttachments || sender.toLowerCase().includes('zhou')) {
      targetPosts.push(post);
    }
  }

  if (targetPosts.length === 0) {
    console.log('\n⚠️ 最近 50 条消息中未发现带附件或周哥的帖子。');
    return;
  }

  console.log('\n========================================================================================');
  console.log(`🎯 检测到 ${targetPosts.length} 条目标帖子，开始执行逐条下载与门禁质检：`);
  console.log('========================================================================================\n');

  const KNOWN_SKELETON_SHAS = new Set([
    '0804573d',
    '5f4dd331',
    'e3b0c442',
    'd41d8cd9'
  ]);

  const capturedResults = [];

  for (const targetPost of targetPosts) {
    if (!targetPost.attachments || targetPost.attachments.length === 0) continue;

    const sender = targetPost.user?.name || targetPost.user?.username || 'unknown';
    const subDir = sender.toLowerCase().includes('zhou') ? 'zhou' : 'general';
    const etDateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(Number(targetPost.createdAt)));

    const targetDir = path.resolve(`data/media/${subDir}/${etDateStr}`);
    fs.mkdirSync(targetDir, { recursive: true });

    for (let idx = 0; idx < targetPost.attachments.length; idx++) {
      const att = targetPost.attachments[idx];
      const rawUrl = att.source?.url || '';
      if (!rawUrl) continue;

      console.log(`⬇️ [${targetPost.id}] 正在下载附件 [${idx + 1}]: ${rawUrl.slice(0, 80)}...`);

      const imgRes = await webFetch(rawUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        }
      });

      if (!imgRes.ok) {
        console.error(`❌ 下载附件失败: HTTP ${imgRes.status}`);
        continue;
      }

      const arrayBuffer = await imgRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const byteSize = buffer.length;
      const sizeKb = (byteSize / 1024).toFixed(1);

      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      const shortSha = sha256.slice(0, 8);

      const outFilename = `${targetPost.id}_${idx}.jpg`;
      const outPath = path.join(targetDir, outFilename);
      fs.writeFileSync(outPath, buffer);

      // 门禁质检
      let isPassed = true;
      let failReason = null;

      if (byteSize <= 15360) {
        isPassed = false;
        failReason = `文件过小 (${sizeKb} KB <= 15KB)，判定为骨架屏或表情包`;
      } else if (KNOWN_SKELETON_SHAS.has(shortSha)) {
        isPassed = false;
        failReason = `命中骨架屏哈希黑名单 (${shortSha})`;
      }

      capturedResults.push({
        post_id: targetPost.id,
        attachment_index: idx,
        file_name: outFilename,
        saved_path: outPath,
        byte_size: byteSize,
        size_kb: sizeKb,
        sha256_full: sha256,
        sha256_short: shortSha,
        gate_passed: isPassed,
        fail_reason: failReason,
        created_at: Number(targetPost.createdAt),
        sender: sender
      });

      // 写入数据库 messages.attachments 元数据
      try {
        const db = getDb();
        db.prepare(`
          UPDATE messages 
          SET attachments = ? 
          WHERE id = ?
        `).run(JSON.stringify([{
          url: rawUrl,
          local_path: outPath,
          byte_size: byteSize,
          sha256: sha256,
          gate_passed: isPassed
        }]), targetPost.id);
        console.log(`💾 附件元数据已成功写入数据库 messages.attachments (ID: ${targetPost.id})`);
      } catch (dbErr) {}
    }
  }

  console.log('\n========================================================================================');
  console.log('📋 【周一活会话抓图验收】三行账交底：');
  console.log('========================================================================================\n');

  capturedResults.forEach((r, i) => {
    console.log(`[账目 ${i + 1}] 发言人: ${r.sender}`);
    console.log(`   - post_id : ${r.post_id}`);
    console.log(`   - 字节大小 : ${r.byte_size} 字节 (${r.size_kb} KB) ${r.byte_size > 15360 ? '✅ >15KB' : '❌ <=15KB'}`);
    console.log(`   - 物理 SHA : ${r.sha256_short} (Full: ${r.sha256_full}) ${r.gate_passed ? '✅ 门禁通过' : '❌ 拦截: ' + r.fail_reason}`);
    console.log(`   - 落盘路径 : ${r.saved_path}\n`);
  });

  const reportOut = 'data/media/zhou/live_capture_report_latest.json';
  fs.mkdirSync(path.dirname(reportOut), { recursive: true });
  fs.writeFileSync(reportOut, JSON.stringify(capturedResults, null, 2), 'utf-8');
  console.log(`📄 验收报告已落盘: ${reportOut}\n`);
}

runZhouCapture();
