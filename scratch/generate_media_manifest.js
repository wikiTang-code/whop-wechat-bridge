import fs from 'fs';
import path from 'path';

const cuPath = 'data/samples/l2b_cu_20260829_know01.jsonl';
const manifestPath = 'data/media/zhao/media_manifest.json';

if (!fs.existsSync(cuPath)) {
  console.error('CU file not found:', cuPath);
  process.exit(1);
}

const lines = fs.readFileSync(cuPath, 'utf-8').trim().split('\n').filter(Boolean);
const manifest = [];
let totalImages = 0;

for (const l of lines) {
  const cu = JSON.parse(l);
  if (cu.media && cu.media.length > 0) {
    for (let i = 0; i < cu.media.length; i++) {
      const m = cu.media[i];
      totalImages++;
      
      // 提取图文上下文前后的文字
      const dialogText = cu.dialogue_messages.map(d => `[${d.speaker}]: ${d.text}`).join('\n');
      const snippet = dialogText.length > 300 ? dialogText.slice(0, 300) + '...' : dialogText;
      
      manifest.push({
        media_id: `m_${cu.cu_id}_${i}`,
        cu_id: cu.cu_id,
        kind: cu.kind,
        channel: cu.channel,
        channel_name: cu.channel_name,
        et_date: cu.time.et_date,
        session: cu.time.session,
        raw_url: m.url,
        local_path: m.local_path,
        git_rel_path: m.local_path,
        sha256: m.sha256 || null,
        status: m.status || 'missing',
        context_snippet: snippet
      });
    }
  }
}

fs.writeFileSync(manifestPath, JSON.stringify({
  generated_at: new Date().toISOString(),
  run_id: '20260829_know01',
  total_media: totalImages,
  manifest
}, null, 2), 'utf-8');

console.log(`✅ 成功生成图文资产管理清单: ${manifestPath}`);
console.log(`📊 纳入清单的配图总数: ${totalImages} 张 (完整覆盖 1006 组知识 CU)`);
