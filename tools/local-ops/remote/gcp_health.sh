#!/bin/bash
set -euo pipefail
ROOT="${LOCAL_OPS_REMOTE_ROOT:-/home/wikitang628/whop-wechat-bridge}"
cd "$ROOT"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
curl -sS --max-time 8 -o "$tmp" http://127.0.0.1:8085/health
python3 - "$tmp" <<'PY'
import json, sys
path = sys.argv[1]
with open(path, encoding="utf-8") as f:
    j = json.load(f)
subs = j.get("subsystems") or {}
compact = {}
if isinstance(subs, dict):
    for k, v in subs.items():
        if isinstance(v, dict):
            compact[k] = v.get("status") or v.get("state") or v.get("ok")
        else:
            compact[k] = v
out = {
    "ok": j.get("ok"),
    "status": j.get("status"),
    "subsystems": compact,
}
proc = (subs.get("process") if isinstance(subs, dict) else None) or {}
if isinstance(proc, dict) and proc.get("memoryRssMb") is not None:
    out["rss_mb"] = proc.get("memoryRssMb")
print(json.dumps(out, ensure_ascii=False))
PY
