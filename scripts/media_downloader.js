import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import https from 'https';
import http from 'http';

const BLACKLIST_PREFIXES = ['0804573d', '5f4dd331'];

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      },
      timeout: 10000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadBuffer(res.headers.location).then(resolve).catch(reject);
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
      reject(new Error('Download timeout (10s)'));
    });
  });
}

/**
 * 实时同步下载并落盘消息中的媒体附件 (行业级进库当刻落地)
 * @param {Object} msg 归一化消息对象 { id, created_at, content, rawAttachments }
 * @returns {Promise<Array>} 带有 local_path / sha256 / status 的结构化 attachments 列表
 */
export async function downloadAndPersistAttachments(msg) {
  const urls = new Set();

  // 1. 从 rawAttachments 提取
  if (Array.isArray(msg.rawAttachments)) {
    msg.rawAttachments.forEach(a => {
      const u = a.url || a.source?.url || a.plain_url;
      if (u && typeof u === 'string') urls.add(u);
    });
  }

  // 2. 从 content [IMAGE:...] 提取
  const regex = /\[IMAGE:(https?:\/\/[^\]]+)\]/g;
  let match;
  while ((match = regex.exec(msg.content)) !== null) {
    urls.add(match[1]);
  }

  if (urls.size === 0) return null;

  const urlList = Array.from(urls);
  const etDate = new Date(msg.created_at || Date.now()).toISOString().slice(0, 10);
  const dirPath = path.join('data/media/zhao', etDate);
  const results = [];

  for (let i = 0; i < urlList.length; i++) {
    const rawUrl = urlList[i];
    let targetDownloadUrl = rawUrl;

    // 如果是 S3 裸签或未包装网关，且属于 S3 桶，可直下或走网关
    try {
      const buf = await downloadBuffer(targetDownloadUrl);
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      const isBlacklist = BLACKLIST_PREFIXES.some(pfx => sha.startsWith(pfx));

      if (buf.length > 15 * 1024 && !isBlacklist) {
        fs.mkdirSync(dirPath, { recursive: true });
        const fileName = `${msg.id}_${i}.jpg`;
        const localPath = path.join(dirPath, fileName).replace(/\\/g, '/');
        fs.writeFileSync(localPath, buf);

        console.log(`[MediaDownloader] ✅ 进库当刻成功落盘附件: ${localPath} (${(buf.length/1024).toFixed(1)} KB, SHA: ${sha.slice(0, 8)})`);

        results.push({
          index: i,
          raw_url: rawUrl,
          local_path: localPath,
          sha256: sha,
          bytes: buf.length,
          status: 'ok'
        });
      } else {
        console.warn(`[MediaDownloader] ⚠️ 拦截无效图片 (${buf.length} 字节, 骨架/小图): ${rawUrl.slice(0, 60)}...`);
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
