import { getDb } from '../database.js';

const db = getDb();
const rows = db.prepare(`
  SELECT id, channel_id, sender_name, content, created_at 
  FROM messages 
  WHERE content LIKE '%http%'
`).all();

const urlDomainMap = {};
let totalFound = 0;

for (const r of rows) {
  const urls = [];
  const tagMatches = r.content.matchAll(/\[IMAGE:(https?:\/\/[^\]]+)\]/gi);
  for (const m of tagMatches) urls.push(m[1]);

  const plainMatches = r.content.matchAll(/(https?:\/\/[^\s\)\"\'\]]+)/gi);
  for (const m of plainMatches) {
    if (m[1].includes('image') || m[1].includes('png') || m[1].includes('jpg') || m[1].includes('jpeg') || m[1].includes('img')) {
      if (!urls.includes(m[1])) urls.push(m[1]);
    }
  }

  for (const u of urls) {
    totalFound++;
    try {
      const parsed = new URL(u);
      const host = parsed.hostname;
      urlDomainMap[host] = (urlDomainMap[host] || 0) + 1;
    } catch (e) {}
  }
}

console.log(`\n📊 图片 URL 域名分布审计 (共 ${totalFound} 个图片链接):`);
console.table(urlDomainMap);
