#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Post-collection pipeline for GEX sidecar:
1. Archives new snapshots to data/gex/YYYYMMDD/ (day folder: stamped JSON, day latest, manifest, analysis).
2. Performs isolated Git commit and push for that day directory only (leaves old data/gex_snapshots_* alone).
3. Generates rich quantitative & AI market maker digest and lands analysis_daily.md in the day folder.
4. Pushes the digest with Git commit hash to WeChat Work (WeCom) webhook.
"""

from __future__ import annotations

import glob
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent.parent
# Legacy monthly archive kept in-repo for history; NEW runs write under data/gex/YYYYMMDD/.
LEGACY_ARCHIVE_DIR = ROOT / "data" / "gex_snapshots_202610"
GEX_DIR = ROOT / "data" / "gex"
ET_ZONE = "America/New_York"
CST_ZONE = "Asia/Shanghai"

FOCUS_TICKERS = [
    "NBIS", "CRWV", "IREN", "CIFR", "CBRS", "SOXL", "MU", "LITE", "NVDA", "TSLA", "COIN",
    # Expanded mega-cap / semi / SpaceX proxy for digest
    "AAPL", "MSFT", "GOOGL", "AMZN", "META", "SOXX", "SPCX",
]
ZERO_DTE_TICKERS = ["SPY", "QQQ", "SPX"]


def fmt_money(val: float | int | None) -> str:
    if val is None:
        return "—"
    v = float(val)
    sign = "+" if v > 0 else "-" if v < 0 else ""
    av = abs(v)
    if av >= 1e9:
        return f"{sign}${av / 1e9:.2f}B"
    if av >= 1e6:
        return f"{sign}${av / 1e6:.2f}M"
    if av >= 1e3:
        return f"{sign}${av / 1e3:.1f}k"
    return f"{sign}${av:.2f}"


def find_latest_snapshot_file() -> Path | None:
    snaps = sorted(GEX_DIR.glob("snapshot_*.json"))
    return snaps[-1] if snaps else None


def day_dir_for_generated_at(gen_at: str, snapshot_name: str | None = None) -> Path:
    """Resolve data/gex/YYYYMMDD from snapshot generated_at (prefer America/New_York when tz-aware)."""
    raw = (gen_at or "").strip()
    dt = None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        dt = None
    if dt is not None:
        if dt.tzinfo is not None:
            dt_et = dt.astimezone(ZoneInfo(ET_ZONE))
            return GEX_DIR / dt_et.strftime("%Y%m%d")
        # Naive timestamps: use calendar date from the string (matches existing stamp filenames).
        return GEX_DIR / dt.strftime("%Y%m%d")
    if snapshot_name:
        m = re.search(r"snapshot_(\d{8})_", snapshot_name)
        if m:
            return GEX_DIR / m.group(1)
    return GEX_DIR / datetime.now(ZoneInfo(ET_ZONE)).strftime("%Y%m%d")


def get_previous_snapshot_file(current_name: str) -> Path | None:
    """Find prior stamped snapshot across day folders, flat gex dir, then legacy monthly archive."""
    snaps: list[Path] = []
    for day_dir in sorted(GEX_DIR.glob("[0-9]" * 8)):
        if day_dir.is_dir():
            snaps.extend(day_dir.glob("snapshot_*.json"))
    snaps.extend(GEX_DIR.glob("snapshot_*.json"))
    if LEGACY_ARCHIVE_DIR.is_dir():
        snaps.extend(LEGACY_ARCHIVE_DIR.glob("snapshot_*.json"))
    # de-dupe by name, keep last path for each name then sort by name
    by_name: dict[str, Path] = {}
    for s in snaps:
        by_name[s.name] = s
    ordered = sorted(by_name.values(), key=lambda p: p.name)
    prev = [s for s in ordered if s.name != current_name]
    return prev[-1] if prev else None


def archive_and_git_sync(snapshot_file: Path | None = None, do_git: bool = True) -> dict:
    """Copy snapshot into data/gex/YYYYMMDD/, update day manifest, isolated git add of that day path."""
    if snapshot_file is None:
        snapshot_file = find_latest_snapshot_file()
    if snapshot_file is None or not snapshot_file.is_file():
        return {"ok": False, "error": "No snapshot file found to archive"}

    latest_file = GEX_DIR / "latest.json"
    if not latest_file.is_file():
        return {"ok": False, "error": "latest.json not found"}

    try:
        snap_data = json.loads(snapshot_file.read_text(encoding="utf-8"))
    except Exception as exc:
        return {"ok": False, "error": f"Failed to parse snapshot: {exc}"}

    gen_at = snap_data.get("generated_at") or datetime.now().isoformat()
    day_dir = day_dir_for_generated_at(gen_at, snapshot_file.name)
    day_dir.mkdir(parents=True, exist_ok=True)
    dt_str = day_dir.name

    # 1. Non-overwriting stamped snapshot into day folder
    dest_snapshot = day_dir / snapshot_file.name
    if not dest_snapshot.exists():
        shutil.copy2(snapshot_file, dest_snapshot)
    else:
        # Same filename already archived — keep original bytes, still refresh pointers below.
        pass

    # 2. Day-folder latest pointer (overwrite OK)
    dest_latest = day_dir / "latest.json"
    shutil.copy2(latest_file, dest_latest)

    # 3. Update day manifest.json
    manifest_path = day_dir / "manifest.json"
    manifest = {"date": dt_str, "snapshots": [], "updated_at": datetime.now().isoformat()}
    if manifest_path.is_file():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            pass

    matrix_keys = list((snap_data.get("matrix") or {}).keys())
    zero_keys = list((snap_data.get("zero_dte") or {}).keys())
    hour_token = gen_at[11:13] if len(gen_at) >= 13 else ""
    session_type = (
        "morning_post_market"
        if "0909" in snapshot_file.name or hour_token in {"09", "08", "10"}
        else "evening_pre_open"
    )

    entry = {
        "filename": snapshot_file.name,
        "date": dt_str,
        "generated_at": gen_at,
        "session": session_type,
        "size_bytes": dest_snapshot.stat().st_size if dest_snapshot.exists() else snapshot_file.stat().st_size,
        "tickers_count": len(matrix_keys),
        "tickers": matrix_keys,
        "zero_dte_count": len(zero_keys),
        "note": f"Daily archive: {session_type} ({len(matrix_keys)} matrix, {len(zero_keys)} 0DTE)",
        "files": [
            snapshot_file.name,
            "latest.json",
            "analysis_daily.md",
            "manifest.json",
        ],
    }

    manifest["date"] = dt_str
    manifest["snapshots"] = [s for s in manifest.get("snapshots", []) if s.get("filename") != snapshot_file.name]
    manifest["snapshots"].append(entry)
    manifest["snapshots"].sort(key=lambda x: x.get("generated_at", ""))
    manifest["updated_at"] = datetime.now().isoformat()
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    # 4. Lightweight day README (no monthly zip for new runs)
    readme_path = day_dir / "README.md"
    readme_lines = [
        f"# GEX daily archive `{dt_str}`",
        "",
        f"- Day folder: `data/gex/{dt_str}/`",
        f"- Rolling pointer (repo root of gex): `data/gex/latest.json`",
        f"- Analysis: `analysis_daily.md` (append per run); reserved `analysis_weekly.md`",
        "",
        "| Session | Snapshot | generated_at | Coverage |",
        "| --- | --- | --- | --- |",
    ]
    for s in manifest["snapshots"]:
        readme_lines.append(
            f"| {s.get('session')} | `{s.get('filename')}` | {s.get('generated_at')} | "
            f"{s.get('tickers_count')} matrix + {s.get('zero_dte_count')} 0DTE |"
        )
    readme_path.write_text("\n".join(readme_lines) + "\n", encoding="utf-8")

    # 5. Isolated Git Commit & Push — only this day path under data/gex/YYYYMMDD/
    #    (skipped when do_git=False so caller can land analysis_daily.md first)
    rel_day = f"data/gex/{dt_str}/"
    git_res = {
        "committed": False,
        "pushed": False,
        "commit_hash": None,
        "error": None,
        "path": rel_day,
        "skipped": not do_git,
    }
    if do_git:
        git_res = git_sync_day_dir(day_dir, snapshot_file.name)

    return {
        "ok": True,
        "snapshot": snapshot_file.name,
        "day_dir": str(day_dir),
        "date": dt_str,
        "size": dest_snapshot.stat().st_size if dest_snapshot.exists() else snapshot_file.stat().st_size,
        "git": git_res,
    }


def git_sync_day_dir(day_dir: Path, snapshot_name: str) -> dict:
    """Isolated git add/commit/push for one data/gex/YYYYMMDD/ folder (JSON + analysis)."""
    rel_day = f"data/gex/{day_dir.name}/"
    git_res = {"committed": False, "pushed": False, "commit_hash": None, "error": None, "path": rel_day}
    try:
        subprocess.run(["git", "add", rel_day], cwd=str(ROOT), check=True)
        staged = subprocess.run(
            ["git", "diff", "--cached", "--name-only"], cwd=str(ROOT), capture_output=True, text=True, check=True
        ).stdout.strip()
        if staged:
            commit_msg = f"data(gex): archive and sync snapshot {snapshot_name}"
            subprocess.run(["git", "commit", "-m", commit_msg], cwd=str(ROOT), check=True)
            git_res["committed"] = True
            push_proc = subprocess.run(
                ["git", "push", "origin", "HEAD"], cwd=str(ROOT), capture_output=True, text=True
            )
            if push_proc.returncode == 0:
                git_res["pushed"] = True
            else:
                git_res["error"] = push_proc.stderr
        rev_proc = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], cwd=str(ROOT), capture_output=True, text=True, check=True
        )
        git_res["commit_hash"] = rev_proc.stdout.strip()
    except Exception as exc:
        git_res["error"] = str(exc)
    return git_res



def append_analysis_daily(day_dir: Path, digest: str, gen_at: str) -> Path:
    """Append WeCom markdown digest into data/gex/YYYYMMDD/analysis_daily.md (multi-session safe)."""
    day_dir.mkdir(parents=True, exist_ok=True)
    path = day_dir / "analysis_daily.md"
    header = f"## Session digest @ {gen_at}\n\n"
    block = header + digest.rstrip() + "\n"
    if path.is_file() and path.stat().st_size > 0:
        existing = path.read_text(encoding="utf-8")
        path.write_text(existing.rstrip() + "\n\n---\n\n" + block, encoding="utf-8")
    else:
        path.write_text(block, encoding="utf-8")
    # Reserved weekly path documented; create empty stub once so layout is discoverable.
    weekly = day_dir / "analysis_weekly.md"
    if not weekly.exists():
        weekly.write_text(
            "# analysis_weekly.md (reserved)\n\n"
            "Weekly rollup hook — not generated yet. Downstream may read this path later.\n",
            encoding="utf-8",
        )
    return path


def generate_gex_analysis_digest(latest_data: dict, prev_data: dict | None = None) -> str:
    """Generates rich quantitative & AI market maker博弈 analysis for WeChat Work."""
    gen_at = latest_data.get("generated_at") or datetime.now().isoformat()
    hour = int(gen_at[11:13]) if len(gen_at) >= 13 and gen_at[11:13].isdigit() else 21
    session_title = "🌅 盘后结算·早场全天基准 (09:00 CST / 21:00 ET)" if hour < 15 else "🌃 开盘前·晚场即时微调 (21:00 CST / 09:00 ET)"

    matrix = latest_data.get("matrix") or {}
    zero_dte = latest_data.get("zero_dte") or {}
    prev_matrix = (prev_data or {}).get("matrix") or {}

    rows = []
    bull_regime = []
    bear_regime = []
    flips = []

    for sym in FOCUS_TICKERS:
        if sym not in matrix:
            continue
        cur = matrix[sym]
        prev = prev_matrix.get(sym) or {}

        spot = cur.get("spot", 0.0)
        king = (cur.get("king") or {}).get("strike", 0.0)
        floor = (cur.get("floor") or {}).get("strike", 0.0)
        exp0 = cur.get("expiries", [""])[0] if cur.get("expiries") else ""
        col_totals = cur.get("column_totals") or {}
        col0 = col_totals.get(exp0, 0.0) if exp0 else 0.0

        prev_exp0 = prev.get("expiries", [""])[0] if prev.get("expiries") else ""
        prev_col0 = (prev.get("column_totals") or {}).get(prev_exp0, 0.0) if prev_exp0 else None

        # Check flip
        if prev_col0 is not None:
            if prev_col0 < 0 and col0 > 0:
                flips.append(f"🟢 **{sym}** 强力翻正（由 {fmt_money(prev_col0)} 逆转至 {fmt_money(col0)}）")
            elif prev_col0 > 0 and col0 < 0:
                flips.append(f"🔴 **{sym}** 转负破位（由 {fmt_money(prev_col0)} 跌入 {fmt_money(col0)}）")

        regime_tag = "正Gamma (低吸减震)" if col0 >= 0 else "负Gamma (顺势加速)"
        if col0 >= 0:
            bull_regime.append(f"`{sym}`({fmt_money(col0)})")
        else:
            bear_regime.append(f"`{sym}`({fmt_money(col0)})")

        rows.append(
            f"| **{sym}** | {spot:.2f} | **{king:g}** | **{floor:g}** | {fmt_money(col0)} ({'正' if col0 >= 0 else '负'}) |"
        )

    # 0DTE summary
    zero_lines = []
    for sym in ZERO_DTE_TICKERS:
        if sym in zero_dte:
            z = zero_dte[sym]
            z_king = (z.get("king") or {}).get("strike", 0.0)
            z_floor = (z.get("floor") or {}).get("strike", 0.0)
            zero_lines.append(f"- **{sym}** (现价 {z.get('spot')}): KING `{z_king:g}` · FLOOR `{z_floor:g}` · 状态 `{z.get('regime')}`")

    # Section 1: Raw Data Board
    header = [
        f"### {session_title}",
        f"> **生成时刻**: `{gen_at}` · **标的覆盖**: {len(matrix)} 矩阵标的 + {len(zero_dte)} 0DTE / FOCUS {len(FOCUS_TICKERS)}",
        f"> **OI 性质**: T+1 收盘清算锁死 · 盘前交易不改 OI 墙",
        "",
        "#### 📊 核心持仓与大盘做市商墙位看板",
        "| 标的 | 现价 Spot | KING 支撑 | FLOOR 阻力 | 近端列总和 (到期) |",
        "| :--- | :--- | :--- | :--- | :--- |",
    ]
    board_md = "\n".join(header + rows)

    # Section 2: AI Market Maker Analysis
    ai_insights = [
        "",
        "#### 🧠 AI 做市商期权微结构深度博弈洞察",
    ]

    if flips:
        ai_insights.append("**🔥 关键多空翻转预警**：\n" + "\n".join(flips) + "\n")

    ai_insights.append(
        f"1. **🛡️ 正 Gamma 护盘/减震阵营**（做市商逆势低吸，防范下挫）：\n"
        f"   - 包含：{', '.join(bull_regime) if bull_regime else '无'}\n"
        f"   - **实战含义**：若盘前回踩 KING 支撑位，做市商需被动回补正股对冲，呈现强承接垫，为高盈亏比低吸或做 T 区域。"
    )

    ai_insights.append(
        f"2. **⚠️ 负 Gamma 波动放大阵营**（做市商顺势追跌杀跌，警惕踩踏）：\n"
        f"   - 包含：{', '.join(bear_regime) if bear_regime else '无'}\n"
        f"   - **实战含义**：在未突破有效阻力前，若发生下行突破极易引发做市商追卖抛压，盘前严禁市价盲目抄底。"
    )

    if zero_lines:
        ai_insights.append("3. **🎯 指数 0DTE 日内锚点**：\n" + "\n".join(zero_lines))

    # Longbridge Premarket Trading Window Advice
    ai_insights.append(
        "4. **💡 长桥盘前期权交易操作指南 (北京时间 12:00 / 美东 00:00 开闸)**：\n"
        "   - **挂单方式**：必须使用**限价单 (Limit Order)** 居中挂单，防范做市商内盘宽点差冲击。\n"
        "   - **策略协同**：严格以本期拉链的 KING/FLOOR 为锚点挂止盈或保护单；不在 54 只名单的标的需等到正式开盘。"
    )

    return board_md + "\n" + "\n".join(ai_insights)


def push_to_wecom(webhook: str, content: str) -> bool:
    if not webhook:
        print("[post_collect] WECHAT_WORK_WEBHOOK_URL unset — output to console only.")
        return False

    # WeChat Work webhook max length is ~4096 bytes. Split if needed.
    chunks = []
    if len(content.encode("utf-8")) > 3800:
        parts = content.split("#### ")
        curr = parts[0]
        for p in parts[1:]:
            piece = "#### " + p
            if len((curr + "\n" + piece).encode("utf-8")) > 3800:
                chunks.append(curr)
                curr = piece
            else:
                curr = curr + "\n" + piece
        if curr:
            chunks.append(curr)
    else:
        chunks = [content]

    success = True
    for chunk in chunks:
        body = json.dumps({"msgtype": "markdown", "markdown": {"content": chunk}}, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(webhook, data=body, headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                print(f"[post_collect] WeCom push status: {resp.status}")
        except Exception as exc:
            print(f"[post_collect] WeCom push error: {exc}", file=sys.stderr)
            success = False
    return success


def run_pipeline() -> int:
    """Executes the full post-collection pipeline: archive, digest land, git sync, wecom push."""
    print("[post_collect] Starting post-collection pipeline...")
    # 1. Archive files into data/gex/YYYYMMDD/ (defer git so analysis lands in same commit)
    archive_res = archive_and_git_sync(do_git=False)
    print(f"[post_collect] Archive result: {archive_res}")

    # 2. Load latest and previous snapshot
    latest_file = GEX_DIR / "latest.json"
    if not latest_file.is_file():
        print("[post_collect] latest.json missing, aborting digest", file=sys.stderr)
        return 1
    latest_data = json.loads(latest_file.read_text(encoding="utf-8"))

    prev_data = None
    if archive_res.get("snapshot"):
        prev_file = get_previous_snapshot_file(archive_res["snapshot"])
        if prev_file and prev_file.is_file():
            try:
                prev_data = json.loads(prev_file.read_text(encoding="utf-8"))
            except Exception:
                pass

    # 3. Generate Digest
    digest = generate_gex_analysis_digest(latest_data, prev_data)

    # 3b. Land analysis_daily.md (+ reserved analysis_weekly.md stub) into the day folder
    day_dir = Path(archive_res["day_dir"]) if archive_res.get("day_dir") else None
    if day_dir is None and archive_res.get("ok"):
        day_dir = day_dir_for_generated_at(
            latest_data.get("generated_at") or "", archive_res.get("snapshot")
        )
    analysis_path = None
    if day_dir is not None:
        gen_at = latest_data.get("generated_at") or datetime.now().isoformat()
        analysis_path = append_analysis_daily(day_dir, digest, gen_at)
        print(f"[post_collect] Wrote analysis: {analysis_path}")
        # TODO(weekly): generate analysis_weekly.md rollup across the ISO week; reserved path only for now.

    # 4. Git sync day folder (JSON + analysis together)
    git_res = {"committed": False, "pushed": False, "commit_hash": None, "error": None}
    if day_dir is not None and archive_res.get("ok"):
        git_res = git_sync_day_dir(day_dir, archive_res.get("snapshot") or day_dir.name)
        archive_res["git"] = git_res
        print(f"[post_collect] Git result: {git_res}")

    commit_hash = git_res.get("commit_hash")
    if commit_hash:
        digest += (
            f"\n\n---\n> 📦 **Git 同步就绪**: Commit `{commit_hash}` (`feat/chg064-offline`)\n"
            f"> 💻 可直接在本地终端执行 `git pull` 拉取最新全量原始 JSON 数据。"
            f"\n> 📁 日归档: `data/gex/{day_dir.name}/` · `analysis_daily.md`"
        )

    # 5. Push to WeCom
    webhook = os.environ.get("WECHAT_WORK_WEBHOOK_URL") or os.environ.get("WECHAT_ALERT_WEBHOOK_URL") or ""
    if not webhook:
        env_path = ROOT / ".env"
        if env_path.is_file():
            for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
                if "=" in line and not line.strip().startswith("#"):
                    k, _, v = line.partition("=")
                    if k.strip() in ("WECHAT_WORK_WEBHOOK_URL", "WECHAT_ALERT_WEBHOOK_URL"):
                        webhook = v.strip().strip('"').strip("'")
                        if webhook:
                            break

    push_to_wecom(webhook, digest)
    print("[post_collect] Post-collection pipeline finished successfully.")
    return 0



if __name__ == "__main__":
    raise SystemExit(run_pipeline())
