#!/usr/bin/env bash
# P0-2 external watchdog — ALERT ONLY (R1/R2).
# NEVER call pm2 restart. NEVER spawn Node for the watchdog itself.
# Driven by crontab or systemd timer.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=watchdog_alert.sh
source "${SCRIPT_DIR}/watchdog_alert.sh"

HOST="${WATCHDOG_HOST:-127.0.0.1}"
PORT="${WATCHDOG_PORT:-8085}"
TIMEOUT_SEC="${WATCHDOG_TIMEOUT_SEC:-5}"
STATE_FILE="${WATCHDOG_STATE_FILE:-${SCRIPT_DIR}/.watchdog_state}"
HEALTH_URL="http://${HOST}:${PORT}/health"
PROBE_URL="http://${HOST}:${PORT}/"

DRY_RUN="${WATCHDOG_DRY_RUN:-0}"

# Returns: ok | down | bad_http
# Sets global PROBE_DETAIL
probe_bridge() {
  local code body curl_rc
  PROBE_DETAIL=""

  # Prefer /health when present; fall back to root TCP/HTTP reachability.
  set +e
  body="$(curl -sS -o /tmp/whop_watchdog_body.$$ -w "%{http_code}" \
    --connect-timeout "${TIMEOUT_SEC}" --max-time "${TIMEOUT_SEC}" \
    "${HEALTH_URL}" 2>/tmp/whop_watchdog_err.$$)"
  curl_rc=$?
  set -e

  if [[ ${curl_rc} -ne 0 ]]; then
    # Connection failed — try root as secondary signal (port listen check)
    set +e
    body="$(curl -sS -o /tmp/whop_watchdog_body.$$ -w "%{http_code}" \
      --connect-timeout "${TIMEOUT_SEC}" --max-time "${TIMEOUT_SEC}" \
      "${PROBE_URL}" 2>/tmp/whop_watchdog_err.$$)"
    curl_rc=$?
    set -e
    if [[ ${curl_rc} -ne 0 ]]; then
      PROBE_DETAIL="curl_rc=${curl_rc} err=$(tr '\n' ' ' </tmp/whop_watchdog_err.$$ 2>/dev/null || true)"
      rm -f /tmp/whop_watchdog_body.$$ /tmp/whop_watchdog_err.$$
      echo "down"
      return
    fi
  fi

  code="${body}"
  rm -f /tmp/whop_watchdog_err.$$

  # 200 = healthy. 401/404 = process up (auth or pre-/health deploy). 5xx/other = bad.
  if [[ "${code}" == "200" ]]; then
    PROBE_DETAIL="http=${code} url=${HEALTH_URL}"
    rm -f /tmp/whop_watchdog_body.$$
    echo "ok"
    return
  fi
  if [[ "${code}" == "401" || "${code}" == "404" ]]; then
    PROBE_DETAIL="http=${code} (process responded; treating as up)"
    rm -f /tmp/whop_watchdog_body.$$
    echo "ok"
    return
  fi
  if [[ -z "${code}" || "${code}" == "000" ]]; then
    PROBE_DETAIL="http=${code} timeout_or_refused"
    rm -f /tmp/whop_watchdog_body.$$
    echo "down"
    return
  fi

  PROBE_DETAIL="http=${code} body=$(head -c 200 /tmp/whop_watchdog_body.$$ 2>/dev/null | tr '\n' ' ')"
  rm -f /tmp/whop_watchdog_body.$$
  echo "bad_http"
}

read_prev_state() {
  if [[ -f "${STATE_FILE}" ]]; then
    tr -d '[:space:]' <"${STATE_FILE}"
  else
    echo "unknown"
  fi
}

write_state() {
  local s="$1"
  mkdir -p "$(dirname "${STATE_FILE}")"
  printf '%s\n' "${s}" >"${STATE_FILE}"
}

main() {
  local status prev
  status="$(probe_bridge)"
  prev="$(read_prev_state)"

  echo "[watchdog] status=${status} prev=${prev} detail=${PROBE_DETAIL}"

  if [[ "${status}" == "ok" ]]; then
    if [[ "${prev}" == "down" || "${prev}" == "bad_http" ]]; then
      send_watchdog_alert "ok" "whop-wechat-bridge 已恢复" \
        "端口 ${PORT} /health 探测恢复正常。\n证据: ${PROBE_DETAIL}"
    fi
    write_state "ok"
    exit 0
  fi

  # down or bad_http
  if [[ "${prev}" != "${status}" ]]; then
    send_watchdog_alert "critical" "whop-wechat-bridge 无响应" \
      "探测失败（仅告警，不会 pm2 restart）。\n证据: ${PROBE_DETAIL}\n建议: 人工检查 pm2/日志与事件循环卡死。"
  else
    echo "[watchdog] still ${status}; edge already alerted — skip flood"
  fi
  write_state "${status}"

  # Non-zero so cron/systemd can record failure; still no restart.
  if [[ "${DRY_RUN}" == "1" ]]; then
    exit 0
  fi
  exit 1
}

main "$@"
