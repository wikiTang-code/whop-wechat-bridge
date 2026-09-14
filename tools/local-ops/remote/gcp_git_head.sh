#!/bin/bash
set -euo pipefail
ROOT="${LOCAL_OPS_REMOTE_ROOT:-/home/wikitang628/whop-wechat-bridge}"
cd "$ROOT"
sha="$(git rev-parse HEAD)"
short="$(git rev-parse --short HEAD)"
subj="$(git log -1 --format=%s)"
branch="$(git rev-parse --abbrev-ref HEAD)"
dirty="$(git status -sb)"
python3 - "$sha" "$short" "$subj" "$branch" "$dirty" <<'PY'
import json, sys
sha, short, subj, branch, dirty = sys.argv[1:6]
print(json.dumps({
    "ok": True,
    "sha": sha,
    "short": short,
    "subject": subj,
    "branch": branch,
    "status_sb": dirty.splitlines()[:8],
}, ensure_ascii=False))
PY
