/**
 * WeCom (企业微信) WXBizMsgCrypt — Node crypto only, no extra deps.
 * Spec: https://developer.work.weixin.qq.com/document/path/90968
 */
import crypto from 'crypto';

function pkcs7Pad(buf) {
  const block = 32;
  const amount = block - (buf.length % block);
  return Buffer.concat([buf, Buffer.alloc(amount, amount)]);
}

function pkcs7Unpad(buf) {
  const amount = buf[buf.length - 1];
  if (amount < 1 || amount > 32) throw new Error('invalid pkcs7 padding');
  return buf.subarray(0, buf.length - amount);
}

export function createWecomCrypt({ token, encodingAesKey, corpId }) {
  if (!token || typeof token !== 'string') throw new Error('wecom token required');
  if (!encodingAesKey || String(encodingAesKey).length !== 43) {
    throw new Error('encodingAesKey must be 43 chars');
  }
  if (!corpId) throw new Error('corpId required');

  const aesKey = Buffer.from(`${encodingAesKey}=`, 'base64');
  if (aesKey.length !== 32) throw new Error('encodingAesKey must decode to 32 bytes');
  const iv = aesKey.subarray(0, 16);

  function sha1Signature(timestamp, nonce, encrypt) {
    const sorted = [token, String(timestamp), String(nonce), String(encrypt)].sort().join('');
    return crypto.createHash('sha1').update(sorted, 'utf8').digest('hex');
  }

  function verifySignature({ msgSignature, timestamp, nonce, encrypt }) {
    const expect = sha1Signature(timestamp, nonce, encrypt);
    const a = Buffer.from(expect);
    const b = Buffer.from(String(msgSignature || ''));
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  function decrypt(encryptBase64) {
    const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
    decipher.setAutoPadding(false);
    const decrypted = pkcs7Unpad(Buffer.concat([
      decipher.update(Buffer.from(encryptBase64, 'base64')),
      decipher.final(),
    ]));
    const msgLen = decrypted.readUInt32BE(16);
    const msg = decrypted.subarray(20, 20 + msgLen).toString('utf8');
    const receiveId = decrypted.subarray(20 + msgLen).toString('utf8');
    if (receiveId !== corpId) {
      throw new Error(`receiveId mismatch: got ${receiveId}`);
    }
    return msg;
  }

  function encrypt(plainText) {
    const random = crypto.randomBytes(16);
    const msg = Buffer.from(String(plainText), 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(msg.length, 0);
    const corp = Buffer.from(corpId, 'utf8');
    const raw = pkcs7Pad(Buffer.concat([random, len, msg, corp]));
    const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, iv);
    cipher.setAutoPadding(false);
    return Buffer.concat([cipher.update(raw), cipher.final()]).toString('base64');
  }

  function packReply(plainXml, timestamp = Math.floor(Date.now() / 1000), nonce = crypto.randomBytes(8).toString('hex')) {
    const Encrypt = encrypt(plainXml);
    const MsgSignature = sha1Signature(timestamp, nonce, Encrypt);
    return (
      `<xml>`
      + `<Encrypt><![CDATA[${Encrypt}]]></Encrypt>`
      + `<MsgSignature><![CDATA[${MsgSignature}]]></MsgSignature>`
      + `<TimeStamp>${timestamp}</TimeStamp>`
      + `<Nonce><![CDATA[${nonce}]]></Nonce>`
      + `</xml>`
    );
  }

  return {
    verifySignature,
    decrypt,
    encrypt,
    decryptEcho: decrypt,
    packReply,
    sha1Signature,
  };
}

export function xmlEscape(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Minimal XML tag extractor (WeCom payloads are simple). */
export function xmlTag(xml, tag) {
  const cdata = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i').exec(xml);
  if (cdata) return cdata[1];
  const plain = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  return plain ? plain[1].trim() : '';
}
