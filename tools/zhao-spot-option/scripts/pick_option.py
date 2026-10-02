#!/usr/bin/env python3
"""Read-only ATM option pick for a Zhao spot fill. Never places an order."""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import date, datetime
from zoneinfo import ZoneInfo

ALIASES = {
    "bid": ("bid", "bid_price"),
    "ask": ("ask", "ask_price"),
    "delta": ("delta", "option_delta"),
    "oi": ("oi", "option_open_interest", "open_interest"),
    "volume": ("volume", "option_volume"),
    "gamma": ("gamma", "option_gamma"),
    "iv": ("iv", "option_implied_volatility", "implied_volatility"),
    "strike": ("strike", "strike_price"),
    "expiry": ("expiry", "strike_time"),
    "cp": ("cp", "option_type"),
    "king_strike": ("king_strike",),
    "floor_strike": ("floor_strike",),
    "king_gex": ("king_gex",),
    "quoted_at": ("quoted_at", "quote_time"),
}


def num(value, default=None):
    if value is None or value == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def et_today() -> date:
    return datetime.now(ZoneInfo("America/New_York")).date()


def occ(ticker: str, expiry: str, cp: str, strike: float) -> str:
    yymmdd = expiry.replace("-", "")[2:]
    side = "C" if cp.upper().startswith("C") else "P"
    return f"{ticker.upper()}{yymmdd}{side}{int(round(strike * 1000)):08d}"


def futu_code(ticker: str, expiry: str, cp: str, strike: float) -> str:
    yymmdd = expiry.replace("-", "")[2:]
    side = "C" if cp.upper().startswith("C") else "P"
    return f"US.{ticker.upper()}{yymmdd}{side}{int(round(strike * 1000))}"


def dte(expiry: str, today: date) -> int:
    return (date.fromisoformat(expiry) - today).days


def spread_pct(bid: float, ask: float) -> float:
    mid = (bid + ask) / 2
    if mid <= 0:
        return 999.0
    return (ask - bid) / mid * 100


def tick(price: float) -> float:
    return 0.01 if price < 3 else 0.05


def limit_price(bid: float, ask: float) -> float | None:
    """Inside the spread, never at or above the ask. Floor to the tick."""
    if bid <= 0 or ask <= 0 or ask < bid:
        return None
    spread = round(ask - bid, 4)
    mid = (bid + ask) / 2
    raw = mid if spread <= 0.30 else bid + 0.35 * spread
    step = tick(ask)
    capped = min(raw, ask - step)
    if capped < bid:
        capped = bid
    units = math.floor((capped + 1e-9) / step)
    out = round(units * step, 2)
    if out >= ask:
        out = round(ask - step, 2)
    return out if out > 0 else None


def normalize(row: dict) -> dict:
    out = {}
    for key, names in ALIASES.items():
        for name in names:
            if name in row and row[name] not in (None, ""):
                out[key] = row[name]
                break
    cp = str(out.get("cp") or "").upper()
    out["cp"] = "CALL" if cp.startswith("C") else "PUT" if cp.startswith("P") else cp
    for key in ("bid", "ask", "delta", "oi", "volume", "gamma", "iv", "strike", "king_strike", "floor_strike", "king_gex"):
        if key in out:
            out[key] = num(out[key])
    if out.get("iv") and out["iv"] > 3:
        out["iv"] = out["iv"] / 100
    out["expiry"] = str(out.get("expiry") or "")[:10]
    return out


def window_king(row: dict, chain: list[dict]) -> float | None:
    kings = []
    for other in chain:
        if other.get("expiry") and other["expiry"] <= row["expiry"] and other.get("king_strike") is not None:
            kings.append((num(other.get("king_gex"), 0.0), float(other["king_strike"])))
    if not kings:
        return row.get("king_strike")
    return min(kings, key=lambda item: item[0])[1]


def hard_fail(row: dict, today: date) -> list[str]:
    reasons = []
    days = dte(row["expiry"], today)
    if days < 10 or days > 45:
        reasons.append(f"DTE {days} 不在 10-45")
    delta = abs(num(row.get("delta"), 0))
    if delta < 0.40 or delta > 0.60:
        reasons.append(f"|delta| {delta:.2f} 不在 0.40-0.60")
    if int(num(row.get("oi"), 0)) < 100:
        reasons.append("OI<100")
    bid, ask = num(row.get("bid")), num(row.get("ask"))
    if bid is None or ask is None or ask < bid or bid <= 0:
        reasons.append("无有效买卖价")
    elif spread_pct(bid, ask) > 4:
        reasons.append("价差>4%")
    return reasons


def score_contract(row: dict, today: date, magnet: float | None) -> tuple[float, list[str]]:
    notes = []
    score = 100.0
    days = dte(row["expiry"], today)
    score -= abs(days - 24) * 0.8
    score -= abs(abs(num(row.get("delta"), 0)) - 0.50) * 40
    oi = int(num(row.get("oi"), 0))
    if oi < 1000:
        score -= 12
        notes.append("OI<1000")
    score -= min(spread_pct(row["bid"], row["ask"]), 12) * 1.5
    if magnet is not None and float(row["strike"]) == float(magnet):
        score -= 6
        notes.append(f"坐窗口King {magnet:g}")
    if int(num(row.get("volume"), 0)) < 20:
        score -= 4
    return score, notes


def daily_theta(row: dict, spot: float, today: date) -> float | None:
    """Rough BS theta in $/contract/day. Needs iv. r=0.043."""
    iv = num(row.get("iv"))
    if not iv or iv <= 0 or spot <= 0:
        return None
    t = max(dte(row["expiry"], today), 1) / 365
    k = float(row["strike"])
    vol = iv * math.sqrt(t)
    d1 = (math.log(spot / k) + (0.043 + 0.5 * iv * iv) * t) / vol
    pdf = math.exp(-0.5 * d1 * d1) / math.sqrt(2 * math.pi)
    theta = -spot * pdf * iv / (2 * math.sqrt(t)) / 365
    return round(theta * 100, 1)


def pick(chain: list[dict], side: str, today: date) -> dict:
    cp = "CALL" if side == "long" else "PUT"
    rows = [normalize(r) for r in chain if normalize(r).get("cp") == cp]
    missing_king = [r for r in rows if r.get("king_strike") is None]
    eligible = []
    rejected = []
    for row in rows:
        why = hard_fail(row, today)
        if why:
            rejected.append({"row": row, "why": why})
            continue
        magnet = window_king(row, rows)
        score, notes = score_contract(row, today, magnet)
        eligible.append((score, notes, row, magnet))
    eligible.sort(key=lambda item: item[0], reverse=True)
    primary = eligible[0] if eligible else None
    fallback = None
    for score, notes, row, magnet in eligible:
        if primary and row is primary[2]:
            continue
        if 10 <= dte(row["expiry"], today) <= 21 and int(num(row.get("oi"), 0)) >= 1000 and spread_pct(row["bid"], row["ask"]) <= 3:
            fallback = (score, notes, row, magnet)
            break
    if fallback is None:
        liquids = [
            item for item in eligible
            if (primary is None or item[2] is not primary[2])
            and int(num(item[2].get("oi"), 0)) >= 1000
            and spread_pct(item[2]["bid"], item[2]["ask"]) <= 3
        ]
        fallback = max(liquids, key=lambda item: int(num(item[2].get("oi"), 0)), default=None)
    return {
        "primary": None if primary is None else primary[2],
        "primary_score": None if primary is None else round(primary[0], 1),
        "primary_notes": [] if primary is None else primary[1],
        "primary_magnet": None if primary is None else primary[3],
        "fallback": None if fallback is None else fallback[2],
        "rejected": rejected,
        "missing_king": bool(missing_king),
        "do_not_use_as_order": True,
    }


def render(ticker: str, zhao_px: float, spot: float, side: str, result: dict, today: date) -> str:
    gap = (spot - zhao_px) / zhao_px * 100 if zhao_px else 0
    lines = [
        "只读筛选，不是下单。GEX 不作为方向。目标是亏损封顶的同向暴露，不是融资套利。",
        f"赵哥 {zhao_px:g} / 现货 {spot:g}（{gap:+.2f}%）/ 方向 {'多' if side == 'long' else '空'} / 美东 {today.isoformat()}",
    ]
    if abs(gap) > 0.5:
        lines.append(f"WARNING 现货偏离赵哥价 {gap:+.2f}%，超过 0.5%。px_zhao 不是我们的成交。")
    if result["missing_king"]:
        lines.append("WARNING 链上缺 king_strike，窗口墙维度无效。先跑 gex-sidecar 再选。")
    p = result["primary"]
    if p is None:
        lines.append("无合格合约。硬门槛：DTE 10-45、|delta| 0.40-0.60、OI≥100、价差≤4%、有效买卖价。")
    else:
        lim = limit_price(p["bid"], p["ask"])
        code = futu_code(ticker, p["expiry"], p["cp"], p["strike"])
        theta = daily_theta(p, spot, today)
        lines.append(f"首选：{ticker} {p['expiry']} {p['strike']:g} {p['cp']}（{code}）")
        lines.append(f"挂限价 {lim:.2f}（买 {p['bid']:.2f} / 卖 {p['ask']:.2f}，不追卖一）")
        lines.append(f"Delta {p.get('delta')} · DTE {dte(p['expiry'], today)} · OI {int(p.get('oi') or 0)} · 量 {int(p.get('volume') or 0)}")
        lines.append(f"窗口King {result['primary_magnet']} / 该到期King {p.get('king_strike')} · {', '.join(result['primary_notes']) or '无硬伤'}")
        if theta is not None:
            lines.append(f"约 theta {theta} 美元/张/天。抵掉时间价值，现货每天大约要走 {abs(theta) / max(abs(num(p.get('delta'), 0.5)) * 100, 1):.2f} 美元。")
        if p.get("quoted_at"):
            lines.append(f"报价时间 {p['quoted_at']}。周末 mid 不是周一成交价。")
    lines.append("失效：多单失守当日低点，或现货跌破窗口 King；空单相反。")
    fb = result.get("fallback")
    if fb:
        fl = limit_price(fb["bid"], fb["ask"])
        lines.append(f"买不进换 {fb['expiry']} {fb['strike']:g} {fb['cp']} 挂 {fl:.2f}（OI {int(fb.get('oi') or 0)}，King={fb.get('king_strike')}）")
    return "\n".join(lines)


def demo_chain() -> list[dict]:
    return [
        {"expiry": "2026-10-09", "cp": "CALL", "strike": 380, "bid": "1.80", "ask": "1.95", "delta": "0.42", "oi": "900", "volume": "400", "king_strike": 378, "king_gex": -1, "iv": 0.19},
        {"expiry": "2026-10-16", "cp": "CALL", "strike": 380, "bid": "5.60", "ask": "5.70", "delta": "0.50", "oi": "6739", "volume": "932", "king_strike": 380, "king_gex": -5.28, "iv": 0.195},
        {"expiry": "2026-10-23", "cp": "CALL", "strike": 381, "bid": "6.40", "ask": "6.90", "delta": "0.48", "oi": "39", "volume": "8", "king_strike": 375, "king_gex": -0.4, "iv": 0.196},
        {"expiry": "2026-10-30", "cp": "CALL", "strike": 380, "bid": "8.60", "ask": "8.90", "delta": "0.52", "oi": "487", "volume": "52", "king_strike": 370, "king_gex": -0.8, "iv": 0.204},
        {"expiry": "2026-11-20", "cp": "CALL", "strike": 380, "bid": "12.55", "ask": "12.75", "delta": "0.53", "oi": "1188", "volume": "7036", "king_strike": 390, "king_gex": -14.2, "iv": 0.217},
    ]


def main() -> int:
    ap = argparse.ArgumentParser(description="Zhao spot → read-only option pick")
    ap.add_argument("--ticker", default="GLD")
    ap.add_argument("--zhao-px", type=float, required=True)
    ap.add_argument("--spot", type=float)
    ap.add_argument("--side", choices=["long", "short"], default="long")
    ap.add_argument("--chain")
    ap.add_argument("--demo", action="store_true")
    ap.add_argument("--today", default="")
    args = ap.parse_args()
    today = date.fromisoformat(args.today) if args.today else et_today()
    if args.demo:
        chain = demo_chain()
        spot = args.spot if args.spot is not None else 379.13
    elif args.chain:
        if args.spot is None:
            print("用 --chain 时 --spot 必填，不能拿赵哥价冒充现货。", file=sys.stderr)
            return 2
        chain = json.loads(open(args.chain, encoding="utf-8").read())
        spot = args.spot
    else:
        print("没有链。给 --chain 加 --spot，或 --demo。不下单。", file=sys.stderr)
        return 2
    result = pick(chain, args.side, today)
    print(render(args.ticker, args.zhao_px, spot, args.side, result, today))
    print("do_not_use_as_order=true")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
