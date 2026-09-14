---
name: local-ops
description: >-
  Invoke this project's local-ops gateway for GEX, dashboards, LM/tunnel,
  production gcp-vm health/HITL restart-deploy, and WeCom C0/C1-collect.
  Use when the user asks to check production, run GEX, open boards, LM Studio,
  tunnel, pm2 restart, deploy align, or WeCom /ops status.
---

# Local ops (P4.1)

Use MCP `whop-local-ops`. Prefer `ops.catalog` then `ops.invoke`.

## Classes

- **C0/C1**: observation + local collect/open boards
- **Local C2** (`lm.*`): `confirm_token` only (60s)
- **Production C2** (`gcp.pm2_restart`, `gcp.deploy_align`): **HITL**
  1. `ops.invoke` → `human_confirm_required` + token
  2. **Human** runs CLI (not MCP): `node tools/local-ops/cli.js human-approve <token>`
  3. Then `ops.confirm` / invoke with token
- **WeCom inbound** (`wiki111.dpdns.org` → GCP Caddy → SSH `-R` → `ops:http`):
  - C0 observe + **`gex.collect` only** (userid allowlist)
  - `/ops collect` / `/ops gex run` → async ack（企微 5s 限制）；结果用 `/ops gex status`
  - No restart/deploy/load via WeCom

Never invent `ssh gcp-vm "..."`. Never propose `place_order`, cutover, rollback, `pm2 delete`.

`gcp.deploy_align` requires `sha` = 40 lowercase hex already on `origin/main`; does **not** restart.
`gcp.pm2_restart` requires `name` ∈ whop-web-dashboard | whop-ingest-worker | whop-wechat-bridge.

If production looks bad: `gcp.health` / `gcp.health_bundle` first. Do not restart without the human.
Keep `npm run ops:http` and SSH reverse `18789` running for WeCom.
