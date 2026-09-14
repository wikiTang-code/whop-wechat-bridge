#!/bin/bash
# Align working tree to a 40-char SHA already ancestor of origin/main. NEVER auto-restart.
set -euo pipefail
ROOT="${LOCAL_OPS_REMOTE_ROOT:-/home/wikitang628/whop-wechat-bridge}"
SHA="${LOCAL_OPS_GIT_SHA:-}"
cd "$ROOT"
if ! printf '%s' "$SHA" | grep -Eq '^[0-9a-f]{40}$'; then
  echo '{"ok":false,"error":"sha_must_be_40_lowercase_hex"}'
  exit 1
fi
before="$(git rev-parse HEAD)"
git fetch --quiet origin
if ! git cat-file -t "$SHA" >/dev/null 2>&1; then
  python3 -c 'import json,sys; print(json.dumps({"ok":False,"error":"sha_not_found","sha":sys.argv[1]}))' "$SHA"
  exit 1
fi
if ! git merge-base --is-ancestor "$SHA" origin/main; then
  python3 -c 'import json,sys; print(json.dumps({"ok":False,"error":"sha_not_ancestor_of_origin_main","sha":sys.argv[1],"before":sys.argv[2]}))' "$SHA" "$before"
  exit 1
fi
git reset --hard "$SHA"
after="$(git rev-parse HEAD)"
short="$(git rev-parse --short HEAD)"
subj="$(git log -1 --format=%s)"
python3 - "$before" "$after" "$short" "$subj" "$SHA" <<'PY'
import json, sys
before, after, short, subj, sha = sys.argv[1:6]
print(json.dumps({
    "ok": after == sha,
    "action": "deploy_align",
    "before": before,
    "after": after,
    "short": short,
    "subject": subj,
    "sha": sha,
    "restarted": False,
    "note": "Code aligned only. Run gcp.pm2_restart separately if needed.",
}, ensure_ascii=False))
PY
