/**
 * @file test/test_wechat_image_prepare.js
 * @description 企微图片/文件双通道：≤2MB 原生图，更大走 file 原字节；失败诚实文案
 */

import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  canPushAsNativeImage,
  canPushAsWebhookFile,
  sniffFormat,
  extensionForFormat,
  WECHAT_IMAGE_MAX_BYTES,
  WECHAT_FILE_MAX_BYTES,
} from '../monitoring/wechat-image-prepare.js';
import { extractRawMediaUrl } from '../scripts/media_downloader.js';

function makeJpegStub(bytes) {
  const buf = Buffer.alloc(bytes, 0x00);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[3] = 0xd9;
  return buf;
}

function makeAvifStub() {
  const buf = Buffer.alloc(32, 0x00);
  buf.writeUInt32BE(28, 0);
  buf.write('ftyp', 4, 'ascii');
  buf.write('avif', 8, 'ascii');
  return buf;
}

async function run() {
  console.log('--- test_wechat_image_prepare ---');

  // 0. AVIF / HEIC 格式嗅探与扩展名映射测试
  const avifBuf = makeAvifStub();
  assert.equal(sniffFormat(avifBuf), 'avif', 'avif should be sniffed properly');
  assert.equal(extensionForFormat('avif'), 'avif', 'avif extension must be avif, not bin');
  console.log('   ✅ sniffFormat: avif properly recognized and mapped to .avif');

  // 0.1 验证 extractRawMediaUrl 正确从 imgproxy 中解出 S3 原图地址
  const wrappedUrl = 'https://img-v2-prod.whop.com/sig123/plain/https%3A%2F%2Fassets-2-prod.whop.com%2Ftest.png%3Ftoken%3Dabc';
  const extracted = extractRawMediaUrl(wrappedUrl);
  assert.equal(extracted, 'https://assets-2-prod.whop.com/test.png?token=abc');
  assert.equal(extractRawMediaUrl('https://example.com/raw.png'), 'https://example.com/raw.png');
  console.log('   ✅ extractRawMediaUrl: S3 raw url correctly unwrapped from imgproxy');

  const small = makeJpegStub(12 * 1024);
  assert.equal(canPushAsNativeImage(small), true);
  assert.equal(canPushAsWebhookFile(small), true);

  const overImage = makeJpegStub(WECHAT_IMAGE_MAX_BYTES + 100_000);
  assert.equal(canPushAsNativeImage(overImage), false, '>2MB cannot use image msgtype');
  assert.equal(canPushAsWebhookFile(overImage), true, '>2MB still ok as file if <20MB');

  const overFile = makeJpegStub(WECHAT_FILE_MAX_BYTES + 10);
  assert.equal(canPushAsWebhookFile(overFile), false);
  console.log('   ✅ size gates: image≤2MB / file≤20MB');

  const bodies = [];
  const uploads = [];
  const originalFetch = globalThis.fetch;
  process.env.WECHAT_WORK_WEBHOOK_URL = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key';

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes('upload_media')) {
      uploads.push({ url: urlStr, bodyLen: options.body?.length || 0 });
      return {
        ok: true,
        json: async () => ({ errcode: 0, media_id: 'MEDIA_FILE_1' }),
        text: async () => '',
      };
    }
    let body = {};
    if (options.body && typeof options.body === 'string') {
      body = JSON.parse(options.body);
      bodies.push(body);
    } else if (Buffer.isBuffer(options.body)) {
      bodies.push({ rawBufferLen: options.body.length });
    }
    return {
      ok: true,
      json: async () => ({ errcode: 0, errmsg: 'ok' }),
      text: async () => '',
    };
  };

  // 动态 import，确保 webFetch 使用上面的 mock
  const { pushMediaToWeChat, pushRawMessageToWeChat } = await import(`../monitor.js?t=${Date.now()}`);

  try {
    const modeFile = await pushMediaToWeChat(process.env.WECHAT_WORK_WEBHOOK_URL, overImage, {
      filenameHint: 'big_chart.jpg',
    });
    assert.equal(modeFile, 'file', 'oversized jpeg must use file channel');
    assert.ok(uploads.length >= 1, 'must call upload_media');
    assert.ok(uploads[0].bodyLen > overImage.length, 'multipart body must include file bytes');
    assert.ok(bodies.some((b) => b.msgtype === 'file' && b.file?.media_id === 'MEDIA_FILE_1'));
    console.log('   ✅ >2MB → file channel with original bytes');

    bodies.length = 0;
    uploads.length = 0;
    const modeImg = await pushMediaToWeChat(process.env.WECHAT_WORK_WEBHOOK_URL, small, {
      filenameHint: 'small.jpg',
    });
    assert.equal(modeImg, 'image');
    assert.ok(bodies.some((b) => b.msgtype === 'image'));
    console.log('   ✅ ≤2MB → native image channel');

    const tmpDir = path.resolve('data/tmp_wechat_img_test');
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpImg = path.join(tmpDir, 'stub.jpg');
    fs.writeFileSync(tmpImg, overImage);

    bodies.length = 0;
    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);
      if (urlStr.includes('upload_media')) {
        return { ok: true, json: async () => ({ errcode: 1, errmsg: 'fail' }), text: async () => '' };
      }
      let body = {};
      if (options.body && typeof options.body === 'string') {
        body = JSON.parse(options.body);
        bodies.push(body);
        if (body.msgtype === 'image') {
          return { ok: true, json: async () => ({ errcode: 81013, errmsg: 'too large' }), text: async () => '' };
        }
      }
      return { ok: true, json: async () => ({ errcode: 0 }), text: async () => '' };
    };

    await pushRawMessageToWeChat({
      id: 'test_img_fail_honest',
      sender_name: 'xiaozhaolucky',
      channel_name: '不用翻墙美股讨论区',
      created_at: Date.now(),
      content: '[IMAGE:https://example.invalid/chart.jpg]',
      attachments: [{ status: 'ok', local_path: tmpImg }],
    });
    const md = bodies.find((b) => b.msgtype === 'markdown');
    assert.ok(md);
    assert.ok(md.markdown.content.includes('推送失败'));
    assert.ok(!md.markdown.content.includes('📷 [大V盘面图片分享]'));
    console.log('   ✅ both channels fail → honest markdown');

    try { fs.unlinkSync(tmpImg); } catch (_) {}
    try { fs.rmdirSync(tmpDir); } catch (_) {}
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('🎉 ALL test_wechat_image_prepare PASSED\n');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
