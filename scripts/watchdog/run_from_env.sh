#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
if [[ -f "$ROOT/.env" ]]; then
  ALERT_LINE=$(grep -E '^WECHAT_ALERT_WEBHOOK_URL=' "$ROOT/.env" | head -1 || true)
  if [[ -n "$ALERT_LINE" ]]; then
    AVAL="${ALERT_LINE#WECHAT_ALERT_WEBHOOK_URL=}"
    AVAL="${AVAL%\"}"; AVAL="${AVAL#\"}"; AVAL="${AVAL%\'}"; AVAL="${AVAL#\'}"
    export WECHAT_ALERT_WEBHOOK_URL="$AVAL"
  fi
  LINE=$(grep -E '^WECHAT_WORK_WEBHOOK_URL=' "$ROOT/.env" | head -1 || true)
  if [[ -n "$LINE" ]]; then
    VAL="${LINE#WECHAT_WORK_WEBHOOK_URL=}"
    VAL="${VAL%\"}"; VAL="${VAL#\"}"; VAL="${VAL%\'}"; VAL="${VAL#\'}"
    export WECHAT_WORK_WEBHOOK_URL="$VAL"
  fi
fi
exec "$ROOT/scripts/watchdog/watchdog_probe.sh"
