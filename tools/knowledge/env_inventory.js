#!/usr/bin/env node
/**
 * CHG-026 / REQ-039 — compare local (and optional gcp-vm) assets against environments.json.
 * Does not write production SQLite. Does not scp the whole db.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const SPEC_PATH = path.join(ROOT, 'docs/project/environments.json');

export function loadSpec(p = SPEC_PATH) {
  const spec = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!spec.workloads?.length) throw new Error('environments.json: missing workloads');
  if (!Array.isArray(spec.promote_allowlist) || !Array.isArray(spec.promote_never)) {
    throw new Error('environments.json: missing promote lists');
  }
  return spec;
}

export function assertPromoteSafety(spec = loadSpec()) {
  const never = new Set(spec.promote_never);
  for (const t of ['messages', 'trade_signals']) {
    if (!never.has(t)) throw new Error(`promote_never must include ${t}`);
  }
  for (const t of spec.promote_allowlist) {
    if (never.has(t)) throw new Error(`table both allow and never: ${t}`);
    if (!/^[a-z_][a-z0-9_]*$/i.test(t)) throw new Error(`bad table name: ${t}`);
  }
  return true;
}

export function resolveDbPath(root = ROOT) {
  const envp = process.env.SQLITE_PATH;
  if (envp && fs.existsSync(envp)) return path.resolve(envp);
  const a = path.join(root, 'whop_archive.db');
  if (fs.existsSync(a)) return a;
  const b = path.join(root, 'data/whop_bridge.db');
  return fs.existsSync(b) ? b : null;
}

export function countTables(dbPath, tableNames) {
  const out = {};
  if (!dbPath || !fs.existsSync(dbPath)) {
    for (const t of tableNames) out[t] = null;
    return { dbPath: dbPath || null, missing: true, bytes: 0, tables: out };
  }
  const st = fs.statSync(dbPath);
  const d = new Database(dbPath, { readonly: true });
  try {
    for (const t of tableNames) {
      if (!/^[a-z_][a-z0-9_]*$/i.test(t)) {
        out[t] = null;
        continue;
      }
      try {
        out[t] = d.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
      } catch {
        out[t] = null;
      }
    }
  } finally {
    d.close();
  }
  return { dbPath, missing: false, bytes: st.size, tables: out };
}

export function countMedia(root = ROOT) {
  const dir = path.join(root, 'data/media/zhao');
  if (!fs.existsSync(dir)) return { files: 0, over15kb: 0, bin: 0 };
  let files = 0;
  let over15kb = 0;
  let bin = 0;
  const walk = (p) => {
    for (const ent of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile()) {
        files += 1;
        if (path.extname(ent.name).toLowerCase() === '.bin') bin += 1;
        try {
          if (fs.statSync(full).size > 15 * 1024) over15kb += 1;
        } catch {
          /* skip */
        }
      }
    }
  };
  walk(dir);
  return { files, over15kb, bin };
}

export function loraWeights(root = ROOT) {
  const dir = path.join(root, 'models/zhao_slm_1.5b_lora');
  if (!fs.existsSync(dir)) return { present: false, files: [] };
  const files = fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.safetensors'))
    .map((n) => {
      const st = fs.statSync(path.join(dir, n));
      return { name: n, bytes: st.size };
    });
  return { present: files.length > 0, files };
}

export function classify(spec, local, remote) {
  const drifts = [];
  const allow = new Set(spec.promote_allowlist);
  const locT = local.sqlite?.tables || {};
  const remT = remote?.sqlite?.tables || {};

  for (const t of allow) {
    const lv = locT[t] ?? 0;
    const rv = remT[t];
    if (lv > 0 && (rv === 0 || rv == null) && remote) {
      drifts.push({
        id: t,
        kind: 'knowledge-local-only',
        local: lv,
        prod: rv,
        action: 'REQ-039 promote allowlist → gcp; never overwrite messages'
      });
    } else if (lv > 0 && !remote) {
      drifts.push({
        id: t,
        kind: 'knowledge-on-compute-host',
        local: lv,
        prod: 'unknown',
        action: 'SoR is gcp-vm; run --remote or promote'
      });
    }
  }

  const locMsg = locT.messages;
  const remMsg = remT.messages;
  if (remote && locMsg && remMsg && locMsg < remMsg) {
    drifts.push({
      id: 'messages',
      kind: 'prod-ahead',
      local: locMsg,
      prod: remMsg,
      action: 'FORBIDDEN to copy local db over prod'
    });
  }

  if (remote && local.media && remote.media) {
    if (local.media.files !== remote.media.files) {
      drifts.push({
        id: 'media-files',
        kind: 'media-count-mismatch',
        local: local.media.files,
        prod: remote.media.files,
        action: 'rsync classified extras; SoR=gcp-vm; do not git add'
      });
    }
  }

  if (local.lora?.present) {
    drifts.push({
      id: 'slm-lora-flywheel',
      kind: 'expected-local',
      local: local.lora.files.map((f) => f.name),
      prod: 'n/a (wsl-gpu SoR)',
      action: 'do not scp weights to gcp-vm'
    });
  }

  return drifts;
}

export function probeLocal(root = ROOT, spec = loadSpec()) {
  const dbPath = resolveDbPath(root);
  return {
    host: 'win-host',
    sqlite: countTables(dbPath, spec.sqlite_probes),
    media: countMedia(root),
    lora: loraWeights(root)
  };
}

function parseRemoteJson(raw) {
  const text = String(raw || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('remote output was not JSON');
  return JSON.parse(text.slice(start, end + 1));
}

export function remoteProbeSource(tables) {
  return `import fs from 'fs';
import Database from 'better-sqlite3';
const tables = ${JSON.stringify(tables)};
const dbPath = process.env.SQLITE_PATH || (fs.existsSync('whop_archive.db') ? 'whop_archive.db' : 'data/whop_bridge.db');
const out = { host: 'gcp-vm', sqlite: { dbPath, missing: !fs.existsSync(dbPath), bytes: 0, tables: {} }, media: { files: 0, over15kb: 0, bin: 0 }, lora: { present: false, files: [] } };
if (fs.existsSync(dbPath)) {
  out.sqlite.bytes = fs.statSync(dbPath).size;
  const d = new Database(dbPath, { readonly: true });
  for (const t of tables) {
    try { out.sqlite.tables[t] = d.prepare('SELECT COUNT(*) AS c FROM ' + t).get().c; }
    catch { out.sqlite.tables[t] = null; }
  }
  d.close();
}
const walk = (p) => {
  if (!fs.existsSync(p)) return;
  for (const ent of fs.readdirSync(p, { withFileTypes: true })) {
    const full = p + '/' + ent.name;
    if (ent.isDirectory()) walk(full);
    else if (ent.isFile()) {
      out.media.files++;
      if (ent.name.endsWith('.bin')) out.media.bin++;
      try { if (fs.statSync(full).size > 15360) out.media.over15kb++; } catch {}
    }
  }
};
walk('data/media/zhao');
const ldir = 'models/zhao_slm_1.5b_lora';
if (fs.existsSync(ldir)) {
  out.lora.files = fs.readdirSync(ldir).filter((n) => n.endsWith('.safetensors'));
  out.lora.present = out.lora.files.length > 0;
}
process.stdout.write(JSON.stringify(out));
`;
}

export function probeRemote(spec = loadSpec()) {
  const tables = spec.sqlite_probes.filter((t) => /^[a-z_][a-z0-9_]*$/i.test(t));
  const sshHost = process.env.KNOWLEDGE_PROMOTE_SSH_HOST || 'gcp-vm';
  const remoteRepo =
    process.env.KNOWLEDGE_PROMOTE_REMOTE_REPO || '/home/wikitang628/whop-wechat-bridge';
  const localTmp = path.join(os.tmpdir(), `env_inv_probe_${process.pid}.mjs`);
  const remoteTmp = `${remoteRepo}/data/runtime/env_inv_probe.mjs`;
  fs.writeFileSync(localTmp, remoteProbeSource(tables), 'utf8');
  try {
    const mkdir = spawnSync(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', sshHost, `mkdir -p ${remoteRepo}/data/runtime`],
      { encoding: 'utf8', timeout: 15000 }
    );
    if (mkdir.status !== 0) {
      return { error: (mkdir.stderr || mkdir.stdout || 'mkdir runtime failed').slice(0, 800), status: mkdir.status };
    }
    const scp = spawnSync(
      'scp',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', localTmp, `${sshHost}:${remoteTmp}`],
      { encoding: 'utf8', timeout: 20000 }
    );
    if (scp.status !== 0) {
      return { error: (scp.stderr || scp.stdout || 'scp probe failed').slice(0, 800), status: scp.status };
    }
    const r = spawnSync(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', sshHost, `cd ${remoteRepo} && node data/runtime/env_inv_probe.mjs`],
      { encoding: 'utf8', timeout: 25000 }
    );
    if (r.status !== 0) {
      return { error: (r.stderr || r.stdout || 'ssh failed').slice(0, 800), status: r.status };
    }
    return parseRemoteJson(r.stdout);
  } finally {
    try {
      fs.unlinkSync(localTmp);
    } catch {
      /* ignore */
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const spec = loadSpec();
  assertPromoteSafety(spec);
  const local = probeLocal(ROOT, spec);
  let remote = null;
  if (args.includes('--remote')) {
    remote = probeRemote(spec);
  }
  const drifts = classify(spec, local, remote && !remote.error ? remote : null);
  const report = {
    ok: true,
    spec: { version: spec.version, chg: spec.chg, req_pipeline: spec.req_pipeline },
    workloads: spec.workloads.map((w) => ({
      id: w.id,
      compute: w.compute,
      sor: w.sor,
      git: w.git
    })),
    promote_allowlist: spec.promote_allowlist,
    promote_never: spec.promote_never,
    local,
    remote,
    drifts
  };
  console.log(JSON.stringify(report, null, 2));
  const blocking = drifts.filter((d) => d.kind === 'knowledge-local-only' || d.kind === 'knowledge-on-compute-host');
  if (args.includes('--strict') && blocking.length) process.exit(2);
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) main();
