import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import https from 'https';
import http from 'http';
import dotenv from 'dotenv';
import { sniffFormat, extensionForFormat } from '../monitoring/wechat-image-prepare.js';

dotenv.config();

const BLACKLIST_PREFIXES = ['0804573d', '5f4dd331'];
const MANIFEST_PATH = path.resolve('data/media/zhao/media_manifest.json');

/**
 * 转换时间戳为严格美东日期 (YYYY-MM-DD)
 */
function getEtDate(timestamp) {
  try {
    const d = new Date(timestamp || Date.now());
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(d);
  } catch (e) {
    return new Date(timestamp || Date.now()).toISOString().slice(0, 10);
  }
}

/**
 * 尝试从 imgproxy 包装中还原 S3 原始图片直连地址
 * 例如: https://img-v2-prod.whop.com/.../plain/https%3A%2F%2Fassets-2-prod.whop.com%2F...
 */
export function extractRawMediaUrl(url) {
  if (!url || typeof url !== 'string') return url;
  const match = url.match(/https?:\/\/[^\/]+\/[^\/]+\/plain\/(https?%3A%2F%2F.+)$/i);
  if (match && match[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch (e) {
      return url;
    }
  }
  return url;
}

/**
 * 底层 HTTP/HTTPS 下载 Buffer
 */
function fetchHttpBuffer(targetUrl) {
  return new Promise((resolve, reject) => {
    const client = targetUrl.startsWith('https') ? https : http;
    const cookie = process.env.WHOP_COOKIE || '';

    const req = client.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/png,image/jpeg;q=0.9,image/*;q=0.8',
        'Referer': 'https://whop.com/',
        'Cookie': cookie
      },
      timeout: 12000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchHttpBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Download timeout (12s)'));
    });
  });
}

/**
 * 下载二进制 Buffer (优先直连 S3 原始高清 PNG/JPG，杜绝 CDN 默认转 AVIF 导致企微无法内联)
 */
export async function downloadBuffer(url) {
  const rawUrl = extractRawMediaUrl(url);
  if (rawUrl && rawUrl !== url) {
    try {
      const rawBuf = await fetchHttpBuffer(rawUrl);
      if (rawBuf && rawBuf.length > 0) {
        return rawBuf;
      }
    } catch (err) {
      console.warn(`[MediaDownloader] 直连原始图片失败 (${err.message})，回退至代理网关:`, url.slice(0, 80));
    }
  }
  return fetchHttpBuffer(url);
}

/**
 * 更新或追加条目至 data/media/zhao/media_manifest.json
 */
function updateManifestEntry(entry) {
  try {
    let manifest = [];
    if (fs.existsSync(MANIFEST_PATH)) {
      try {
        manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
      } catch (e) {
        manifest = [];
      }
    }

    const existingIndex = manifest.findIndex(m => m.message_id === entry.message_id && m.sha256 === entry.sha256);
    if (existingIndex >= 0) {
      manifest[existingIndex] = { ...manifest[existingIndex], ...entry };
    } else {
      entry.index = manifest.length + 1;
      manifest.push(entry);
    }

    fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8');
  } catch (err) {
    console.error('[MediaDownloader] 写入 media_manifest.json 失败:', err.message);
  }
}

/**
 * 实时同步下载并落盘消息中的媒体附件 (行业级进库当刻落地)
 * @param {Object} msg 归一化消息对象 { id, channel_id, created_at, content, rawAttachments }
 * @returns {Promise<Array>} 带有 local_path / sha256 / status 的结构化 attachments 列表
 */
export async function downloadAndPersistAttachments(msg) {
  const rawUrls = new Set();

  // 1. 从 rawAttachments 提取 (过滤 s128_square, s64_square 等头像缩略图)
  if (Array.isArray(msg.rawAttachments)) {
    msg.rawAttachments.forEach(a => {
      const u = a.url || a.source?.url || a.plain_url;
      if (u && typeof u === 'string') {
        if (!u.includes('s128_square') && !u.includes('s64_square') && !u.includes('bots') && !u.includes('avatar')) {
          rawUrls.add(u);
        }
      }
    });
  }

  // 2. 从 content [IMAGE:...] 提取
  const regex = /\[IMAGE:(https?:\/\/[^\]]+)\]/g;
  let match;
  while ((match = regex.exec(msg.content)) !== null) {
    const u = match[1];
    if (!u.includes('s128_square') && !u.includes('s64_square') && !u.includes('bots') && !u.includes('avatar')) {
      rawUrls.add(u);
    }
  }

  if (rawUrls.size === 0) return null;

  const urlList = Array.from(rawUrls);
  // 美东时区 YYYY-MM-DD
  const etDate = getEtDate(msg.created_at);
  const dirPath = path.join('data/media/zhao', etDate);
  const results = [];

  for (let i = 0; i < urlList.length; i++) {
    const rawUrl = urlList[i];

    try {
      const buf = await downloadBuffer(rawUrl);
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      const isBlacklist = BLACKLIST_PREFIXES.some(pfx => sha.startsWith(pfx));

      if (buf.length > 15 * 1024 && !isBlacklist) {
        fs.mkdirSync(dirPath, { recursive: true });
        const ext = extensionForFormat(sniffFormat(buf));
        const fileName = `${msg.id}_${i}.${ext}`;
        const localPath = path.join(dirPath, fileName).replace(/\\/g, '/');
        fs.writeFileSync(localPath, buf);

        console.log(`[MediaDownloader] ✅ 进库当刻成功落盘附件 (美东 ${etDate}): ${localPath} (${(buf.length/1024).toFixed(1)} KB, SHA: ${sha.slice(0, 8)})`);

        const entry = {
          message_id: msg.id,
          cu_id: msg.cu_id || null,
          channel_id: msg.channel_id || 'chat_feed_1CU95KbtifP1JtuqTiVXZb',
          et_date: etDate,
          status: 'ok',
          sha256: sha,
          bytes: buf.length,
          width: null,
          height: null,
          raw_url: rawUrl,
          local_path: localPath
        };

        // 同步更新 manifest
        updateManifestEntry(entry);

        results.push({
          index: i,
          raw_url: rawUrl,
          local_path: localPath,
          sha256: sha,
          bytes: buf.length,
          status: 'ok'
        });
      } else {
        console.warn(`[MediaDownloader] ⚠️ 拦截无效图片 (${buf.length} 字节, 骨架屏或过小): ${rawUrl.slice(0, 60)}...`);
        results.push({
          index: i,
          raw_url: rawUrl,
          local_path: null,
          sha256: sha,
          bytes: buf.length,
          status: 'placeholder_blocked'
        });
      }
    } catch (err) {
      console.error(`[MediaDownloader] ❌ 下载附件失败 (${err.message}): ${rawUrl.slice(0, 60)}...`);
      results.push({
        index: i,
        raw_url: rawUrl,
        local_path: null,
        sha256: null,
        bytes: 0,
        status: 'missing',
        error: err.message
      });
    }
  }

  return results.length > 0 ? results : null;
}
