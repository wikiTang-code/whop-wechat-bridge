#!/usr/bin/env python3
"""GEX sidecar via Futu OpenD (option chain + greeks) on this Windows box.

Chart language follows NineLooms/heatseeker-lb and NineLooms/gex-matrix-lb
(https://longbridge.com/zh-CN/topics/43511616). Not a fork.

Index spot (SPX/VIX/NDX) is not available from Futu OpenAPI; we take it from
Longbridge CLI when present. Equity spots come from Futu snapshots.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import time
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

from futu import OpenQuoteContext, RET_OK, SysConfig

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("gex_collect", HERE / "collect.py")
gex = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gex)

OWNER = {
    "SPY": "US.SPY",
    "QQQ": "US.QQQ",
    "TSLA": "US.TSLA",
    "NVDA": "US.NVDA",
    "SPX": "US..SPX",
    "VIX": "US..VIX",
    "NDX": "US..NDX",
}
INDEX_TICKERS = {"SPX", "VIX", "NDX"}
SNAP_BATCH = 80
SNAP_GAP = 0.6
DEFAULT_ZERO_DTE = ("SPY", "QQQ", "SPX")
DEFAULT_MATRIX = ("TSLA",)


def futu_code(ticker: str) -> str:
    t = ticker.upper().strip()
    if t not in OWNER:
        raise ValueError(f"未配置的标的 {t}，可选: {', '.join(OWNER)}")
    return OWNER[t]


def must_ok(ret, data, what: str):
    if ret != RET_OK:
        raise RuntimeError(f"{what}: {data}")
    return data


def list_future_expiries(ctx, owner: str) -> list[str]:
    data = must_ok(*ctx.get_option_expiration_date(owner), f"expiry {owner}")
    today = date.today().isoformat()
    exps = sorted({str(x) for x in data["strike_time"].tolist() if str(x) >= today})
    if not exps:
        raise RuntimeError(f"{owner}: 没有未来到期日")
    return exps


def snapshot_rows(ctx, codes: list[str]) -> dict:
    out = {}
    for i in range(0, len(codes), SNAP_BATCH):
        chunk = codes[i : i + SNAP_BATCH]
        data = must_ok(*ctx.get_market_snapshot(chunk), f"snapshot {chunk[:2]}")
        for _, row in data.iterrows():
            out[str(row["code"])] = row
        if i + SNAP_BATCH < len(codes):
            time.sleep(SNAP_GAP)
    return out


def equity_spot(ctx, owner: str) -> tuple[float, float | None]:
    data = must_ok(*ctx.get_market_snapshot([owner]), f"spot {owner}")
    last = float(data.iloc[0]["last_price"])
    prev = float(data.iloc[0].get("prev_close_price") or 0)
    chg = ((last - prev) / prev * 100) if prev else None
    return last, chg


def index_spot(ticker: str) -> tuple[float, float | None]:
    lb = gex.find_longbridge()
    rows = gex.lb_json(lb, ["quote", f".{ticker}.US"])
    if not rows:
        raise RuntimeError(f"{ticker}: 长桥指数现货为空")
    last = float(rows[0]["last"])
    prev = float(rows[0].get("prev_close") or 0)
    chg = ((last - prev) / prev * 100) if prev else None
    return last, chg


def get_spot(ctx, ticker: str) -> tuple[float, float | None]:
    if ticker in INDEX_TICKERS:
        return index_spot(ticker)
    return equity_spot(ctx, futu_code(ticker))


def chain_for_expiry(ctx, owner: str, exp: str):
    return must_ok(*ctx.get_option_chain(owner, start=exp, end=exp), f"chain {owner} {exp}")


def windowed_contracts(chain, spot: float, width: int) -> list[dict]:
    strikes = sorted({float(x) for x in chain["strike_price"].tolist()})
    window = set(gex.window_strikes(strikes, spot, width))
    rows = []
    for _, r in chain.iterrows():
        k = float(r["strike_price"])
        if k not in window:
            continue
        rows.append(
            {
                "code": str(r["code"]),
                "strike": k,
                "cp": "CALL" if str(r["option_type"]).upper() == "CALL" else "PUT",
                "exp": str(r["strike_time"]),
            }
        )
    return rows


def summarize_ladder(ticker: str, spot: float, chg, exp: str, by_strike: dict, got: int, total: int) -> dict:
    ladder = [
        {"strike": k, "net_gex": round(v, 2)}
        for k, v in sorted(by_strike.items(), key=lambda kv: kv[0], reverse=True)
    ]
    if not ladder:
        raise RuntimeError(f"{ticker}: ladder 为空")
    king = min(ladder, key=lambda r: r["net_gex"])
    floor = max(ladder, key=lambda r: r["net_gex"])
    spot_row = min(ladder, key=lambda r: abs(r["strike"] - spot))
    strikes_asc = sorted(ladder, key=lambda r: r["strike"])
    pi = min(range(len(strikes_asc)), key=lambda i: abs(strikes_asc[i]["strike"] - spot))
    local = sum(r["net_gex"] for r in strikes_asc[max(0, pi - 2) : pi + 3])
    pillow = None
    if king["strike"] > spot_row["strike"]:
        cands = [
            r
            for r in ladder
            if spot_row["strike"] < r["strike"] < king["strike"]
            and r["net_gex"] > 0
            and r["strike"] != floor["strike"]
        ]
        if cands:
            pillow = max(cands, key=lambda r: r["net_gex"])
    kind = "0dte" if exp == date.today().isoformat() else "nearest"
    print(f"  KING {king['strike']:g} {gex.fmt_money(king['net_gex'])}", flush=True)
    print(f"  FLOOR {floor['strike']:g} {gex.fmt_money(floor['net_gex'])}", flush=True)
    return {
        "kind": kind,
        "ticker": ticker,
        "spot": round(spot, 4),
        "change_pct": None if chg is None else round(chg, 4),
        "expiry": exp,
        "coverage": {"got": got, "total": total},
        "king": king,
        "floor": floor,
        "pillow": pillow,
        "spot_strike": spot_row["strike"],
        "local_gex": round(local, 2),
        "regime": "positive_gamma" if local >= 0 else "negative_gamma",
        "ladder": ladder,
        "note": "OI 为 T+1；周末/闭市时 expiry 是最近未到期日。指数现货来自长桥，期权链来自富途。",
    }


def collect_zero_dte(ctx, ticker: str) -> dict:
    owner = futu_code(ticker)
    print(f"\n=== 0DTE/nearest {ticker} ({owner}) ===", flush=True)
    spot, chg = get_spot(ctx, ticker)
    exp = list_future_expiries(ctx, owner)[0]
    chain = chain_for_expiry(ctx, owner, exp)
    contracts = windowed_contracts(chain, spot, gex.ZERO_DTE_WIDTH)
    print(f"  spot ${spot:.2f} · expiry {exp} · contracts {len(contracts)}", flush=True)
    snaps = snapshot_rows(ctx, [c["code"] for c in contracts])
    by_strike: dict[float, float] = defaultdict(float)
    got = 0
    for c in contracts:
        row = snaps.get(c["code"])
        if row is None:
            continue
        gamma = float(row.get("option_gamma") or 0)
        oi = float(row.get("option_open_interest") or 0)
        by_strike[c["strike"]] += gex.net_gex(gamma, oi, spot, c["cp"])
        got += 1
    if got < max(len(contracts) * 0.5, 1):
        raise RuntimeError(f"{ticker}: 快照覆盖率过低 {got}/{len(contracts)}")
    return summarize_ladder(ticker, spot, chg, exp, by_strike, got, len(contracts))


def collect_matrix(ctx, ticker: str, n_expiries: int) -> dict:
    owner = futu_code(ticker)
    print(f"\n=== MATRIX {ticker} ({owner}) × {n_expiries} ===", flush=True)
    spot, chg = get_spot(ctx, ticker)
    expiries = list_future_expiries(ctx, owner)[:n_expiries]
    print(f"  spot ${spot:.2f} · expiries {', '.join(expiries)}", flush=True)
    contracts: list[dict] = []
    listed: set[tuple[float, str]] = set()
    for exp in expiries:
        chain = chain_for_expiry(ctx, owner, exp)
        rows = windowed_contracts(chain, spot, gex.MATRIX_WIDTH)
        for c in rows:
            listed.add((c["strike"], c["exp"]))
        contracts.extend(rows)
        time.sleep(0.2)
    snaps = snapshot_rows(ctx, [c["code"] for c in contracts])
    cells: dict[tuple[float, str], float] = defaultdict(float)
    got = 0
    for c in contracts:
        row = snaps.get(c["code"])
        if row is None:
            continue
        gamma = float(row.get("option_gamma") or 0)
        oi = float(row.get("option_open_interest") or 0)
        cells[(c["strike"], c["exp"])] += gex.net_gex(gamma, oi, spot, c["cp"])
        got += 1
    for key in listed:
        cells.setdefault(key, 0.0)
    strikes = sorted({k for k, _e in cells}, reverse=True)
    matrix = []
    king = None
    floor = None
    for k in strikes:
        row = {"strike": k, "by_expiry": {}}
        for exp in expiries:
            if (k, exp) not in listed:
                row["by_expiry"][exp] = None
                continue
            val = round(cells[(k, exp)], 2)
            row["by_expiry"][exp] = val
            if king is None or val < king["net_gex"]:
                king = {"strike": k, "expiry": exp, "net_gex": val}
            if floor is None or val > floor["net_gex"]:
                floor = {"strike": k, "expiry": exp, "net_gex": val}
        row["sum_gex"] = round(sum(v for v in row["by_expiry"].values() if v is not None), 2)
        matrix.append(row)
    col_totals = {
        exp: round(sum(cells[(k, exp)] for k in strikes if (k, exp) in listed), 2)
        for exp in expiries
    }
    print(f"  KING {king['strike']:g} @{king['expiry']} {gex.fmt_money(king['net_gex'])}", flush=True)
    print(f"  FLOOR {floor['strike']:g} @{floor['expiry']} {gex.fmt_money(floor['net_gex'])}", flush=True)
    for exp, tot in col_totals.items():
        print(f"  COL {exp} {gex.fmt_money(tot)}", flush=True)
    return {
        "kind": "matrix",
        "ticker": ticker,
        "spot": round(spot, 4),
        "change_pct": None if chg is None else round(chg, 4),
        "expiries": expiries,
        "coverage": {"got": got, "total": len(contracts)},
        "king": king,
        "floor": floor,
        "spot_strike": min(strikes, key=lambda s: abs(s - spot)) if strikes else None,
        "column_totals": col_totals,
        "matrix": matrix,
        "note": "OI 为 T+1；墙的位置盘中基本不动。期权链来自富途 OpenD。",
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Collect NetGEX via Futu OpenD")
    ap.add_argument("--host", default=os.environ.get("FUTU_OPEND_HOST", "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("FUTU_OPEND_PORT", "11111")))
    ap.add_argument("--zero-dte", default=",".join(DEFAULT_ZERO_DTE))
    ap.add_argument("--matrix", default=",".join(DEFAULT_MATRIX))
    ap.add_argument("--expiries", type=int, default=5)
    ap.add_argument("--skip-matrix", action="store_true")
    args = ap.parse_args()

    SysConfig.set_all_thread_daemon(True)
    ctx = OpenQuoteContext(host=args.host, port=args.port)
    try:
        info = must_ok(*ctx.get_user_info(), "get_user_info")
        us_opt = str(info.get("us_option_qot_right") or "")
        print(f"GEX sidecar via Futu OpenD {args.host}:{args.port}", flush=True)
        print(f"  us_option={us_opt}  us_stock={info.get('us_qot_right')}", flush=True)
        if us_opt.upper() in {"", "NO", "NONE", "N/A"}:
            raise RuntimeError("美股期权权限仍是 NO。请买 Futu API 商店的 OPRA 实时（不是 App 那张），然后重启 OpenD。")

        zero_tickers = [t.strip().upper() for t in args.zero_dte.split(",") if t.strip()]
        matrix_tickers = [] if args.skip_matrix else [t.strip().upper() for t in args.matrix.split(",") if t.strip()]
        snapshot = {
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "session": gex.session_label(),
            "source": "futu-opend",
            "disclaimer": "结构快照，不是预测，不构成投资建议。GEX 正负依赖做市商净卖期权的常见假设。",
            "collection": {
                "ok": False,
                "script": "tools/gex-sidecar/collect_futu.py",
                "futu_us_option": us_opt,
                "futu_us_stock": str(info.get("us_qot_right") or ""),
                "index_spot": "longbridge-cli",
                "longbridge_openapi_opra": "not_used",
            },
            "zero_dte": {},
            "matrix": {},
            "errors": [],
        }
        zero_items = []
        for code in zero_tickers:
            try:
                item = collect_zero_dte(ctx, code)
                snapshot["zero_dte"][code] = item
                zero_items.append(item)
            except Exception as exc:
                snapshot["errors"].append({"ticker": code, "kind": "zero_dte", "error": str(exc)})
                print(f"  !! {code} 0dte 失败: {exc}", file=sys.stderr)
        matrix_items = []
        for code in matrix_tickers:
            try:
                item = collect_matrix(ctx, code, args.expiries)
                snapshot["matrix"][code] = item
                matrix_items.append(item)
            except Exception as exc:
                snapshot["errors"].append({"ticker": code, "kind": "matrix", "error": str(exc)})
                print(f"  !! {code} matrix 失败: {exc}", file=sys.stderr)

        snapshot["collection"]["ok"] = (
            not snapshot["errors"]
            and bool(snapshot["zero_dte"] or snapshot["matrix"])
        )
        snapshot["collection"]["note"] = (
            "主路径是富途 OpenD。长桥 OpenAPI OPRA 未开通，collect.py 备选不可用；"
            "不要把长桥失败的空 snapshot_* 当成现状。"
        )

        gex.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        latest = gex.OUTPUT_DIR / "latest.json"
        latest.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
        stamped = gex.OUTPUT_DIR / f"snapshot_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        stamped.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
        if zero_items:
            html = gex.render_zero_dte_html(zero_items)
            html = html.replace("Heatseeker — SPY/QQQ NetGEX", "Heatseeker — NetGEX (Futu OpenD)")
            (gex.OUTPUT_DIR / "heatseeker_gex.html").write_text(html, encoding="utf-8")
        for item in matrix_items:
            (gex.OUTPUT_DIR / f"gex_matrix_{item['ticker']}.html").write_text(
                gex.render_matrix_html(item), encoding="utf-8"
            )
        print(f"\nSaved {latest}", flush=True)
        if snapshot["errors"]:
            print(f"Completed with {len(snapshot['errors'])} error(s).", flush=True)
            return 1
        if not snapshot["zero_dte"] and not snapshot["matrix"]:
            print("No snapshots produced.", flush=True)
            return 1
        return 0
    finally:
        ctx.close()


if __name__ == "__main__":
    sys.exit(main())
