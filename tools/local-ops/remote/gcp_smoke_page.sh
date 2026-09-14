#!/bin/bash
set -euo pipefail
ROOT="${LOCAL_OPS_REMOTE_ROOT:-/home/wikitang628/whop-wechat-bridge}"
cd "$ROOT"
export WATCHDOG_DRY_RUN=1
# Clear webhook so dry-run never posts.
export WECHAT_WORK_WEBHOOK_URL=
export WECHAT_ALERT_WEBHOOK_URL=
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
set +e
bash scripts/watchdog/page_smoke.sh >"$tmp" 2>&1
code=$?
set -e
python3 - "$code" "$tmp" <<'PY'
import json, sys
code = int(sys.argv[1])
with open(sys.argv[2], encoding="utf-8", errors="replace") as f:
    text = f.read()[-8000:]
print(json.dumps({
    "ok": code == 0,
    "exit_code": code,
    "dry_run": True,
    "output": text,
}, ensure_ascii=False))
PY
