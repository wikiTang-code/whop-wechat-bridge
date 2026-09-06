#!/usr/bin/env bash
set -euo pipefail
ROOT=/home/wikitang628/whop-wechat-bridge
mkdir -p "$ROOT/logs"
crontab -l 2>/dev/null > /tmp/cron.bak.whop || true
cat > /tmp/whop.cron <<'EOF'
* * * * * /home/wikitang628/whop-wechat-bridge/scripts/watchdog/run_from_env.sh >> /home/wikitang628/whop-wechat-bridge/logs/watchdog.log 2>&1
*/3 * * * * /home/wikitang628/whop-wechat-bridge/scripts/watchdog/run_from_env.sh page_smoke.sh >> /home/wikitang628/whop-wechat-bridge/logs/watchdog_smoke.log 2>&1
*/5 * * * * /home/wikitang628/whop-wechat-bridge/scripts/watchdog/run_from_env.sh consistency_smoke.sh >> /home/wikitang628/whop-wechat-bridge/logs/watchdog_consistency.log 2>&1
*/15 * * * * cd /home/wikitang628/whop-wechat-bridge && node scripts/offline_queue_worker.js --cron >> /home/wikitang628/whop-wechat-bridge/logs/offline_worker.log 2>&1
0 2 * * 0,6 cd /home/wikitang628/whop-wechat-bridge && /usr/bin/node scripts/run_offline_asset_sync.js >> /home/wikitang628/whop-wechat-bridge/logs/offline_asset_sync.log 2>&1
EOF
crontab /tmp/whop.cron
echo "=== crontab installed ==="
crontab -l
