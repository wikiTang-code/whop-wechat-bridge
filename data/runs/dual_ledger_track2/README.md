# dual_ledger_track2 outputs (REQ-059)

Track 2 dual ledger (style S × expectancy R-precursor). **REFERENCE_ONLY** / `hint_only`. Not copytrade. Not HUD / `place_order`.

Cloud delivers scripts + fixtures. Full archive runs happen on machine/GCP with `whop_archive.db`; paste summaries back into `docs/project/059-dual-ledger-track2-report.md`.

| path | git |
|------|-----|
| `bars/` | ignored (Yahoo cache) |
| `style_ledger_s.jsonl` / `expectancy_ledger_r.jsonl` / `summary.json` | ignored (regenerate) |

Reproduce (fixtures):

```bash
node scripts/knowledge/backtest_dual_ledger_track2.js \
  --events test/fixtures/dual_ledger_track2/events.jsonl \
  --bars-dir test/fixtures/dual_ledger_track2/bars \
  --no-fetch --lookback-days all \
  --out-dir data/runs/dual_ledger_track2
```
