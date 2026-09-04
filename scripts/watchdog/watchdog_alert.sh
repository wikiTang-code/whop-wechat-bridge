#!/usr/bin/env bash
# WeCom markdown helper for the external watchdog (bash+curl only).
# R2: alert only — this file must never invoke pm2.

send_watchdog_alert() {
  local level="$1"
  local title="$2"
  local detail="$3"
  local webhook="${WECHAT_ALERT_WEBHOOK_URL:-${WECHAT_WORK_WEBHOOK_URL:-}}"
  local icon md

  case "${level}" in
    ok) icon="🟢" ;;
    warn) icon="🟡" ;;
    *) icon="🔴"; level="critical" ;;
  esac

  md="${icon} **[WATCHDOG ${level^^}] ${title}**
> 子系统: \`watchdog\` · external bash probe

${detail}

_$(date -u +"%Y-%m-%dT%H:%M:%SZ")_"

  if [[ "${WATCHDOG_DRY_RUN:-0}" == "1" ]]; then
    echo "[watchdog_alert] DRY_RUN level=${level} title=${title}"
    echo "${md}"
    return 0
  fi

  if [[ -z "${webhook}" ]]; then
    echo "[watchdog_alert] WECHAT_WORK_WEBHOOK_URL unset — printing alert only" >&2
    echo "${md}" >&2
    return 0
  fi

  curl -sS -X POST "${webhook}" \
    -H 'Content-Type: application/json' \
    --connect-timeout 5 --max-time 10 \
    -d "$(jq -nc --arg c "${md}" '{msgtype:"markdown",markdown:{content:$c}}' 2>/dev/null \
      || python3 -c "import json,sys; print(json.dumps({'msgtype':'markdown','markdown':{'content':sys.argv[1]}))" "${md}")" \
    >/dev/null || echo "[watchdog_alert] webhook push failed" >&2
}
