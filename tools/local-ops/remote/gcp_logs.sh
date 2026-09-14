#!/bin/bash
set -euo pipefail
ROOT="${LOCAL_OPS_REMOTE_ROOT:-/home/wikitang628/whop-wechat-bridge}"
NAME="${LOCAL_OPS_PM2_NAME:-whop-web-dashboard}"
LINES="${LOCAL_OPS_LOG_LINES:-40}"
cd "$ROOT"
case "$NAME" in
  whop-web-dashboard|whop-ingest-worker|whop-wechat-bridge) ;;
  *) echo '{"ok":false,"error":"invalid_pm2_name"}'; exit 1 ;;
esac
case "$LINES" in
  ''|*[!0-9]*) echo '{"ok":false,"error":"invalid_lines"}'; exit 1 ;;
esac
if [ "$LINES" -lt 1 ] || [ "$LINES" -gt 80 ]; then
  echo '{"ok":false,"error":"lines_out_of_range"}'
  exit 1
fi
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
# nostream: one-shot, never follows. No restart/stop/delete.
pm2 logs "$NAME" --lines "$LINES" --nostream >"$tmp" 2>&1 || true
python3 - "$NAME" "$LINES" "$tmp" <<'PY'
import json, sys
name, lines, path = sys.argv[1], int(sys.argv[2]), sys.argv[3]
with open(path, encoding="utf-8", errors="replace") as f:
    text = f.read()
# Cap payload
text = text[-12000:]
print(json.dumps({
    "ok": True,
    "name": name,
    "lines": lines,
    "log": text,
}, ensure_ascii=False))
PY
