#!/bin/bash
# Named pm2 restart --update-env only. Never all/delete/kill/stop.
set -euo pipefail
ROOT="${LOCAL_OPS_REMOTE_ROOT:-/home/wikitang628/whop-wechat-bridge}"
NAME="${LOCAL_OPS_PM2_NAME:-}"
cd "$ROOT"
case "$NAME" in
  whop-web-dashboard|whop-ingest-worker|whop-wechat-bridge) ;;
  *) echo '{"ok":false,"error":"invalid_pm2_name"}'; exit 1 ;;
esac
before="$(pm2 jlist)"
pm2 restart "$NAME" --update-env
sleep 2
after="$(pm2 jlist)"
python3 - "$NAME" "$before" "$after" <<'PY'
import json, sys
name, before_raw, after_raw = sys.argv[1], sys.argv[2], sys.argv[3]
before = json.loads(before_raw)
after = json.loads(after_raw)

def find(apps, n):
    for a in apps if isinstance(apps, list) else []:
        if a.get("name") == n:
            env = a.get("pm2_env") or {}
            monit = a.get("monit") or {}
            mem = monit.get("memory")
            return {
                "name": n,
                "status": env.get("status"),
                "restarts": env.get("restart_time"),
                "rss_mb": round(mem / (1024 * 1024), 1) if isinstance(mem, (int, float)) else None,
            }
    return None

print(json.dumps({
    "ok": True,
    "action": "pm2_restart",
    "name": name,
    "before": find(before, name),
    "after": find(after, name),
}, ensure_ascii=False))
PY
