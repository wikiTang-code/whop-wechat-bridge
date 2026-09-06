#!/usr/bin/env python3
"""Windows-local GEX sidecar for whop-wechat-bridge.

Pulls option-chain greeks, computes NetGEX, and writes JSON/HTML under data/gex/.
Chart language follows NineLooms/heatseeker-lb and NineLooms/gex-matrix-lb
(https://longbridge.com/zh-CN/topics/43511616). Not a fork.

This process stays on the Windows box. GCP only consumes the JSON later.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / "data" / "gex"
CALC_BATCH = 40
CALC_GAP = 1.0
ZERO_DTE_WIDTH = 25
MATRIX_WIDTH = 20
DEFAULT_ZERO_DTE = ("SPY", "QQQ")
DEFAULT_MATRIX = ("TSLA",)


def find_longbridge() -> str:
    candidates = [
        Path(__file__).resolve().parent / "bin" / "longbridge.exe",
        Path(__file__).resolve().parent / "bin" / "longbridge",
        Path.home() / "bin" / "longbridge",
        Path.home() / ".local" / "bin" / "longbridge.exe",
        Path.home() / "scoop" / "shims" / "longbridge.exe",
        Path(os_path_local_appdata()) / "longbridge" / "longbridge.exe",
        Path(os_path_local_appdata()) / "Programs" / "longbridge" / "longbridge.exe",
    ]
    for p in candidates:
        if p.exists():
            return str(p)
    found = shutil.which("longbridge")
    if found:
        return found
    raise FileNotFoundError(
        "找不到 longbridge CLI。请先安装: "
        "iwr https://open.longbridge.com/longbridge/longbridge-terminal/install.ps1 | iex"
    )


def os_path_local_appdata() -> str:
    import os

    return os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")


def lb_env() -> dict:
    import os

    env = os.environ.copy()
    env.setdefault("LONGBRIDGE_REGION", "global")
    return env


def lb_json(lb: str, args: list[str]) -> list:
    r = subprocess.run(
        [lb, *args, "--format", "json"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=lb_env(),
    )
    cmd = "longbridge " + " ".join(args)
    if r.returncode != 0:
        err = (r.stderr or r.stdout or "").strip()[:400]
        raise RuntimeError(f"{cmd} 退出码 {r.returncode}: {err}")
    s = (r.stdout or "").lstrip()
    if not s:
        raise RuntimeError(f"{cmd} 无输出（stderr: {(r.stderr or '').strip()[:200]}）")
    if s[0] not in "[{":
        raise RuntimeError(f"{cmd} 输出不是 JSON（多半未登录）: {s[:200]!r}")
    try:
        data, _ = json.JSONDecoder().raw_decode(s)
    except ValueError as exc:
        raise RuntimeError(f"{cmd} JSON 解析失败: {exc}") from exc
    if isinstance(data, dict):
        return [data]
    return data or []


def get_spot(lb: str, code: str) -> tuple[float, float | None]:
    rows = lb_json(lb, ["quote", f"{code}.US"])
    if not rows:
        raise RuntimeError(f"{code}: quote 为空（检查 longbridge check / 行情权限）")
    last = float(rows[0]["last"])
    chg = None
    try:
        prev = float(rows[0].get("prev_close") or 0)
        if prev > 0:
            chg = (last - prev) / prev * 100
    except (TypeError, ValueError):
        pass
    return last, chg


def list_expiries(lb: str, code: str) -> list[str]:
    rows = lb_json(lb, ["option", "chain", f"{code}.US"])
    today = date.today().isoformat()
    exps = sorted({r["expiry_date"] for r in rows if r.get("expiry_date")})
    future = [e for e in exps if e >= today]
    if not future:
        raise RuntimeError(f"{code}: 期权链没有未来到期日")
    return future


def get_strikes(lb: str, code: str, exp: str) -> list[float]:
    rows = lb_json(lb, ["option", "chain", f"{code}.US", "--date", exp])
    return sorted({float(r["strike"]) for r in rows if r.get("strike") is not None})


def window_strikes(strikes: list[float], spot: float, width: int) -> list[float]:
    if not strikes:
        return []
    center = min(strikes, key=lambda s: abs(s - spot))
    idx = strikes.index(center)
    return strikes[max(0, idx - width) : idx + width + 1]


def build_symbols(code: str, exp: str, strikes: list[float]) -> list[tuple]:
    ymd = datetime.strptime(exp, "%Y-%m-%d").strftime("%y%m%d")
    out = []
    for k in strikes:
        kc = int(round(k * 1000))
        out.append((k, "CALL", f"{code}{ymd}C{kc}.US", exp))
        out.append((k, "PUT", f"{code}{ymd}P{kc}.US", exp))
    return out


def assert_option_openapi(lb: str) -> None:
    """Fail fast if App OPRA is on but OpenAPI OPRA is not."""
    expiries = list_expiries(lb, "SPY")
    strikes = get_strikes(lb, "SPY", expiries[0])
    spot, _chg = get_spot(lb, "SPY")
    window = window_strikes(strikes, spot, 0) or strikes[:1]
    symbol = build_symbols("SPY", expiries[0], window)[0][2]
    r = subprocess.run(
        [lb, "option", "quote", symbol, "--format", "json"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=lb_env(),
    )
    blob = f"{r.stderr or ''}\n{r.stdout or ''}"
    if r.returncode == 0 and (r.stdout or "").lstrip()[:1] in "[{":
        print(f"  option quote ok: {symbol}", flush=True)
        return
    if "no quote access" in blob.lower() or "301604" in blob or "OpenAPI" in blob:
        raise RuntimeError(
            "美股期权 OpenAPI 行情未开通。App/网页的 OPRA 不够，GEX 需要 "
            "「OPRA US Options Quotes (OpenAPI)」。开通: https://open.longbridge.com/pricing/ "
            "或 App 里 我的 → 行情商店。开通后再跑 python tools/gex-sidecar/collect.py"
        )
    raise RuntimeError(f"option quote 失败: {blob.strip()[:400]}")


def fetch_greeks(lb: str, tuples: list[tuple]) -> dict:
    result: dict = {}
    syms = [t[2] for t in tuples]
    n_batches = max(1, (len(syms) + CALC_BATCH - 1) // CALC_BATCH)
    empty_singles = 0
    for i in range(0, len(syms), CALC_BATCH):
        chunk = syms[i : i + CALC_BATCH]
        rows = lb_json(lb, ["calc-index", *chunk, "--fields", "gamma,oi,strike,exp"])
        if not rows:
            for one in chunk:
                one_rows = lb_json(lb, ["calc-index", one, "--fields", "gamma,oi,strike,exp"])
                if one_rows:
                    result[one_rows[0]["symbol"]] = one_rows[0]
                    empty_singles = 0
                else:
                    empty_singles += 1
                    if empty_singles >= 3 and not result:
                        raise RuntimeError(
                            "calc-index 对期权合约连续返回空数组。通常是未开通 "
                            "OPRA US Options Quotes (OpenAPI)。"
                            "开通: https://open.longbridge.com/pricing/"
                        )
                time.sleep(0.25)
        else:
            for row in rows:
                if row.get("symbol"):
                    result[row["symbol"]] = row
        print(f"    greeks {i // CALC_BATCH + 1}/{n_batches} ({len(result)} contracts)", flush=True)
        time.sleep(CALC_GAP)
    if not result:
        raise RuntimeError(f"calc-index 全空（{len(syms)} 个合约）——检查登录与美股期权权限")
    coverage = len(result) / max(len(syms), 1)
    if coverage < 0.5:
        missing = [s for s in syms if s not in result][:5]
        raise RuntimeError(
            f"calc-index 覆盖率过低 {len(result)}/{len(syms)}，可能撞了静默限流；缺失示例 {missing}"
        )
    return result


def net_gex(gamma: float, oi: float, spot: float, cp: str) -> float:
    sign = 1 if cp == "CALL" else -1
    return sign * gamma * oi * spot * 100


def fmt_money(v: float) -> str:
    a = abs(v)
    sign = "-" if v < 0 else ""
    if a >= 1e6:
        return f"{sign}${a / 1e6:.1f}M"
    if a >= 1e3:
        return f"{sign}${a / 1e3:.0f}K"
    return f"{sign}${a:.0f}"


def session_label() -> str:
    # US equity RTH 9:30-16:00 ET = 21:30-04:00 next day in UTC+8.
    now = datetime.now()
    minutes = now.hour * 60 + now.minute
    if 21 * 60 + 30 <= minutes or minutes < 4 * 60:
        return "rth_or_weekend_proxy"
    if 4 * 60 <= minutes < 5 * 60:
        return "after"
    return "closed_or_pre"


def collect_zero_dte(lb: str, code: str) -> dict:
    print(f"\n=== 0DTE/nearest {code} ===", flush=True)
    spot, chg = get_spot(lb, code)
    expiries = list_expiries(lb, code)
    exp = expiries[0]
    strikes = get_strikes(lb, code, exp)
    window = window_strikes(strikes, spot, ZERO_DTE_WIDTH)
    print(f"  spot ${spot:.2f} · expiry {exp} · window {len(window)} strikes", flush=True)
    tuples = build_symbols(code, exp, window)
    greeks = fetch_greeks(lb, tuples)
    by_strike: dict[float, float] = defaultdict(float)
    for strike, cp, symbol, _exp in tuples:
        g = greeks.get(symbol)
        if not g:
            continue
        by_strike[strike] += net_gex(float(g.get("gamma") or 0), float(g.get("oi") or 0), spot, cp)
    ladder = [
        {"strike": k, "net_gex": round(v, 2)}
        for k, v in sorted(by_strike.items(), key=lambda kv: kv[0], reverse=True)
    ]
    if not ladder:
        raise RuntimeError(f"{code}: 算出的 ladder 为空")
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
    print(f"  KING {king['strike']:g} {fmt_money(king['net_gex'])}", flush=True)
    print(f"  FLOOR {floor['strike']:g} {fmt_money(floor['net_gex'])}", flush=True)
    return {
        "kind": kind,
        "ticker": code,
        "spot": round(spot, 4),
        "change_pct": None if chg is None else round(chg, 4),
        "expiry": exp,
        "coverage": {"got": len(greeks), "total": len(tuples)},
        "king": king,
        "floor": floor,
        "pillow": pillow,
        "spot_strike": spot_row["strike"],
        "local_gex": round(local, 2),
        "regime": "positive_gamma" if local >= 0 else "negative_gamma",
        "ladder": ladder,
        "note": "OI 为 T+1；周末/闭市时 expiry 是最近未到期日，不一定是 0DTE。",
    }


def collect_matrix(lb: str, code: str, n_expiries: int) -> dict:
    print(f"\n=== MATRIX {code} × {n_expiries} expiries ===", flush=True)
    spot, chg = get_spot(lb, code)
    expiries = list_expiries(lb, code)[:n_expiries]
    print(f"  spot ${spot:.2f} · expiries {', '.join(expiries)}", flush=True)
    all_tuples: list[tuple] = []
    listed: set[tuple[float, str]] = set()
    for exp in expiries:
        ks = get_strikes(lb, code, exp)
        window = window_strikes(ks, spot, MATRIX_WIDTH)
        for k in window:
            listed.add((k, exp))
        all_tuples += build_symbols(code, exp, window)
        time.sleep(0.3)
    greeks = fetch_greeks(lb, all_tuples)
    cells: dict[tuple[float, str], float] = defaultdict(float)
    for strike, cp, symbol, exp in all_tuples:
        g = greeks.get(symbol)
        if not g:
            continue
        cells[(strike, exp)] += net_gex(float(g.get("gamma") or 0), float(g.get("oi") or 0), spot, cp)
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
    spot_strike = min(strikes, key=lambda s: abs(s - spot)) if strikes else None
    print(f"  KING {king['strike']:g} @{king['expiry']} {fmt_money(king['net_gex'])}", flush=True)
    print(f"  FLOOR {floor['strike']:g} @{floor['expiry']} {fmt_money(floor['net_gex'])}", flush=True)
    for exp, tot in col_totals.items():
        print(f"  COL {exp} {fmt_money(tot)}", flush=True)
    return {
        "kind": "matrix",
        "ticker": code,
        "spot": round(spot, 4),
        "change_pct": None if chg is None else round(chg, 4),
        "expiries": expiries,
        "coverage": {"got": len(greeks), "total": len(all_tuples)},
        "king": king,
        "floor": floor,
        "spot_strike": spot_strike,
        "column_totals": col_totals,
        "matrix": matrix,
        "note": "OI 为 T+1；墙的位置盘中基本不动，强度随 gamma/spot 变。",
    }


def render_zero_dte_html(items: list[dict]) -> str:
    panels = []
    for item in items:
        rows = []
        vmax = max((abs(r["net_gex"]) for r in item["ladder"]), default=1) or 1
        for r in item["ladder"]:
            tags = []
            extra = ""
            if r["strike"] == item["spot_strike"]:
                extra = " price"
                tags.append('<span class="tag t-price">◀ PRICE</span>')
            if r["strike"] == item["king"]["strike"]:
                extra += " king"
                tags.append('<span class="tag t-king">★ KING</span>')
            if r["strike"] == item["floor"]["strike"]:
                extra += " floor"
                tags.append('<span class="tag t-floor">FLOOR</span>')
            if item.get("pillow") and r["strike"] == item["pillow"]["strike"]:
                tags.append('<span class="tag t-pillow">PILLOW</span>')
            intensity = min(abs(r["net_gex"]) / vmax, 1.0)
            if r["net_gex"] >= 0:
                bg = f"rgba(38, 217, 176, {0.15 + 0.75 * intensity})"
            else:
                bg = f"rgba(217, 70, 239, {0.18 + 0.75 * intensity})"
            kd = f"{int(round(item['spot']))}" if extra.find("price") >= 0 else f"{r['strike']:g}"
            rows.append(
                f'<div class="drow{extra}" style="background:{bg}">'
                f'<span class="dk">{kd}</span>'
                f'<span class="dv">{fmt_money(r["net_gex"])}</span>'
                f'<span>{" ".join(tags)}</span></div>'
            )
        kind_label = "0DTE" if item["kind"] == "0dte" else f"nearest {item['expiry']}"
        panels.append(
            f'<section class="ticker"><div class="thead">{item["ticker"]} '
            f'<span class="g">GEX</span> · spot {item["spot"]:.2f} · '
            f'<span class="dte">{kind_label}</span></div>'
            f'<div class="ladder">{"".join(rows)}</div>'
            f'<div class="story">KING {item["king"]["strike"]:g} {fmt_money(item["king"]["net_gex"])} · '
            f'FLOOR {item["floor"]["strike"]:g} {fmt_money(item["floor"]["net_gex"])} · '
            f'现价附近 {item["regime"]}</div></section>'
        )
    return _page(
        "Heatseeker — SPY/QQQ NetGEX",
        "call+ / put− · OI T+1 · 本机 sidecar · 源自 heatseeker-lb",
        f'<div class="grid">{"".join(panels)}</div>',
    )


def render_matrix_html(item: dict) -> str:
    expiries = item["expiries"]
    head = "".join(f"<th>{e}</th>" for e in expiries)
    body = []
    flat = [
        v
        for row in item["matrix"]
        for v in row["by_expiry"].values()
        if v is not None
    ]
    vmax = max((abs(v) for v in flat), default=1) or 1
    for row in item["matrix"]:
        spot_cls = ' class="spot"' if row["strike"] == item["spot_strike"] else ""
        cells = [f'<td class="k">{row["strike"]:g}</td>']
        for exp in expiries:
            v = row["by_expiry"].get(exp)
            if v is None:
                cells.append("<td><div class=\"cell\">·</div></td>")
                continue
            intensity = min(abs(v) / vmax, 1.0)
            bg = (
                f"rgba(38, 217, 176, {0.15 + 0.75 * intensity})"
                if v >= 0
                else f"rgba(217, 70, 239, {0.18 + 0.75 * intensity})"
            )
            mark = ""
            cls = "cell"
            if item["king"] and row["strike"] == item["king"]["strike"] and exp == item["king"]["expiry"]:
                cls += " king"
                mark = " ★"
            if item["floor"] and row["strike"] == item["floor"]["strike"] and exp == item["floor"]["expiry"]:
                cls += " floor"
            cells.append(
                f'<td><div class="{cls}" style="background:{bg}">{fmt_money(v)}{mark}</div></td>'
            )
        body.append(f"<tr{spot_cls}>{''.join(cells)}</tr>")
    totals = item.get("column_totals") or {}
    t_vmax = max((abs(v) for v in totals.values()), default=1) or 1
    foot_cells = ['<td class="k">列合计</td>']
    for exp in expiries:
        v = totals.get(exp)
        if v is None:
            foot_cells.append("<td><div class=\"cell\">·</div></td>")
            continue
        intensity = min(abs(v) / t_vmax, 1.0)
        bg = (
            f"rgba(38, 217, 176, {0.15 + 0.75 * intensity})"
            if v >= 0
            else f"rgba(217, 70, 239, {0.18 + 0.75 * intensity})"
        )
        sign = "正列" if v >= 0 else "净负列"
        foot_cells.append(
            f'<td><div class="cell total" style="background:{bg}">{fmt_money(v)} · {sign}</div></td>'
        )
    foot = f"<tr class=\"col-total\">{''.join(foot_cells)}</tr>"
    col_story = " · ".join(
        f"{exp[5:]} {fmt_money(totals[exp])}" for exp in expiries if exp in totals
    )
    story = (
        f'★ KING {item["king"]["strike"]:g} @{item["king"]["expiry"]} {fmt_money(item["king"]["net_gex"])} · '
        f'FLOOR {item["floor"]["strike"]:g} @{item["floor"]["expiry"]} {fmt_money(item["floor"]["net_gex"])}'
    )
    if col_story:
        story += f'<br>列合计（该到期日窗口内各档 NetGEX 之和，不是成交单） · {col_story}'
    table = (
        f'<div class="wrap"><table><thead><tr><th class="k">Strike</th>{head}</tr></thead>'
        f'<tbody>{"".join(body)}</tbody><tfoot>{foot}</tfoot></table></div>'
    )
    return _page(
        f'{item["ticker"]} GEX Matrix · spot {item["spot"]:.2f}',
        f'{len(expiries)} 个到期日 · OI T+1 · 颜色按全局 |max| 归一 · 源自 gex-matrix-lb',
        table + f'<div class="story">{story}</div>',
        stamp=item.get("rendered_at"),
    )


def _page(title: str, sub: str, body: str, stamp: str | None = None) -> str:
    return f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>{title}</title>
<style>
:root {{ --bg:#0a1216; --panel:#0d1f24; --text:#e8f4f0; --dim:#8aa5a0; --axis:#2a3a40; --cyan:#00f5d4; --gold:#ffd166; }}
* {{ box-sizing:border-box; }}
body {{ background:var(--bg); color:var(--text); margin:0; padding:20px 24px; font-family:-apple-system,Segoe UI,Inter,sans-serif; }}
h1 {{ font-size:17px; margin:0 0 4px; }}
.sub {{ color:var(--dim); font-size:12px; margin-bottom:18px; }}
.grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(340px,460px)); gap:26px; }}
.ticker {{ background:var(--panel); border:1px solid var(--axis); border-radius:10px; overflow:hidden; }}
.thead {{ padding:12px 16px; font-weight:800; border-bottom:1px solid var(--axis); }}
.thead .g {{ color:var(--cyan); }} .thead .dte {{ color:var(--gold); }}
.drow {{ display:grid; grid-template-columns:62px 1fr auto; align-items:center; gap:8px; height:28px; padding:0 12px; font-family:Consolas,monospace; font-size:13px; }}
.drow.price {{ outline:2px solid #fff; outline-offset:-2px; }}
.drow.king {{ outline:2px solid #f0abfc; outline-offset:-2px; }}
.tag {{ font-size:10px; font-weight:800; padding:2px 7px; border-radius:10px; }}
.t-price {{ background:#fff; color:#0a1216; }}
.t-king {{ background:#f0abfc; color:#3b0764; }}
.t-floor {{ background:#0a1216; color:var(--gold); border:1px solid var(--gold); }}
.t-pillow {{ background:rgba(0,0,0,.35); color:#d1fae5; border:1px solid #34d399; }}
.story {{ padding:14px 16px; border-top:1px solid var(--axis); font-size:12.5px; color:#cfe3de; }}
table {{ border-collapse:collapse; background:var(--panel); border:1px solid var(--axis); font-family:Consolas,monospace; font-size:12.5px; }}
th {{ background:#0a1216; color:var(--dim); padding:8px 14px; text-align:right; }}
th.k, td.k {{ text-align:left; color:var(--text); padding:0 12px; }}
tr.spot td.k {{ background:#fff; color:#0a1216; }}
td .cell {{ display:flex; justify-content:flex-end; height:26px; padding:0 14px; font-weight:700; align-items:center; }}
.cell.king {{ outline:2px solid #f0abfc; outline-offset:-2px; }}
.cell.floor {{ outline:2px solid #b98900; outline-offset:-2px; }}
.cell.total {{ font-weight:800; border-top:1px solid var(--axis); }}
tr.col-total td.k {{ color:var(--gold); font-weight:800; }}
.wrap {{ overflow-x:auto; }}
</style></head><body>
<h1>{title}</h1>
<div class="sub">{sub} · {stamp or datetime.now().strftime("%Y-%m-%d %H:%M:%S")}</div>
{body}
</body></html>
"""


def public_item(item: dict) -> dict:
    return item


def main() -> int:
    ap = argparse.ArgumentParser(description="Collect NetGEX snapshots via Longbridge CLI")
    ap.add_argument("--zero-dte", default=",".join(DEFAULT_ZERO_DTE), help="逗号分隔，默认 SPY,QQQ")
    ap.add_argument("--matrix", default=",".join(DEFAULT_MATRIX), help="逗号分隔，默认 TSLA")
    ap.add_argument("--expiries", type=int, default=5, help="个股矩阵到期日个数")
    ap.add_argument("--skip-matrix", action="store_true")
    args = ap.parse_args()

    lb = find_longbridge()
    print(f"GEX sidecar via {lb}", flush=True)
    try:
        check = lb_json(lb, ["check"])
        print(f"  longbridge check ok: {json.dumps(check, ensure_ascii=False)[:240]}", flush=True)
        assert_option_openapi(lb)
    except Exception as exc:
        print(f"登录/权限检查失败: {exc}", file=sys.stderr)
        print("请先运行: longbridge auth login （美股请设 LONGBRIDGE_REGION=global）", file=sys.stderr)
        return 2

    zero_tickers = [t.strip().upper() for t in args.zero_dte.split(",") if t.strip()]
    matrix_tickers = [] if args.skip_matrix else [t.strip().upper() for t in args.matrix.split(",") if t.strip()]

    snapshot = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "session": session_label(),
        "source": "longbridge-cli",
        "disclaimer": "结构快照，不是预测，不构成投资建议。GEX 正负依赖做市商净卖期权的常见假设。",
        "zero_dte": {},
        "matrix": {},
        "errors": [],
    }

    zero_items = []
    for code in zero_tickers:
        try:
            item = collect_zero_dte(lb, code)
            snapshot["zero_dte"][code] = public_item(item)
            zero_items.append(item)
        except Exception as exc:
            snapshot["errors"].append({"ticker": code, "kind": "zero_dte", "error": str(exc)})
            print(f"  !! {code} 0dte 失败: {exc}", file=sys.stderr)

    matrix_items = []
    for code in matrix_tickers:
        try:
            item = collect_matrix(lb, code, args.expiries)
            snapshot["matrix"][code] = item
            matrix_items.append(item)
        except Exception as exc:
            snapshot["errors"].append({"ticker": code, "kind": "matrix", "error": str(exc)})
            print(f"  !! {code} matrix 失败: {exc}", file=sys.stderr)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    latest = OUTPUT_DIR / "latest.json"
    latest.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    stamped = OUTPUT_DIR / f"snapshot_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    stamped.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")

    if zero_items:
        html = render_zero_dte_html(zero_items)
        (OUTPUT_DIR / "heatseeker_gex.html").write_text(html, encoding="utf-8")
    for item in matrix_items:
        html = render_matrix_html(item)
        (OUTPUT_DIR / f"gex_matrix_{item['ticker']}.html").write_text(html, encoding="utf-8")

    print(f"\nSaved {latest}", flush=True)
    if snapshot["errors"]:
        print(f"Completed with {len(snapshot['errors'])} error(s).", flush=True)
        return 1
    if not snapshot["zero_dte"] and not snapshot["matrix"]:
        print("No snapshots produced.", flush=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
