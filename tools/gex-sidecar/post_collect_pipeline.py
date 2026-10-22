#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Post-collection pipeline for GEX sidecar:
1. Archives new snapshots to data/gex_snapshots_YYYYMM/ (manifest, README, zip).
2. Performs isolated Git commit and push for the archive directory only.
3. Generates rich quantitative & AI market maker博弈 analysis digest.
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
ARCHIVE_DIR = ROOT / "data" / "gex_snapshots_202610"
GEX_DIR = ROOT / "data" / "gex"
ET_ZONE = "America/New_York"
CST_ZONE = "Asia/Shanghai"

FOCUS_TICKERS = [
    "NBIS", "CRWV", "IREN", "CIFR", "CBRS", "SOXL", "MU", "LITE", "NVDA", "TSLA", "COIN"
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


def get_previous_snapshot_file(current_name: str) -> Path | None:
    snaps = sorted(ARCHIVE_DIR.glob("snapshot_*.json"))
    prev = [s for s in snaps if s.name != current_name]
    return prev[-1] if prev else None


def archive_and_git_sync(snapshot_file: Path | None = None) -> dict:
    """Copies snapshot to archive, updates manifest, README, zip, and does isolated git push."""
    if snapshot_file is None:
        snapshot_file = find_latest_snapshot_file()
    if snapshot_file is None or not snapshot_file.is_file():
        return {"ok": False, "error": "No snapshot file found to archive"}

    latest_file = GEX_DIR / "latest.json"
    if not latest_file.is_file():
        return {"ok": False, "error": "latest.json not found"}

    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Copy snapshot file
    dest_snapshot = ARCHIVE_DIR / snapshot_file.name
    shutil.copy2(snapshot_file, dest_snapshot)

    # 2. Copy latest_snapshot_YYYYMMDD.json
    try:
        snap_data = json.loads(snapshot_file.read_text(encoding="utf-8"))
    except Exception as exc:
        return {"ok": False, "error": f"Failed to parse snapshot: {exc}"}

    gen_at = snap_data.get("generated_at") or datetime.now().isoformat()
    dt_str = gen_at[:10].replace("-", "")
    dest_latest = ARCHIVE_DIR / f"latest_snapshot_{dt_str}.json"
    shutil.copy2(latest_file, dest_latest)

    # 3. Update manifest.json
    manifest_path = ARCHIVE_DIR / "manifest.json"
    manifest = {"snapshots": [], "updated_at": datetime.now().isoformat()}
    if manifest_path.is_file():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            pass

    matrix_keys = list((snap_data.get("matrix") or {}).keys())
    zero_keys = list((snap_data.get("zero_dte") or {}).keys())
    session_type = "morning_post_market" if "0909" in snapshot_file.name or "09" in gen_at[11:13] else "evening_pre_open"

    entry = {
        "filename": snapshot_file.name,
        "date": dt_str,
        "generated_at": gen_at,
        "session": session_type,
        "size_bytes": dest_snapshot.stat().st_size,
        "tickers_count": len(matrix_keys),
        "tickers": matrix_keys,
        "zero_dte_count": len(zero_keys),
        "note": f"Automated sidecar sync: {session_type} pull ({len(matrix_keys)} tickers, {len(zero_keys)} 0DTE)"
    }

    manifest["snapshots"] = [s for s in manifest.get("snapshots", []) if s.get("filename") != snapshot_file.name]
    manifest["snapshots"].append(entry)
    manifest["snapshots"].sort(key=lambda x: x.get("generated_at", ""))
    manifest["updated_at"] = datetime.now().isoformat()
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    # 4. Update README.md
    readme_path = ARCHIVE_DIR / "README.md"
    if readme_path.is_file():
        readme_text = readme_path.read_text(encoding="utf-8")
        row_str = f"| **{dt_str[:4]}-{dt_str[4:6]}-{dt_str[6:]}** ({session_type}) | `{snapshot_file.name}` | {gen_at} | **全量 {len(matrix_keys)} 矩阵标的 + {len(zero_keys)} 0DTE** | ~{dest_snapshot.stat().st_size // 1024} KB |"
        if snapshot_file.name not in readme_text:
            # Insert before the last list markers
            if "| **" in readme_text:
                lines = readme_text.splitlines()
                table_end_idx = -1
                for idx, line in enumerate(lines):
                    if line.strip().startswith("| **"):
                        table_end_idx = idx
                if table_end_idx != -1:
                    lines.insert(table_end_idx + 1, row_str)
                    readme_text = "\n".join(lines)
            readme_path.write_text(readme_text, encoding="utf-8")

    # 5. Refresh zip archive safely
    zip_path = ARCHIVE_DIR / "gex_snapshots_20261005_20261012.zip"
    try:
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for f in ARCHIVE_DIR.glob("*"):
                if f.name != zip_path.name and f.is_file():
                    zf.write(f, arcname=f.name)
    except Exception as exc:
        print(f"[post_collect] Warning: failed to rebuild zip: {exc}", file=sys.stderr)

    # 6. Isolated Git Commit & Push (STRICT REDLINE: only data/gex_snapshots_202610/)
    git_res = {"committed": False, "pushed": False, "commit_hash": None, "error": None}
    try:
        subprocess.run(["git", "add", "data/gex_snapshots_202610/"], cwd=str(ROOT), check=True)
        # Check if there are staged changes
        staged = subprocess.run(
            ["git", "diff", "--cached", "--name-only"], cwd=str(ROOT), capture_output=True, text=True, check=True
        ).stdout.strip()

        if staged:
            commit_msg = f"data(gex): archive and sync snapshot {snapshot_file.name}"
            subprocess.run(["git", "commit", "-m", commit_msg], cwd=str(ROOT), check=True)
            git_res["committed"] = True

            push_proc = subprocess.run(["git", "push", "origin", "HEAD"], cwd=str(ROOT), capture_output=True, text=True)
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

    return {
        "ok": True,
        "snapshot": snapshot_file.name,
        "size": dest_snapshot.stat().st_size,
        "git": git_res,
    }


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
        f"> **生成时刻**: `{gen_at}` · **标的覆盖**: 22 正股 + 3 指数 0DTE",
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
    """Executes the full post-collection pipeline: archive, git sync, digest, and wecom push."""
    print("[post_collect] Starting post-collection pipeline...")
    # 1. Archive & Git
    archive_res = archive_and_git_sync()
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

    # 4. Append Git Commit Info
    commit_hash = (archive_res.get("git") or {}).get("commit_hash")
    if commit_hash:
        digest += f"\n\n---\n> 📦 **Git 同步就绪**: Commit `{commit_hash}` (`feat/chg064-offline`)\n> 💻 可直接在本地终端执行 `git pull` 拉取最新全量原始 JSON 数据。"

    # 5. Push to WeCom
    # Try reading from config or .env
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
