# Local ops gateway (P4.1)

Production C2 is **HITL**: Agent/MCP cannot alone approve.  
WeCom inbound: **C0 + `gex.collect`** (userid allowlist) via `https://wiki111.dpdns.org/wecom/callback`.

```powershell
cd C:\Users\86597\.gemini\antigravity\scratch\whop-wechat-bridge

node tools/local-ops/cli.js catalog
node tools/local-ops/cli.js invoke gex.status
```

## WeCom

Keep both running:

```powershell
npm run ops:http
ssh -N -R 127.0.0.1:18789:127.0.0.1:18789 gcp-vm
```

Phone:

```text
/ops help
/ops health
/ops collect          # async; then /ops gex status
```

`collect`/`gex run` ack immediately (WeCom 5s limit). Restart/deploy still CLI-only + human-approve for prod C2.

Deferred: cutover / rollback / env_set. Forbidden: place_order, pm2 delete/kill.
