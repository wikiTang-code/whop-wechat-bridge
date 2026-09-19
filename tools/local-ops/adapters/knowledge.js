/**
 * REQ-039 / CHG-027 — knowledge promote adapter (win-host compute).
 * plan/dump are local. apply is production C2 HITL and still runs locally
 * (dump + scp + remote apply). Never called from WeCom.
 */
import { spawnSync } from 'child_process';
import path from 'path';

function parseJsonTail(raw) {
  const text = String(raw || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new Error((text || 'knowledge_promote produced no JSON').slice(0, 400));
  }
  return JSON.parse(text.slice(start, end + 1));
}

export function createKnowledgeAdapter({
  rootDir,
  spawnImpl = spawnSync,
  timeoutMs = 180000
} = {}) {
  const script = path.join(rootDir, 'tools/knowledge/knowledge_promote.js');

  function run(argv, timeout = 25000) {
    const r = spawnImpl('node', [script, ...argv], {
      encoding: 'utf8',
      timeout,
      cwd: rootDir
    });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    if (r.status !== 0) {
      throw new Error((out || `knowledge_promote exit ${r.status}`).slice(0, 800));
    }
    return parseJsonTail(out);
  }

  return {
    async invoke(id) {
      if (id === 'knowledge.promote.plan') return run([]);
      if (id === 'knowledge.promote.dump') return run(['--dump']);
      if (id === 'knowledge.promote.apply') {
        return run(['--dump', '--remote', '--apply', '--allow-prod-write'], timeoutMs);
      }
      throw new Error(`knowledge adapter cannot handle ${id}`);
    }
  };
}
