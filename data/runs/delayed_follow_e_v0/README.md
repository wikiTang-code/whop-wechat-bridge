# delayed_follow_e_v0 outputs (REQ-058)

Research-only hypothesized-arrival Δ sweep. **Not** live HUD / L2a / `place_order`.

| path | git |
|------|-----|
| `bars/` | ignored (Yahoo cache) |
| `events.jsonl` / `summary.json` | ignored (regenerate) |
| `fixture_events.jsonl` / `fixture_summary.json` | committed sample from `--no-fetch` fixture |

Reproduce:

```bash
node scripts/knowledge/backtest_delayed_follow_e_v0.js \
  --delta-mins 0,1,3,5 --bar 5m --symbols IREN,SOXL,MU,CRWV,COHR \
  --events test/fixtures/delayed_follow_e_v0/events.jsonl \
  --bars-dir test/fixtures/delayed_follow_e_v0/bars \
  --no-fetch --lookback-days all \
  --out-dir data/runs/delayed_follow_e_v0
```

Timezone: `America/New_York`. Default Yahoo path is RTH (`includePrePost=false`). See `docs/project/058-delayed-follow-e-v0-report.md`.
