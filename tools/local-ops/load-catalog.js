/**
 * Restricted YAML loader for catalog.yaml (scalars + list-of-maps only).
 * Unknown document shapes fail closed.
 */
import fs from 'fs';

const ID_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/;
const CLASS_RE = /^C[0-4]$/;
const WHERE_RE = /^(local|ssh|gateway)$/;
const ADAPTER_RE = /^(gex|lm|ssh|gateway|dash)$/;
const RECIPE_RE = /^[a-z][a-z0-9_]*$/;
const HOST_RE = /^[A-Za-z0-9._-]+$/;
const ROOT_RE = /^\/[A-Za-z0-9/._-]+$/;
const PHASE_RE = /^P[0-6](?:\.\d+)?$/;
const CLASS_RANK = { C0: 0, C1: 1, C2: 2, C3: 3, C4: 4 };

export function parseCatalogYaml(text) {
  if (typeof text !== 'string') throw new Error('catalog must be text');
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const root = {};
  let listKey = null;
  let currentItem = null;

  const setScalar = (obj, key, raw) => {
    const v = raw.trim();
    if (v === '') obj[key] = '';
    else if (v === 'true') obj[key] = true;
    else if (v === 'false') obj[key] = false;
    else if (/^-?\d+$/.test(v)) obj[key] = Number(v);
    else obj[key] = v.replace(/^["']|["']$/g, '');
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (/^\t/.test(raw)) {
      throw new Error(`catalog.yaml line ${i + 1}: tabs not allowed`);
    }

    const cap = raw.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (cap) {
      const [, key, rest] = cap;
      listKey = null;
      currentItem = null;
      if (rest === '') {
        if (key === 'capabilities') {
          root.capabilities = [];
          listKey = 'capabilities';
        } else {
          root[key] = {};
        }
      } else {
        setScalar(root, key, rest);
      }
      continue;
    }

    const itemStart = raw.match(/^  - ([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (itemStart && listKey === 'capabilities') {
      currentItem = {};
      setScalar(currentItem, itemStart[1], itemStart[2]);
      root.capabilities.push(currentItem);
      continue;
    }

    const itemField = raw.match(/^    ([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (itemField && currentItem) {
      setScalar(currentItem, itemField[1], itemField[2]);
      continue;
    }

    throw new Error(`catalog.yaml line ${i + 1}: unsupported syntax`);
  }

  return root;
}

import { LOCAL_C2_IDS, PROD_C2_IDS } from './forbidden.js';

const ALLOWED_C2_IDS = new Set([...LOCAL_C2_IDS, ...PROD_C2_IDS]);

export function validateCatalog(raw) {
  if (!raw || raw.version !== 1) throw new Error('catalog.version must be 1');
  if (!PHASE_RE.test(String(raw.phase || ''))) throw new Error('invalid catalog.phase');
  if (!CLASS_RE.test(String(raw.max_class || ''))) throw new Error('invalid catalog.max_class');
  if (CLASS_RANK[raw.max_class] > CLASS_RANK.C2) {
    throw new Error('catalog.max_class above C2 not enabled yet');
  }
  if (!HOST_RE.test(String(raw.ssh_host || ''))) throw new Error('invalid ssh_host');
  if (!ROOT_RE.test(String(raw.remote_root || ''))) throw new Error('invalid remote_root');
  if (!Array.isArray(raw.capabilities) || raw.capabilities.length === 0) {
    throw new Error('catalog.capabilities required');
  }

  const maxRank = CLASS_RANK[raw.max_class];
  const seen = new Set();
  const capabilities = raw.capabilities.map((cap) => {
    if (!cap || typeof cap !== 'object') throw new Error('invalid capability');
    if (!ID_RE.test(cap.id)) throw new Error(`invalid capability id: ${cap.id}`);
    if (seen.has(cap.id)) throw new Error(`duplicate capability id: ${cap.id}`);
    seen.add(cap.id);
    if (!CLASS_RE.test(cap.class)) throw new Error(`invalid class on ${cap.id}`);
    if (CLASS_RANK[cap.class] > maxRank) {
      throw new Error(`capability ${cap.id} class ${cap.class} exceeds max_class ${raw.max_class}`);
    }
    if (cap.class === 'C2' && !ALLOWED_C2_IDS.has(cap.id)) {
      throw new Error(`C2 capability not allowed in this phase: ${cap.id}`);
    }
    if (cap.class === 'C2' && LOCAL_C2_IDS.includes(cap.id) && cap.where !== 'local') {
      throw new Error(`local C2 must be where=local: ${cap.id}`);
    }
    if (cap.class === 'C2' && PROD_C2_IDS.includes(cap.id) && cap.where !== 'ssh') {
      throw new Error(`production C2 must be where=ssh: ${cap.id}`);
    }
    if (!WHERE_RE.test(cap.where)) throw new Error(`invalid where on ${cap.id}`);
    if (!ADAPTER_RE.test(cap.adapter)) throw new Error(`invalid adapter on ${cap.id}`);
    if (String(cap.id).includes('place_order')) {
      throw new Error(`place_order is forbidden in catalog: ${cap.id}`);
    }
    if (cap.where === 'ssh') {
      if (!RECIPE_RE.test(cap.recipe || '')) throw new Error(`invalid recipe on ${cap.id}`);
    } else if (cap.recipe) {
      throw new Error(`recipe only allowed for ssh capabilities: ${cap.id}`);
    }
    return {
      id: cap.id,
      class: cap.class,
      where: cap.where,
      adapter: cap.adapter,
      recipe: cap.recipe || null,
      description: String(cap.description || ''),
    };
  });

  return {
    version: 1,
    phase: raw.phase,
    max_class: raw.max_class,
    ssh_host: raw.ssh_host,
    remote_root: raw.remote_root,
    capabilities,
  };
}

export function loadCatalog(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return validateCatalog(parseCatalogYaml(text));
}
