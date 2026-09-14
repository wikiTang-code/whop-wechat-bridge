# Local ops gateway (P4.1)

Production C2 is **HITL**: Agent/MCP cannot alone approve.  
WeCom inbound: **C0 + `gex.collect`** (userid allowlist) via `https://wiki111.dpdns.org/wecom/callback`.

```powershell
cd C:\Users\86597\.gemini\antigravity\scratch\whop-wechat-bridge

node tools/local-ops/cli.js catalog
node tools/local-ops/cli.js invoke gex.status
```

## WeCom stack（常驻）

```powershell
npm run ops:wecom:start      # ops:http + ssh -R 18789
npm run ops:wecom:stop
npm run ops:wecom:autostart  # 注册当前用户登录自启（一次性）
```

企微可信 IP 请加 **GCP 公网** `35.212.142.173`（主动推送默认经 `ssh gcp-vm` 出站，避免家宽 IP 漂移）。仅调试可设 `WECOM_OPS_PUSH_VIA=direct`。

Phone:

```text
/ops help
/ops health
/ops collect          # async; then /ops gex status
```

`collect`/`gex run` ack immediately (WeCom 5s limit). Restart/deploy still CLI-only + human-approve for prod C2.

Deferred: cutover / rollback / env_set. Forbidden: place_order, pm2 delete/kill.
