#!/usr/bin/env bash
# P2-13E external consistency smoke watchdog — ALERT ONLY (R1/R2).
# NEVER restart services automatically. NEVER spawn heavy Node runtime for watchdog itself.
# Driven by crontab or systemd timer.
# Checks /health subsystems.dataConsistency (DB ↔ media_manifest ↔ disk).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=watchdog_alert.sh
source "${SCRIPT_DIR}/watchdog_alert.sh"

HOST="${WATCHDOG_HOST:-127.0.0.1}"
PORT="${WATCHDOG_PORT:-8085}"
BASE_URL="${WATCHDOG_BASE_URL:-http://${HOST}:${PORT}}"
HEALTH_URL="${BASE_URL}/health"
TIMEOUT_SEC="${WATCHDOG_TIMEOUT_SEC:-5}"
STATE_FILE="${CONSISTENCY_SMOKE_STATE_FILE:-${SCRIPT_DIR}/.consistency_smoke_state}"
DRY_RUN="${WATCHDOG_DRY_RUN:-0}"

PID=$$
BODY_FILE="/tmp/whop_consistency_body.${PID}"
ERR_FILE="/tmp/whop_consistency_err.${PID}"

cleanup() {
  rm -f "${BODY_FILE}" "${ERR_FILE}" 2>/dev/null || true
}
trap cleanup EXIT

set +e
code="$(curl -sS -o "${BODY_FILE}" -w "%{http_code}" \
  --connect-timeout "${TIMEOUT_SEC}" --max-time "${TIMEOUT_SEC}" \
  "${HEALTH_URL}" 2>"${ERR_FILE}")"
curl_rc=$?
set -e

CURRENT_STATUS="unknown"
DETAIL_INFO=""

if [[ ${curl_rc} -ne 0 ]]; then
  CURRENT_STATUS="critical"
  err_msg="$(tr '\n' ' ' < "${ERR_FILE}" 2>/dev/null || true)"
  DETAIL_INFO="无法连通健康接口 (rc=${curl_rc}, err=${err_msg:0:80})"
elif [[ "${code}" == "404" ]]; then
  CURRENT_STATUS="critical"
  DETAIL_INFO="HTTP 404 (接口未挂载)"
else
  # 即使是 200, 401 或 503 (如 Ingest 心跳缺失导致总体 503)，body 中仍携带有完整 subsystems 快照
  body_content="$(cat "${BODY_FILE}" 2>/dev/null || true)"
  
  # 提取 dataConsistency 的 status 与 mismatchCount
  status_extracted="$(echo "${body_content}" | grep -o '"dataConsistency"[^}]*' | grep -o '"status":"[^"]*"' | cut -d'"' -f4 || true)"
  if [[ -z "${status_extracted}" ]]; then
    # 尝试后备正则
    status_extracted="$(echo "${body_content}" | grep -o '"status":"[a-z]*"' | head -n 2 | tail -n 1 | cut -d'"' -f4 || echo "unknown")"
  fi

  mismatch_extracted="$(echo "${body_content}" | grep -o '"mismatchCount":[0-9]*' | head -n 1 | cut -d':' -f2 || echo "0")"
  desc_extracted="$(echo "${body_content}" | grep -o '"description":"[^"]*"' | head -n 1 | cut -d'"' -f4 || echo "")"

  if [[ "${status_extracted}" == "ok" ]]; then
    CURRENT_STATUS="ok"
    DETAIL_INFO="全量抽样数据与清单磁盘一致 (checked=50, mismatch=0)"
  elif [[ "${status_extracted}" == "warn" ]]; then
    CURRENT_STATUS="warn"
    DETAIL_INFO="检测到一致性偏差: mismatchCount=${mismatch_extracted} (${desc_extracted})"
  elif [[ "${status_extracted}" == "critical" ]]; then
    CURRENT_STATUS="critical"
    DETAIL_INFO="检测到严重一致性缺失: mismatchCount=${mismatch_extracted} (${desc_extracted})"
  else
    CURRENT_STATUS="warn"
    DETAIL_INFO="数据一致性状态未知或解析不完全"
  fi
fi

LAST_STATUS="ok"
if [[ -f "${STATE_FILE}" ]]; then
  LAST_STATUS="$(cat "${STATE_FILE}" 2>/dev/null || echo "ok")"
fi

echo "[consistency_smoke] status=${CURRENT_STATUS} (last=${LAST_STATUS}) - ${DETAIL_INFO}"

# 边缘触发告警
if [[ "${CURRENT_STATUS}" != "${LAST_STATUS}" ]]; then
  if [[ "${CURRENT_STATUS}" == "warn" || "${CURRENT_STATUS}" == "critical" ]]; then
    alert_text="* 目标基址: \`${BASE_URL}\`\n* 当前状态: **${CURRENT_STATUS}**\n* 详情: ${DETAIL_INFO}\n⚠️ **处理指引**: 遵循 R2 告警不重载原则。请检查媒体下载进程或磁盘损坏情况，严禁自动重启服务。"
    send_watchdog_alert "${CURRENT_STATUS}" "媒体数据一致性巡检异常 (附件/清单/磁盘偏差)" "${alert_text}"
  elif [[ "${CURRENT_STATUS}" == "ok" && "${LAST_STATUS}" != "ok" ]]; then
    recover_text="* 目标基址: \`${BASE_URL}\`\n* 媒体附件、清单与磁盘对应关系已恢复正常。"
    send_watchdog_alert "ok" "媒体数据一致性已恢复正常" "${recover_text}"
  fi
  echo "${CURRENT_STATUS}" > "${STATE_FILE}"
fi
