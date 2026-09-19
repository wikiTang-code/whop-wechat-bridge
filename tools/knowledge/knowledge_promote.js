#!/usr/bin/env node
/**
 * REQ-039 — table-level knowledge promote (CHG-026 contract).
 * Compute: win-host. SoR write: gcp-vm allowlist tables only.
 * Never copies messages / trade_signals / whole db. Default is dry-run.
 *
 *   node tools/knowledge/knowledge_promote.js --dry-run
 *   node tools/knowledge/knowledge_promote.js --dump
 *   node tools/knowledge/knowledge_promote.js --remote --dry-run
 *   node tools/knowledge/knowledge_promote.js --remote --apply --allow-prod-write
 *   node tools/knowledge/knowledge_promote.js --media --dry-run
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import {
  ensureOntologyCardTable,
  ensureDistillScannedTable,
  ensureMessageVisionMetaTable,
  ensureSemanticCuTables
} from '../../database.js';
import { loadSpec, assertPromoteSafety, resolveDbPath, countMedia } from './env_inventory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_DUMP = path.join(ROOT, 'data/runtime/knowledge-promote.sqlite');
const SSH_HOST = process.env.KNOWLEDGE_PROMOTE_SSH_HOST || 'gcp-vm';
const REMOTE_REPO =
  process.env.KNOWLEDGE_PROMOTE_REMOTE_REPO || '/home/wikitang628/whop-wechat-bridge';
const REMOTE_DB = process.env.KNOWLEDGE_PROMOTE_REMOTE_DB || `${REMOTE_REPO}/whop_archive.db`;
const REMOTE_DUMP = '/tmp/knowledge-promote.sqlite';

function assertIdent(name) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`bad ident: ${name}`);
  return name;
}

function countTable(db, table) {
  try {
    return db.prepare(`SELECT COUNT(*) AS c FROM ${assertIdent(table)}`).get().c;
  } catch {
    return null;
  }
}

function tableNames(db) {
  return db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
    .all()
    .map((r) => r.name);
}

function ensureAllowlistTables(conn) {
  ensureOntologyCardTable(conn);
  ensureDistillScannedTable(conn);
  ensureMessageVisionMetaTable(conn);
  ensureSemanticCuTables(conn);
}

function upsertRows(dest, table, rows) {
  const t = assertIdent(table);
  if (!rows.length) return 0;
  const cols = dest.prepare(`PRAGMA table_info(${t})`).all();
  if (!cols.length) throw new Error(`dest missing table ${t}`);
  const names = cols.map((c) => c.name);
  const ph = names.map((n) => `@${n}`).join(',');
  const stmt = dest.prepare(`INSERT OR REPLACE INTO ${t} (${names.join(',')}) VALUES (${ph})`);
  let n = 0;
  for (const row of rows) {
    const bound = {};
    for (const name of names) bound[name] = Object.prototype.hasOwnProperty.call(row, name) ? row[name] : null;
    stmt.run(bound);
    n += 1;
  }
  return n;
}

export function dumpAllowlist({ srcPath, dumpPath, spec = loadSpec() } = {}) {
  assertPromoteSafety(spec);
  if (!srcPath || !fs.existsSync(srcPath)) throw new Error(`src db missing: ${srcPath}`);
  fs.mkdirSync(path.dirname(dumpPath), { recursive: true });
  if (fs.existsSync(dumpPath)) fs.unlinkSync(dumpPath);
  const src = new Database(srcPath, { readonly: true });
  const dump = new Database(dumpPath);
  try {
    ensureAllowlistTables(dump);
    const dumped = {};
    for (const t of spec.promote_allowlist) {
      assertIdent(t);
      dumped[t] = 0;
      try {
        const rows = src.prepare(`SELECT * FROM ${t}`).all();
        dumped[t] = upsertRows(dump, t, rows);
      } catch (e) {
        if (!String(e.message || e).includes('no such table')) throw e;
      }
    }
    const forbidden = tableNames(dump).filter((n) => spec.promote_never.includes(n));
    if (forbidden.length) throw new Error(`dump leaked never tables: ${forbidden.join(',')}`);
    return { ok: true, dumpPath, dumped, srcBytes: fs.statSync(srcPath).size, dumpBytes: fs.statSync(dumpPath).size };
  } finally {
    dump.close();
    src.close();
  }
}

export function applyDump({ dumpPath, destPath, spec = loadSpec(), allowProdWrite = false } = {}) {
  assertPromoteSafety(spec);
  if (!allowProdWrite) {
    throw new Error('REFUSED: pass allowProdWrite / --allow-prod-write (HITL). Default is dry-run.');
  }
  if (!dumpPath || !fs.existsSync(dumpPath)) throw new Error(`dump missing: ${dumpPath}`);
  if (!destPath || !fs.existsSync(destPath)) throw new Error(`dest db missing: ${destPath}`);
  const dump = new Database(dumpPath, { readonly: true });
  const dest = new Database(destPath, { timeout: 15000 });
  dest.pragma('busy_timeout = 15000');
  try {
    const leaked = tableNames(dump).filter((n) => spec.promote_never.includes(n));
    if (leaked.length) throw new Error(`REFUSED: dump contains ${leaked.join(',')}`);
    const msgBefore = countTable(dest, 'messages');
    if (msgBefore == null) throw new Error('REFUSED: dest has no messages table (not a production-shaped db)');
    ensureAllowlistTables(dest);
    const applied = {};
    const tx = dest.transaction(() => {
      for (const t of spec.promote_allowlist) {
        assertIdent(t);
        let rows = [];
        try {
          rows = dump.prepare(`SELECT * FROM ${t}`).all();
        } catch {
          rows = [];
        }
        applied[t] = upsertRows(dest, t, rows);
      }
    });
    tx();
    const msgAfter = countTable(dest, 'messages');
    if (msgAfter !== msgBefore) {
      throw new Error(`REFUSED: messages count changed ${msgBefore} -> ${msgAfter}`);
    }
    const destCounts = {};
    for (const t of spec.promote_allowlist) destCounts[t] = countTable(dest, t);
    return { ok: true, applied, messages: msgAfter, destCounts };
  } finally {
    dump.close();
    dest.close();
  }
}

export function planPromote({ srcPath, spec = loadSpec() } = {}) {
  assertPromoteSafety(spec);
  const src = new Database(srcPath, { readonly: true, fileMustExist: true });
  try {
    const srcCounts = {};
    for (const t of spec.promote_allowlist) srcCounts[t] = countTable(src, t);
    srcCounts.messages = countTable(src, 'messages');
    return {
      ok: true,
      dry: true,
      compute: 'win-host',
      sor: 'gcp-vm',
      allowlist: spec.promote_allowlist,
      never: spec.promote_never,
      srcPath,
      srcCounts,
      media: countMedia(ROOT),
      note: 'LoRA weights stay on wsl-gpu; not part of this promote'
    };
  } finally {
    src.close();
  }
}

function ssh(args, timeout = 120000) {
  return spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', SSH_HOST, ...args], {
    encoding: 'utf8',
    timeout
  });
}

function scp(localPath, remotePath, timeout = 180000) {
  return spawnSync(
    'scp',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', localPath, `${SSH_HOST}:${remotePath}`],
    { encoding: 'utf8', timeout }
  );
}

export function listMediaRel(root = ROOT, dir = 'data/media/zhao') {
  const base = path.join(root, dir);
  const out = [];
  if (!fs.existsSync(base)) return out;
  const walk = (p) => {
    for (const ent of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile()) out.push(path.relative(root, full).replace(/\\/g, '/'));
    }
  };
  walk(base);
  return out.sort();
}

function parseRemoteList(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('total '));
}

export function applyMedia({ allowProdWrite = false } = {}) {
  if (!allowProdWrite) throw new Error('REFUSED: media apply requires --allow-prod-write');
  const local = listMediaRel(ROOT);
  const listed = ssh([`cd ${REMOTE_REPO} && find data/media/zhao -type f 2>/dev/null | sort`]);
  if (listed.status !== 0) throw new Error((listed.stderr || listed.stdout || 'ssh find failed').slice(0, 400));
  const remoteSet = new Set(parseRemoteList(listed.stdout));
  const toUpload = local.filter((p) => !remoteSet.has(p));
  if (!toUpload.length) return { ok: true, uploaded: 0, failed: [], method: 'noop' };
  const runtime = path.join(ROOT, 'data/runtime');
  fs.mkdirSync(runtime, { recursive: true });
  const listFile = path.join(runtime, 'media-promote.list');
  const tarPath = path.join(runtime, 'media-promote.tar');
  fs.writeFileSync(listFile, toUpload.join('\n'), 'utf8');
  const tar = spawnSync('tar', ['-cf', tarPath, '-C', ROOT, '-T', listFile], { encoding: 'utf8', timeout: 120000 });
  if (tar.status !== 0) throw new Error(`tar failed: ${(tar.stderr || tar.stdout || '').slice(0, 300)}`);
  const s = scp(tarPath, '/tmp/media-promote.tar', 300000);
  if (s.status !== 0) throw new Error(`scp tar failed: ${(s.stderr || s.stdout || '').slice(0, 300)}`);
  const x = ssh([`cd ${REMOTE_REPO} && tar -xf /tmp/media-promote.tar && rm -f /tmp/media-promote.tar`], 180000);
  if (x.status !== 0) throw new Error(`remote tar xf failed: ${(x.stderr || x.stdout || '').slice(0, 300)}`);
  return { ok: true, uploaded: toUpload.length, failed: [], method: 'tar-scp', sor: 'gcp-vm' };
}

export function planMedia({ spawnSsh = ssh } = {}) {
  const local = listMediaRel(ROOT);
  const r = spawnSsh([`cd ${REMOTE_REPO} && find data/media/zhao -type f 2>/dev/null | sort`]);
  if (r.status !== 0) {
    return { ok: false, error: (r.stderr || r.stdout || 'ssh failed').slice(0, 500), local: local.length };
  }
  const remote = parseRemoteList(r.stdout);
  const remoteSet = new Set(remote);
  const localSet = new Set(local);
  const toUpload = local.filter((p) => !remoteSet.has(p));
  const prodOnly = remote.filter((p) => !localSet.has(p));
  return {
    ok: true,
    dry: true,
    local: local.length,
    remote: remote.length,
    toUpload: toUpload.length,
    prodOnly: prodOnly.length,
    toUploadSample: toUpload.slice(0, 12),
    sor: 'gcp-vm'
  };
}

function main() {
  const args = process.argv.slice(2);
  const spec = loadSpec();
  const srcPath = resolveDbPath(ROOT);
  const dumpPath =
    args.includes('--dump-path') ? args[args.indexOf('--dump-path') + 1] : DEFAULT_DUMP;
  const wantApply = args.includes('--apply');
  const wantDump = args.includes('--dump') || wantApply;
  const remote = args.includes('--remote');
  const media = args.includes('--media');
  const allowProdWrite = args.includes('--allow-prod-write');

  if (!srcPath) {
    console.error(JSON.stringify({ ok: false, error: 'local sqlite missing' }));
    process.exit(1);
  }

  if (media && !wantApply) {
    const plan = remote ? planMedia() : { ok: true, dry: true, local: listMediaRel(ROOT).length, note: 'pass --remote to diff gcp' };
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (media && wantApply) {
    const result = applyMedia({ allowProdWrite });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const plan = planPromote({ srcPath, spec });
  if (!wantDump) {
    if (remote) {
      const inv = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', SSH_HOST, `cd ${REMOTE_REPO} && node tools/knowledge/env_inventory.js`], {
        encoding: 'utf8',
        timeout: 25000
      });
      plan.remoteInventory = inv.status === 0 ? 'ok' : (inv.stderr || inv.stdout || 'ssh failed').slice(0, 400);
    }
    console.log(JSON.stringify({ ...plan, next: ' --dump  then  --remote --apply --allow-prod-write' }, null, 2));
    return;
  }

  const dumped = dumpAllowlist({ srcPath, dumpPath, spec });
  if (!wantApply) {
    console.log(JSON.stringify({ ...plan, dumped }, null, 2));
    return;
  }

  if (remote) {
    if (!allowProdWrite) {
      console.error(JSON.stringify({ ok: false, error: 'remote apply requires --allow-prod-write' }));
      process.exit(2);
    }
    const jsLocal = path.join(ROOT, 'tools/knowledge/knowledge_promote.js');
    const envInv = path.join(ROOT, 'tools/knowledge/env_inventory.js');
    const specLocal = path.join(ROOT, 'docs/project/environments.json');
    for (const [local, remotePath] of [
      [jsLocal, `${REMOTE_REPO}/tools/knowledge/knowledge_promote.js`],
      [envInv, `${REMOTE_REPO}/tools/knowledge/env_inventory.js`],
      [specLocal, `${REMOTE_REPO}/docs/project/environments.json`],
      [dumpPath, REMOTE_DUMP]
    ]) {
      const s = scp(local, remotePath);
      if (s.status !== 0) {
        console.error(JSON.stringify({ ok: false, step: 'scp', file: local, error: (s.stderr || s.stdout || '').slice(0, 400) }));
        process.exit(1);
      }
    }
    const apply = ssh([
      `cd ${REMOTE_REPO} && node tools/knowledge/knowledge_promote.js --apply-from ${REMOTE_DUMP} --dest ${REMOTE_DB} --allow-prod-write`
    ], 180000);
    if (apply.status !== 0) {
      console.error(JSON.stringify({ ok: false, step: 'remote-apply', error: (apply.stderr || apply.stdout || '').slice(0, 800) }));
      process.exit(1);
    }
    const start = String(apply.stdout || '').indexOf('{');
    console.log(start >= 0 ? apply.stdout.slice(start) : apply.stdout);
    return;
  }

  const applyFrom = args.includes('--apply-from') ? args[args.indexOf('--apply-from') + 1] : dumpPath;
  const dest = args.includes('--dest') ? args[args.indexOf('--dest') + 1] : srcPath;
  const result = applyDump({ dumpPath: applyFrom, destPath: dest, spec, allowProdWrite });
  console.log(JSON.stringify({ ...dumped, ...result }, null, 2));
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  try {
    const args = process.argv.slice(2);
    if (args.includes('--apply-from')) {
      const spec = loadSpec();
      const dumpPath = args[args.indexOf('--apply-from') + 1];
      const dest = args.includes('--dest') ? args[args.indexOf('--dest') + 1] : resolveDbPath(ROOT);
      const result = applyDump({
        dumpPath,
        destPath: dest,
        spec,
        allowProdWrite: args.includes('--allow-prod-write')
      });
      console.log(JSON.stringify(result, null, 2));
    } else {
      main();
    }
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: e.message }));
    process.exit(1);
  }
}
