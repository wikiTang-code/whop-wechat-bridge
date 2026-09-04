# External watchdog (P0-2) — install notes

Hard rules (R1/R2):

- Must be **bash + curl**, driven by **crontab** or **systemd timer**
- **Never** run the watchdog as a Node/V8 process
- **Alert only** — never `pm2 restart` or any process-kill/restart loop

## Files

| File | Role |
|---|---|
| `watchdog_probe.sh` | Probe `127.0.0.1:8085` `/health` (fallback `/`); edge-trigger alert + recovery |
| `watchdog_alert.sh` | WeCom markdown POST via curl |
| `.watchdog_state` | Local edge-trigger state (ok/down/bad_http) — runtime, not committed |

## Dry-run (safe, no webhook)

```bash
cd /home/wikitang628/whop-wechat-bridge
chmod +x scripts/watchdog/*.sh
WATCHDOG_DRY_RUN=1 WECHAT_WORK_WEBHOOK_URL= ./scripts/watchdog/watchdog_probe.sh
```

## One-shot live probe (sends WeCom on edge)

Export the same webhook the bridge uses (do **not** commit secrets):

```bash
export WECHAT_WORK_WEBHOOK_URL='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...'
./scripts/watchdog/watchdog_probe.sh
```

## crontab (every minute)

```cron
* * * * * WECHAT_WORK_WEBHOOK_URL='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=YOUR_KEY' /home/wikitang628/whop-wechat-bridge/scripts/watchdog/watchdog_probe.sh >> /home/wikitang628/whop-wechat-bridge/logs/watchdog.log 2>&1
```

Create `logs/` if needed. Prefer loading the webhook from a root-only env file rather than putting the key in crontab world-readable copies.

## systemd timer (alternative)

`/etc/systemd/system/whop-bridge-watchdog.service`:

```ini
[Unit]
Description=Whop bridge external watchdog (alert only)
After=network.target

[Service]
Type=oneshot
User=wikitang628
Environment=WECHAT_WORK_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=YOUR_KEY
Environment=WATCHDOG_PORT=8085
ExecStart=/home/wikitang628/whop-wechat-bridge/scripts/watchdog/watchdog_probe.sh
```

`/etc/systemd/system/whop-bridge-watchdog.timer`:

```ini
[Unit]
Description=Run whop bridge watchdog every minute

[Timer]
OnBootSec=30s
OnUnitActiveSec=60s
Unit=whop-bridge-watchdog.service

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now whop-bridge-watchdog.timer
```

## Acceptance

1. Manually stop listening on 8085 (or block with firewall) → receive WeCom critical once
2. Restore process → receive recovery notice once
3. Confirm logs contain **no** `pm2 restart`
