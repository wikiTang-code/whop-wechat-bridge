---
name: gex-sidecar
description: >-
  How to read GEX sidecar snapshots (king/floor/regime). Use when summarizing
  data/gex/latest.json or ops.invoke gex.summarize / gex.status.
---

# GEX sidecar (read-only)

- Source of truth for agents: `ops.invoke` `gex.status` / `gex.freshness` / `gex.summarize`.
- `do_not_use_as_order` is mandatory. GEX is a structure sensor, not a trade signal.
- king/floor/regime are for watching and aligning with 赵哥 levels. Negative GEX is not a short.
- Do not overweight GEX when it does not align with 赵哥 levels.
- OI is T+1 (`oi_as_of=yesterday_close`). Weekend/closed snapshots may be `kind=nearest`, not 0DTE.
- Do not request or reconstruct full `ladder` / raw `matrix[]`.
- Collection stays on Windows (Futu OpenD). Never suggest running collect on gcp-vm.
