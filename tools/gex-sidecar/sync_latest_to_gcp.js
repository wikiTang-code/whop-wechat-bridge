#!/usr/bin/env node
/**
 * REQ-004 — sync local data/gex/latest.json → gcp-vm (SCP), after REQ-022 validation.
 * Never syncs HTML / snapshots / .env. Does not run OpenD on GCP.
 *
 * Usage:
 *   node tools/gex-sidecar/sync_latest_to_gcp.js
 *   node tools/gex-sidecar/sync_latest_to_gcp.js --dry-run
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { validateGexPayload, calculateChecksum } from './gex-sync-validator.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

const DEFAULT_LOCAL = path.join(root, 'data', 'gex', 'latest.json');
const DEFAULT_REMOTE_HOST = process.env.GEX_SYNC_SSH_HOST || 'gcp-vm';
const DEFAULT_REMOTE_PATH =
  process.env.GEX_SYNC_REMOTE_PATH ||
  '/home/wikitang628/whop-wechat-bridge/data/gex/latest.json';

function assertSafeLocalPath(localPath) {
  const base = path.basename(localPath).toLowerCase();
  if (base !== 'latest.json') {
    throw new Error('only latest.json may be synced (REQ-024 / REQ-004)');
  }
  if (/\.html?$/i.test(localPath) || /snapshot_/i.test(localPath)) {
    throw new Error('HTML and snapshot_* are forbidden on the sync path');
  }
}

function runScp({ spawnImpl, host, localPath, remotePath, timeoutMs = 60_000 }) {
  return new Promise((resolve, reject) => {
    const target = `${host}:${remotePath}`;
    const child = spawnImpl('scp', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', localPath, target], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      reject(new Error(`scp timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout?.on('data', (b) => { stdout += b.toString('utf8'); });
    child.stderr?.on('data', (b) => { stderr += b.toString('utf8'); });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ ok: true, stdout, stderr });
      } else {
        reject(new Error(`scp exit ${code}: ${stderr || stdout || 'no output'}`));
      }
    });
  });
}

/**
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function syncLatestToGcp(options = {}) {
  const localPath = options.localPath || DEFAULT_LOCAL;
  const host = options.host || DEFAULT_REMOTE_HOST;
  const remotePath = options.remotePath || DEFAULT_REMOTE_PATH;
  const dryRun = Boolean(options.dryRun);
  const spawnImpl = options.spawnImpl || spawn;

  assertSafeLocalPath(localPath);
  if (!fs.existsSync(localPath)) {
    return { ok: false, code: 'missing_local', message: `local file not found: ${localPath}` };
  }

  const raw = fs.readFileSync(localPath, 'utf8');
  const validation = validateGexPayload(raw);
  if (!validation.valid) {
    return {
      ok: false,
      code: 'validation_failed',
      message: validation.error,
      details: validation.details,
    };
  }

  const sha256 = calculateChecksum(raw);
  const sizeBytes = Buffer.byteLength(raw);

  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      localPath,
      host,
      remotePath,
      sha256,
      sizeBytes,
      metadata: validation.metadata,
      note: 'validated only; scp not executed',
    };
  }

  await runScp({ spawnImpl, host, localPath, remotePath });
  return {
    ok: true,
    dry_run: false,
    localPath,
    host,
    remotePath,
    sha256,
    sizeBytes,
    metadata: validation.metadata,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const dryRun = process.argv.includes('--dry-run');
  syncLatestToGcp({ dryRun })
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exit(result.ok ? 0 : 1);
    })
    .catch((err) => {
      process.stderr.write(`[gex-sync] ${err.message}\n`);
      process.exit(1);
    });
}
