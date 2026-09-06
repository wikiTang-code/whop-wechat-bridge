#!/usr/bin/env python3
"""Print a one-screen digest of data/gex/latest.json."""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import collect as gex  # noqa: E402


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else gex.OUTPUT_DIR / "latest.json"
    if not path.exists():
        print(f"找不到 {path}，先跑 collect_futu.py", file=sys.stderr)
        return 1
    data = json.loads(path.read_text(encoding="utf-8"))
    print(f"{data.get('generated_at')}  {data.get('session')}  {data.get('source')}")
    print(data.get("disclaimer", ""))
    for code, item in (data.get("zero_dte") or {}).items():
        king = item["king"]
        floor = item["floor"]
        print(
            f"\n{code} spot {item['spot']}  {item['kind']} {item['expiry']}  "
            f"local {item['regime']} ({gex.fmt_money(item['local_gex'])})"
        )
        print(
            f"  PRICE~{item['spot_strike']:g}  "
            f"FLOOR {floor['strike']:g} {gex.fmt_money(floor['net_gex'])}  "
            f"KING {king['strike']:g} {gex.fmt_money(king['net_gex'])}"
        )
    for code, item in (data.get("matrix") or {}).items():
        king = item["king"]
        floor = item["floor"]
        print(f"\n{code} MATRIX spot {item['spot']}  PRICE~{item['spot_strike']:g}")
        print(
            f"  FLOOR {floor['strike']:g} @{floor['expiry']} {gex.fmt_money(floor['net_gex'])}  "
            f"KING {king['strike']:g} @{king['expiry']} {gex.fmt_money(king['net_gex'])}"
        )
        for exp, tot in (item.get("column_totals") or {}).items():
            label = "正列" if tot >= 0 else "净负列"
            print(f"  COL {exp} {gex.fmt_money(tot)} {label}")
    errs = data.get("errors") or []
    if errs:
        print("\nerrors:")
        for e in errs:
            print(f"  {e}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
