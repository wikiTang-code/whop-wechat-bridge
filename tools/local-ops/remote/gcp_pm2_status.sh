#!/bin/bash
set -euo pipefail
ROOT="${LOCAL_OPS_REMOTE_ROOT:-/home/wikitang628/whop-wechat-bridge}"
cd "$ROOT"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
pm2 jlist > "$tmp"
python3 - "$tmp" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    raw = f.read()
try:
    apps = json.loads(raw)
except json.JSONDecodeError:
    print(json.dumps({"ok": False, "error": "pm2_jlist_invalid"}))
    raise SystemExit(0)
out = []
if isinstance(apps, list):
    for app in apps[:12]:
        env = app.get("pm2_env") or {}
        monit = app.get("monit") or {}
        mem = monit.get("memory")
        out.append({
            "name": app.get("name"),
            "status": env.get("status"),
            "rss_mb": round(mem / (1024 * 1024), 1) if isinstance(mem, (int, float)) else None,
            "restarts": env.get("restart_time"),
        })
print(json.dumps({"ok": True, "apps": out}, ensure_ascii=False))
PY
