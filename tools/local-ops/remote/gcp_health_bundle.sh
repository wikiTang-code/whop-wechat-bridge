#!/bin/bash
# Self-contained: safe to pipe via `ssh host bash -s` without sibling files on disk.
set -euo pipefail
ROOT="${LOCAL_OPS_REMOTE_ROOT:-/home/wikitang628/whop-wechat-bridge}"
cd "$ROOT"
tmp="$(mktemp)"
pm2_tmp="$(mktemp)"
trap 'rm -f "$tmp" "$pm2_tmp"' EXIT
curl -sS --max-time 8 -o "$tmp" http://127.0.0.1:8085/health
health_json="$(python3 - "$tmp" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    j = json.load(f)
subs = j.get("subsystems") or {}
compact = {}
if isinstance(subs, dict):
    for k, v in subs.items():
        compact[k] = v.get("status") if isinstance(v, dict) else v
print(json.dumps({"ok": j.get("ok"), "status": j.get("status"), "subsystems": compact}, ensure_ascii=False))
PY
)"
# Do NOT pipe pm2 into `python3 - <<EOF` — heredoc steals stdin and causes EPIPE/empty JSON.
pm2 jlist >"$pm2_tmp" 2>/dev/null || true
pm2_json="$(python3 - "$pm2_tmp" <<'PY'
import json, sys
path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as f:
        raw = f.read().strip()
    apps = json.loads(raw) if raw else []
except Exception as e:
    print(json.dumps({"ok": False, "apps": [], "error": f"pm2_parse:{e}"}, ensure_ascii=False))
    raise SystemExit(0)
out = []
for app in (apps if isinstance(apps, list) else [])[:12]:
    env = app.get("pm2_env") or {}
    mem = (app.get("monit") or {}).get("memory")
    out.append({
        "name": app.get("name"),
        "status": env.get("status"),
        "rss_mb": round(mem / (1024 * 1024), 1) if isinstance(mem, (int, float)) else None,
    })
print(json.dumps({"ok": True, "apps": out}, ensure_ascii=False))
PY
)"
sha="$(git rev-parse HEAD)"
short="$(git rev-parse --short HEAD)"
branch="$(git rev-parse --abbrev-ref HEAD)"
python3 - "$health_json" "$pm2_json" "$sha" "$short" "$branch" <<'PY'
import json, sys
health = json.loads(sys.argv[1])
pm2 = json.loads(sys.argv[2])
print(json.dumps({
    "ok": bool(health.get("ok")),
    "health": health,
    "pm2": pm2,
    "git": {"sha": sys.argv[3], "short": sys.argv[4], "branch": sys.argv[5]},
}, ensure_ascii=False))
PY
