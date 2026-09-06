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
PROBE_STATUS="unknown"
PROBE_DETAIL=""

# Sets PROBE_STATUS (ok|down|bad_http) and PROBE_DETAIL. No subshell.
probe_bridge() {
  local code curl_rc
  PROBE_DETAIL=""
  PROBE_STATUS="unknown"

  set +e
  code="$(curl -sS -o /tmp/whop_watchdog_body.$$ -w "%{http_code}" \
    --connect-timeout "${TIMEOUT_SEC}" --max-time "${TIMEOUT_SEC}" \
    "${HEALTH_URL}" 2>/tmp/whop_watchdog_err.$$)"
  curl_rc=$?
  set -e

  if [[ ${curl_rc} -ne 0 ]]; then
    set +e
    code="$(curl -sS -o /tmp/whop_watchdog_body.$$ -w "%{http_code}" \
      --connect-timeout "${TIMEOUT_SEC}" --max-time "${TIMEOUT_SEC}" \
      "${PROBE_URL}" 2>/tmp/whop_watchdog_err.$$)"
    curl_rc=$?
    set -e
    if [[ ${curl_rc} -ne 0 ]]; then
      PROBE_DETAIL="curl_rc=${curl_rc} err=$(tr '\n' ' ' </tmp/whop_watchdog_err.$$ 2>/dev/null || true)"
      rm -f /tmp/whop_watchdog_body.$$ /tmp/whop_watchdog_err.$$
      PROBE_STATUS="down"
      return 0
    fi
  fi

  rm -f /tmp/whop_watchdog_err.$$

  if [[ "${code}" == "200" ]]; then
    PROBE_DETAIL="http=${code} url=${HEALTH_URL}"
    rm -f /tmp/whop_watchdog_body.$$
    PROBE_STATUS="ok"
    return 0
  fi
  if [[ "${code}" == "401" || "${code}" == "404" ]]; then
    PROBE_DETAIL="http=${code} (process responded; treating as up)"
    rm -f /tmp/whop_watchdog_body.$$
    PROBE_STATUS="ok"
    return 0
  fi
  if [[ -z "${code}" || "${code}" == "000" ]]; then
    PROBE_DETAIL="http=${code} timeout_or_refused"
    rm -f /tmp/whop_watchdog_body.$$
    PROBE_STATUS="down"
    return 0
  fi

  PROBE_DETAIL="http=${code} body=$(head -c 200 /tmp/whop_watchdog_body.$$ 2>/dev/null | tr '\n' ' ')"
  rm -f /tmp/whop_watchdog_body.$$
  PROBE_STATUS="bad_http"
  return 0
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
  local prev
  probe_bridge

  # 首次失败时，进行二次重试确认，彻底消除瞬间网络或 GC 抖动误报
  if [[ "${PROBE_STATUS}" != "ok" ]]; then
    sleep 2
    probe_bridge
  fi

  prev="$(read_prev_state)"

  echo "[watchdog] status=${PROBE_STATUS} prev=${prev} detail=${PROBE_DETAIL}"

  if [[ "${PROBE_STATUS}" == "ok" ]]; then
    if [[ "${prev}" == "down" || "${prev}" == "bad_http" ]]; then
      send_watchdog_alert "ok" "whop-wechat-bridge 已恢复" \
        "端口 ${PORT} /health 探测恢复正常。\n证据: ${PROBE_DETAIL}"
    fi
    write_state "ok"
    exit 0
  fi

  if [[ "${prev}" != "${PROBE_STATUS}" ]]; then
    send_watchdog_alert "critical" "whop-wechat-bridge 无响应" \
      "探测失败（仅告警，不会 pm2 restart）。\n证据: ${PROBE_DETAIL}\n建议: 人工检查 pm2/日志与事件循环卡死。"
  else
    echo "[watchdog] still ${PROBE_STATUS}; edge already alerted — skip flood"
  fi
  write_state "${PROBE_STATUS}"

  if [[ "${DRY_RUN}" == "1" ]]; then
    exit 0
  fi
  exit 1
}

main "$@"
