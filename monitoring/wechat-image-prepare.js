/**
 * @file monitoring/wechat-image-prepare.js
 * @description 企微推送媒体预处理。
 *
 * 平台约束（无法在我方“去掉”）：
 * - msgtype=image：base64 前 ≤ 2MB，仅 JPG/PNG（官方硬限制）
 * - msgtype=file：先 upload_media，单文件 ≤ 20MB，可原样无损投递
 *
 * 策略：本地落盘永远保留原图；推送时 ≤2MB 原生图，更大则走 file（原字节）。
 */

import fs from 'fs';
import path from 'path';

export const WECHAT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const WECHAT_FILE_MAX_BYTES = 20 * 1024 * 1024;

export function sniffFormat(buf) {
  if (!buf || buf.length < 12) return 'unknown';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
    && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
    return 'webp';
  }
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'gif';
  // ISOBMFF 容器: 第 4-7 字节为 'ftyp'
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    const brand = buf.slice(8, 12).toString('ascii');
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (brand === 'heic' || brand === 'heix' || brand === 'mif1' || brand === 'msf1') {
      const compatible = buf.slice(16, 32).toString('ascii');
      if (compatible.includes('avif')) return 'avif';
      return 'heic';
    }
  }
  return 'unknown';
}

export function extensionForFormat(fmt) {
  switch (fmt) {
    case 'jpeg': return 'jpg';
    case 'png': return 'png';
    case 'webp': return 'webp';
    case 'gif': return 'gif';
    case 'avif': return 'avif';
    case 'heic': return 'heic';
    default: return 'bin';
  }
}

/**
 * 是否可直接走企微原生 image 消息（无需压缩、无损失）。
 */
export function canPushAsNativeImage(buf) {
  if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) return false;
  if (buf.length > WECHAT_IMAGE_MAX_BYTES) return false;
  const fmt = sniffFormat(buf);
  return fmt === 'jpeg' || fmt === 'png';
}

/**
 * 是否可走企微 file 消息（原文件，最大 20MB）。
 */
export function canPushAsWebhookFile(buf) {
  return Boolean(buf && Buffer.isBuffer(buf) && buf.length >= 5 && buf.length <= WECHAT_FILE_MAX_BYTES);
}

/**
 * @deprecated 压缩路径仅作可选兜底；默认推送优先原图/原文件，不做有损处理。
 * 保留供显式开启 WECHAT_IMAGE_ALLOW_COMPRESS=1 时使用。
 */
export async function prepareWeChatImageBuffer(input, { maxBytes = WECHAT_IMAGE_MAX_BYTES } = {}) {
  if (!input || !Buffer.isBuffer(input) || input.length === 0) {
    return { ok: false, reason: 'empty_buffer' };
  }
  if (canPushAsNativeImage(input) && input.length <= maxBytes) {
    return { ok: true, buffer: input };
  }
  if (process.env.WECHAT_IMAGE_ALLOW_COMPRESS !== '1') {
    return { ok: false, reason: 'compress_disabled_use_file_channel' };
  }

  let sharp;
  try {
    const mod = await import('sharp');
    sharp = mod.default || mod;
  } catch {
    return { ok: false, reason: 'no_sharp' };
  }

  const TARGET_BYTES = Math.floor(1.85 * 1024 * 1024);
  try {
    let width = 1600;
    let quality = 82;
    let last = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      last = await sharp(input)
        .rotate()
        .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      if (last.length <= TARGET_BYTES) {
        return { ok: true, buffer: last, note: `compressed_q${quality}_w${width}` };
      }
      quality = Math.max(40, quality - 8);
      if (quality <= 48) width = Math.max(640, Math.floor(width * 0.75));
    }
    if (last && last.length <= maxBytes) return { ok: true, buffer: last, note: 'compressed_near_limit' };
    return { ok: false, reason: 'still_too_large_after_compress' };
  } catch (err) {
    return { ok: false, reason: `sharp_error_${err.message}` };
  }
}

export function readLocalImageBuffer(localPath) {
  if (!localPath || typeof localPath !== 'string') return null;
  const resolved = path.isAbsolute(localPath) ? localPath : path.resolve(localPath);
  if (!fs.existsSync(resolved)) return null;
  try {
    return fs.readFileSync(resolved);
  } catch {
    return null;
  }
}

export function extractWebhookKey(webhookUrl) {
  try {
    return new URL(webhookUrl).searchParams.get('key');
  } catch {
    return null;
  }
}
