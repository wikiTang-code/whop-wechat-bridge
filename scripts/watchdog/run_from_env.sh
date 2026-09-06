#!/usr/bin/env bash
# Load WeCom webhook from repo .env then exec a watchdog script (R1/R2: bash only).
# Usage:
#   ./run_from_env.sh                         # default → watchdog_probe.sh
#   ./run_from_env.sh page_smoke.sh
#   ./run_from_env.sh consistency_smoke.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

TARGET="${1:-watchdog_probe.sh}"
# Allow only bare filenames under this directory (no path traversal).
if [[ "${TARGET}" == */* || "${TARGET}" == .* ]]; then
  echo "[run_from_env] refused unsafe target: ${TARGET}" >&2
  exit 2
fi
SCRIPT="${ROOT}/scripts/watchdog/${TARGET}"
if [[ ! -f "${SCRIPT}" ]]; then
  echo "[run_from_env] missing script: ${SCRIPT}" >&2
  exit 2
fi

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
exec "${SCRIPT}"
