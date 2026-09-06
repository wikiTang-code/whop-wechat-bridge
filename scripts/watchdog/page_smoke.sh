#!/usr/bin/env bash
# P2-12d external page smoke watchdog — ALERT ONLY (R1/R2).
# NEVER restart services automatically. NEVER spawn Node for the watchdog itself.
# Driven by crontab or systemd timer.
# Checks critical Web routes to prevent "green shell with dead APIs" (页壳假绿/路由漏挂).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=watchdog_alert.sh
source "${SCRIPT_DIR}/watchdog_alert.sh"

HOST="${WATCHDOG_HOST:-127.0.0.1}"
PORT="${WATCHDOG_PORT:-8085}"
BASE_URL="${WATCHDOG_BASE_URL:-http://${HOST}:${PORT}}"
TIMEOUT_SEC="${WATCHDOG_TIMEOUT_SEC:-5}"
STATE_FILE="${PAGE_SMOKE_STATE_FILE:-${SCRIPT_DIR}/.page_smoke_state}"
DRY_RUN="${WATCHDOG_DRY_RUN:-0}"

# 关键页与 API 路由最小集 (与 route-coverage-probe.js 保持一致)
CRITICAL_PATHS=(
  "/api/messages?limit=1"
  "/api/monitoring/dashboard"
  "/api/l2a/dates"
  "/api/l2b/drycut20"
  "/api/review/queue?date=2026-06-26"
  "/api/pipeline/queue-status"
  "/review_workbench.html"
  "/monitoring"
)

PID=$$
BODY_FILE="/tmp/whop_smoke_body.${PID}"
ERR_FILE="/tmp/whop_smoke_err.${PID}"

cleanup() {
  rm -f "${BODY_FILE}" "${ERR_FILE}" 2>/dev/null || true
}
trap cleanup EXIT

fail_count=0
total_count=${#CRITICAL_PATHS[@]}
failed_details=""

for p in "${CRITICAL_PATHS[@]}"; do
  url="${BASE_URL}${p}"
  set +e
  code="$(curl -sS -o "${BODY_FILE}" -w "%{http_code}" \
    --connect-timeout "${TIMEOUT_SEC}" --max-time "${TIMEOUT_SEC}" \
    "${url}" 2>"${ERR_FILE}")"
  curl_rc=$?
  set -e

  is_failed=0
  reason=""

  if [[ ${curl_rc} -ne 0 ]]; then
    is_failed=1
    err_msg="$(tr '\n' ' ' < "${ERR_FILE}" 2>/dev/null || true)"
    reason="connect_failed(rc=${curl_rc}, err=${err_msg:0:80})"
  elif [[ "${code}" == "404" ]]; then
    is_failed=1
    reason="HTTP 404 (Route not mounted / 路由未挂载)"
  elif [[ "${code}" == "500" || "${code}" == "502" || "${code}" == "503" ]]; then
    is_failed=1
    reason="HTTP ${code} (Server error)"
  else
    # 检查 body 是否含有 Express 默认 Cannot GET
    if grep -qi "Cannot GET" "${BODY_FILE}" 2>/dev/null; then
      is_failed=1
      reason="Express 'Cannot GET' (Route missing)"
    fi
  fi

  if [[ ${is_failed} -eq 1 ]]; then
    ((fail_count++)) || true
    failed_details="${failed_details}• \`${p}\` -> ${reason}\n"
  fi
done

# 确定当前状态
if [[ ${fail_count} -eq 0 ]]; then
  CURRENT_STATUS="ok"
elif [[ ${fail_count} -eq 1 ]]; then
  CURRENT_STATUS="warn"
else
  CURRENT_STATUS="critical"
fi

LAST_STATUS="ok"
if [[ -f "${STATE_FILE}" ]]; then
  LAST_STATUS="$(cat "${STATE_FILE}" 2>/dev/null || echo "ok")"
fi

echo "[page_smoke] status=${CURRENT_STATUS} fail=${fail_count}/${total_count} (last=${LAST_STATUS})"

# 边缘触发 (Edge-triggered) 告警决策
if [[ "${CURRENT_STATUS}" != "${LAST_STATUS}" ]]; then
  if [[ "${CURRENT_STATUS}" == "warn" || "${CURRENT_STATUS}" == "critical" ]]; then
    detail_text="* 目标基址: \`${BASE_URL}\`\n* 异常路由数: **${fail_count}/${total_count}**\n* 异常明细:\n${failed_details}\n⚠️ **处理指引**: 严禁自动重启服务 (遵循 R2 告警不重载)。请检查 scripts/web_runner.js 路由挂载或只读中间件拦截。"
    send_watchdog_alert "${CURRENT_STATUS}" "关键页 API 路由冒烟失败 (页壳假绿/路由漏挂)" "${detail_text}"
  elif [[ "${CURRENT_STATUS}" == "ok" && "${LAST_STATUS}" != "ok" ]]; then
    recover_text="* 目标基址: \`${BASE_URL}\`\n* 冒烟路由数: **${total_count}** 全部正常响应。"
    send_watchdog_alert "ok" "关键页 API 路由冒烟已恢复正常" "${recover_text}"
  fi
  echo "${CURRENT_STATUS}" > "${STATE_FILE}"
fi

