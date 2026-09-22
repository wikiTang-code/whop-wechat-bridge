#!/usr/bin/env python3
"""Windows pre-open GEX collector (win-host + Futu OpenD only — do not run on GCP).

Schedule (America/New_York, DST-aware via ZoneInfo):
  wake 08:45 ET (Task Scheduler) → pull chain at 09:00 ET →
  finish latest.json inside 09:20–09:25 ET (deadline 09:25, mark late).

OI is prior-close T+1 inventory. The clock is so the snapshot exists before
Zhao ~09:32; it is not a fresh OI print. A 09:31 spot-only refresh must not
repull OI (stub until collect_futu can split spot from the chain).

Modes (open_session_config.json):
  auto              — run immediately, notify result
  notify_then_auto  — WeCom preview, wait, skip if flag file exists, then run
  ask_console       — Y/N in terminal (manual only)
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
DEFAULT_CONFIG = HERE / "open_session_config.json"
EXAMPLE_CONFIG = HERE / "open_session_config.example.json"
COLLECT = HERE / "collect_futu.py"
ET_ZONE = "America/New_York"
DEFAULT_WAKE_ET = "08:45"
DEFAULT_CHAIN_PULL_ET = "09:00"
DEFAULT_DEADLINE_ET = "09:25"
DEFAULT_FINISH_WINDOW_ET = "09:20-09:25"
DEFAULT_SPOT_REFRESH_ET = "09:31"
DEFAULT_ZHAO_TIMELINESS_ET = "09:32"
OI_AS_OF = "yesterday_close"
OI_INVENTORY = "prior_close_t1"
OI_NOTE = (
    "OI is prior-close T+1 inventory. "
    "The 09:00 ET pull is timed so the snapshot exists before Zhao ~09:32; it is not a new OI print."
)
SPOT_REFRESH_NOTE = (
    "09:31 ET spot-only refresh must not repull OI. "
    "collect_futu has no clean spot/OI split; this path is a flag-only stub."
)


def safe_print(*args, **kwargs) -> None:
    try:
        print(*args, **kwargs)
    except UnicodeEncodeError:
        text = " ".join(str(a) for a in args)
        sys.stdout.buffer.write((text + "\n").encode(sys.stdout.encoding or "utf-8", errors="replace"))


def load_config(path: Path) -> dict:
    if not path.is_file():
        if EXAMPLE_CONFIG.is_file() and path == DEFAULT_CONFIG:
            path = EXAMPLE_CONFIG
        else:
            raise SystemExit(f"missing config: {path}")
    cfg = json.loads(path.read_text(encoding="utf-8"))
    cfg.setdefault("mode", "notify_then_auto")
    cfg.setdefault("zero_dte", ["SPY", "QQQ", "SPX"])
    cfg.setdefault("matrix", ["TSLA"])
    cfg.setdefault("skip_matrix", False)
    cfg.setdefault("expiries", 5)
    cfg.setdefault("ask_wait_seconds", 60)
    cfg.setdefault("skip_flag_path", "data/gex/.skip_open_session")
    cfg.setdefault("webhook_env", "WECHAT_WORK_WEBHOOK_URL")
    cfg.setdefault("wake_eastern_time", DEFAULT_WAKE_ET)
    cfg.setdefault("target_eastern_time", DEFAULT_CHAIN_PULL_ET)
    cfg.setdefault("deadline_eastern_time", DEFAULT_DEADLINE_ET)
    cfg.setdefault("spot_session", "premarket")
    cfg.setdefault("oi_inventory", OI_INVENTORY)
    cfg.setdefault("max_et_wait_seconds", 5400)
    return cfg


def as_et(now: datetime, tz_et: ZoneInfo | None = None) -> datetime:
    tz_et = tz_et or ZoneInfo(ET_ZONE)
    if now.tzinfo is None:
        raise ValueError("naive datetime refused; pass an aware clock")
    return now.astimezone(tz_et)


def combine_hhmm(now_et: datetime, hhmm: str) -> datetime:
    parts = hhmm.strip().split(":")
    if len(parts) < 2:
        raise ValueError(f"expected HH:MM, got {hhmm!r}")
    hour, minute = int(parts[0]), int(parts[1])
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise ValueError(f"expected HH:MM, got {hhmm!r}")
    return now_et.replace(hour=hour, minute=minute, second=0, microsecond=0)


def eastern_wait_plan(now_et: datetime, target_et_str: str, max_wait_seconds: int) -> dict:
    """Pure plan for the chain-pull gate. Does not sleep."""
    now_et = as_et(now_et)
    try:
        target_dt = combine_hhmm(now_et, target_et_str)
    except ValueError as exc:
        return {"ok": False, "error": str(exc), "action": "proceed", "wait_sec": 0.0, "now": now_et}
    wait_sec = (target_dt - now_et).total_seconds()
    if wait_sec <= 0:
        action = "proceed"
    elif wait_sec > max_wait_seconds:
        action = "exceeded"
    else:
        action = "wait"
    return {
        "ok": True,
        "action": action,
        "wait_sec": wait_sec,
        "target": target_dt,
        "now": now_et,
        "tzname": now_et.tzname(),
    }


def deadline_status(finished_et: datetime, deadline_et: str = DEFAULT_DEADLINE_ET) -> str:
    """on_time when finished_et <= deadline (inclusive); otherwise late."""
    finished_et = as_et(finished_et)
    deadline = combine_hhmm(finished_et, deadline_et)
    return "late" if finished_et > deadline else "on_time"


def spot_session_at(now_et: datetime) -> str:
    now_et = as_et(now_et)
    minutes = now_et.hour * 60 + now_et.minute + now_et.second / 60.0
    if 4 * 60 <= minutes < 9 * 60 + 30:
        return "premarket"
    if 9 * 60 + 30 <= minutes < 16 * 60:
        return "rth"
    return "closed_or_extended"


def build_preopen_metadata(pull_started: datetime, finished: datetime, cfg: dict, *, spot_only: bool) -> dict:
    pull_started = as_et(pull_started)
    finished = as_et(finished)
    deadline = str(cfg.get("deadline_eastern_time") or DEFAULT_DEADLINE_ET)
    chain_pull = str(cfg.get("target_eastern_time") or DEFAULT_CHAIN_PULL_ET)
    status = deadline_status(finished, deadline)
    try:
        chain_dt = combine_hhmm(pull_started, chain_pull)
        pulled_before = pull_started < chain_dt
    except ValueError:
        pulled_before = False
    return {
        "spot_session": spot_session_at(pull_started),
        "oi_as_of": OI_AS_OF,
        "oi_inventory": str(cfg.get("oi_inventory") or OI_INVENTORY),
        "oi_note": OI_NOTE,
        "preopen": {
            "wake_et": str(cfg.get("wake_eastern_time") or DEFAULT_WAKE_ET),
            "chain_pull_et": chain_pull,
            "finish_window_et": DEFAULT_FINISH_WINDOW_ET,
            "deadline_et": deadline,
            "deadline_status": status,
            "late": status == "late",
            "pull_started_et": pull_started.strftime("%H:%M:%S"),
            "finished_at_et": finished.strftime("%H:%M:%S"),
            "finished_at": finished.isoformat(timespec="seconds"),
            "zhao_timeliness_et": DEFAULT_ZHAO_TIMELINESS_ET,
            "host": "win-host",
            "gateway": "futu-opend",
            "pulled_before_chain_target": pulled_before,
        },
        "spot_refresh": {
            "optional_et": DEFAULT_SPOT_REFRESH_ET,
            "mode": "spot_only",
            "repull_oi": False,
            "implemented": False,
            "status": "stub_no_chain_split" if spot_only else "not_this_run",
            "note": SPOT_REFRESH_NOTE,
        },
    }


def apply_metadata(latest: Path, meta: dict, *, spot_only: bool) -> dict:
    """Stamp pre-open fields. Spot-only refresh never rewrites chain/OI payload."""
    data: dict = {}
    if latest.is_file():
        data = json.loads(latest.read_text(encoding="utf-8"))
    if spot_only:
        if not latest.is_file():
            return {"rc": 2, "written": False, "data": data}
        frozen_keys = ("zero_dte", "matrix", "oi_as_of", "oi_inventory", "oi_note", "collection", "spot_session")
        before = {key: data.get(key) for key in frozen_keys}
        data["spot_refresh"] = meta["spot_refresh"]
        after = {key: data.get(key) for key in frozen_keys}
        if before != after:
            raise RuntimeError("spot-only refresh changed chain or OI fields")
        latest.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"rc": 0, "written": True, "data": data}
    data["spot_session"] = meta["spot_session"]
    data["oi_as_of"] = meta["oi_as_of"]
    data["oi_inventory"] = meta["oi_inventory"]
    data["oi_note"] = meta["oi_note"]
    data["preopen"] = meta["preopen"]
    data["spot_refresh"] = meta["spot_refresh"]
    latest.parent.mkdir(parents=True, exist_ok=True)
    latest.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"rc": 0, "written": True, "data": data}


def wait_for_eastern_market(
    target_et_str: str = DEFAULT_CHAIN_PULL_ET,
    max_wait_seconds: int = 5400,
    skip: Path | None = None,
    dry_run: bool = False,
    force: bool = False,
    now_fn=None,
    sleep_fn=None,
    early_pull: str = "proceed",
) -> bool:
    """Align execution with US Eastern time (default chain pull 09:00 America/New_York).

    Immunizes Windows Task Scheduler from seasonal DST shifts (EDT vs EST).
    Returns True if the caller may pull, False if aborted (skip flag, or early_pull=abort).
    """
    if force:
        print("[open_session] force=True — skipping Eastern market alignment wait")
        return True

    try:
        tz_et = ZoneInfo(ET_ZONE)
    except Exception as exc:
        print(f"[open_session] warning: could not load America/New_York timezone ({exc}) — skipping wait")
        return True

    now_et = as_et(now_fn(), tz_et) if now_fn else datetime.now(tz_et)
    plan = eastern_wait_plan(now_et, target_et_str, max_wait_seconds)
    if not plan["ok"]:
        print(f"[open_session] invalid target_eastern_time '{target_et_str}': {plan.get('error')} — skipping wait")
        return True

    wait_sec = plan["wait_sec"]
    if plan["action"] == "proceed":
        print(
            f"[open_session] ET alignment: current {now_et.strftime('%H:%M:%S %Z')} >= target {target_et_str} ET (diff={wait_sec:.1f}s). Proceeding immediately."
        )
        return True

    if plan["action"] == "exceeded":
        if early_pull == "abort":
            print(
                f"[open_session] ET alignment: current {now_et.strftime('%H:%M:%S %Z')}, target {target_et_str} ET. "
                f"Wait {wait_sec:.0f}s exceeds max {max_wait_seconds}s. Refusing to pull the chain early."
            )
            return False
        print(
            f"[open_session] ET alignment: current {now_et.strftime('%H:%M:%S %Z')}, target {target_et_str} ET. "
            f"Wait time {wait_sec:.0f}s exceeds max {max_wait_seconds}s. Proceeding without wait."
        )
        return True

    print(
        f"[open_session] ET alignment (DST safe): current {now_et.strftime('%H:%M:%S %Z')} -> target {target_et_str} ET. "
        f"Waiting {wait_sec:.1f}s until chain pull..."
    )

    if dry_run:
        print(f"[open_session] dry-run — skip actual sleeping for {wait_sec:.1f}s")
        return True

    def do_sleep(sec: float) -> None:
        if sleep_fn is not None:
            sleep_fn(sec)
        else:
            time.sleep(sec)

    left = wait_sec
    while left > 0:
        if skip and skip.is_file():
            print("[open_session] skip flag present during ET wait — abort")
            return False
        step = min(5.0, left)
        do_sleep(step)
        left -= step

    if now_fn:
        now_done = as_et(now_fn(), tz_et)
    else:
        now_done = datetime.now(tz_et)
    print(f"[open_session] ET alignment reached: {now_done.strftime('%H:%M:%S %Z')}")
    return True


def resolve_webhook(cfg: dict) -> str:
    env_name = cfg.get("webhook_env") or "WECHAT_WORK_WEBHOOK_URL"
    url = os.environ.get(env_name) or os.environ.get("WECHAT_ALERT_WEBHOOK_URL") or ""
    # Optional: load from repo .env without committing secrets
    if not url:
        env_path = ROOT / ".env"
        if env_path.is_file():
            for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                if k.strip() in (env_name, "WECHAT_WORK_WEBHOOK_URL", "WECHAT_ALERT_WEBHOOK_URL"):
                    url = v.strip().strip('"').strip("'")
                    if url:
                        break
    return url


def send_wecom(webhook: str, markdown: str) -> bool:
    if not webhook:
        print("[open_session] webhook unset — print only:\n", markdown)
        return False
    body = json.dumps({"msgtype": "markdown", "markdown": {"content": markdown}}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        webhook,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8", errors="ignore")
            print("[open_session] wecom response:", raw[:200])
            return True
    except urllib.error.URLError as exc:
        print(f"[open_session] wecom failed: {exc}", file=sys.stderr)
        return False


def skip_path(cfg: dict) -> Path:
    p = Path(cfg["skip_flag_path"])
    return p if p.is_absolute() else (ROOT / p)


def build_collect_cmd(cfg: dict) -> list[str]:
    zero = ",".join(cfg.get("zero_dte") or [])
    matrix = ",".join(cfg.get("matrix") or [])
    cmd = [
        sys.executable,
        str(COLLECT),
        "--zero-dte",
        zero or "SPY,QQQ,SPX",
        "--expiries",
        str(int(cfg.get("expiries") or 5)),
    ]
    if cfg.get("skip_matrix"):
        cmd.append("--skip-matrix")
    else:
        cmd.extend(["--matrix", matrix or "TSLA"])
    return cmd


def run_collect(cfg: dict, dry_run: bool) -> int:
    cmd = build_collect_cmd(cfg)
    print("[open_session] collect cmd:", " ".join(cmd))
    if dry_run:
        print("[open_session] dry-run — skip collect_futu.py")
        return 0
    env = os.environ.copy()
    env.setdefault("PYTHONIOENCODING", "utf-8")
    env.setdefault("LONGBRIDGE_REGION", "global")
    proc = subprocess.run(cmd, cwd=str(ROOT), env=env)
    return int(proc.returncode)


def summarize_latest() -> str:
    latest = ROOT / "data" / "gex" / "latest.json"
    if not latest.is_file():
        return "latest.json 缺失"
    try:
        data = json.loads(latest.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return f"latest.json 解析失败: {exc}"
    gen = data.get("generated_at") or "—"
    src = data.get("source") or "—"
    ok = (data.get("collection") or {}).get("ok")
    zd = ",".join(sorted((data.get("zero_dte") or {}).keys())) or "—"
    mx = ",".join(sorted((data.get("matrix") or {}).keys())) or "—"
    pre = data.get("preopen") or {}
    return (
        f"generated_at={gen} source={src} collection.ok={ok}\n"
        f"spot_session={data.get('spot_session') or '—'} oi_inventory={data.get('oi_inventory') or '—'} "
        f"deadline={pre.get('deadline_status') or '—'}\n"
        f"zero_dte=[{zd}] matrix=[{mx}]"
    )


def _clock(now_fn, tz_et: ZoneInfo):
    def current() -> datetime:
        if now_fn is None:
            return datetime.now(tz_et)
        return as_et(now_fn(), tz_et)

    return current


def _sleep_with_skip(seconds: float, skip: Path | None, force: bool, sleep_fn) -> bool:
    """Sleep up to `seconds`. Return False when the skip flag aborts."""
    left = max(0.0, seconds)
    while left > 0:
        if skip and skip.is_file() and not force:
            print("[open_session] skip flag present — abort")
            return False
        step = min(5.0, left)
        if sleep_fn is not None:
            sleep_fn(step)
        else:
            time.sleep(step)
        left -= step
    return True


def _clear_skip(skip: Path | None) -> None:
    if skip and skip.is_file():
        try:
            skip.unlink()
        except OSError:
            pass


def run_preopen(
    cfg: dict,
    *,
    now_fn=None,
    sleep_fn=None,
    collect_fn=None,
    latest_path: Path | None = None,
    dry_run: bool = False,
    force: bool = False,
    no_wait_et: bool = False,
    spot_only: bool = False,
    notify_fn=None,
    skip: Path | None = None,
) -> dict:
    """Wake-aligned chain pull, deadline stamp, or spot-only OI-safe stub.

    collect_fn(cfg, dry_run) -> int. Tests inject a fake clock via now_fn/sleep_fn.
    """
    tz_et = ZoneInfo(ET_ZONE)
    current = _clock(now_fn, tz_et)
    latest = latest_path or (ROOT / "data" / "gex" / "latest.json")
    collect_fn = collect_fn or run_collect
    target_et = str(cfg.get("target_eastern_time") or DEFAULT_CHAIN_PULL_ET)
    max_wait = int(cfg.get("max_et_wait_seconds") or 5400)
    mode = str(cfg.get("mode") or "notify_then_auto").strip()
    ask_wait = int(cfg.get("ask_wait_seconds") or 0)

    if spot_only:
        meta = build_preopen_metadata(current(), current(), cfg, spot_only=True)
        if dry_run:
            print("[open_session] dry-run spot-only stub — no OpenD, no OI rewrite")
            return {"rc": 0, "collected": False, "aborted": None, "meta": meta, "collect_at": None}
        applied = apply_metadata(latest, meta, spot_only=True)
        print(
            f"[open_session] spot-only refresh stub status={meta['spot_refresh']['status']} "
            f"repull_oi={meta['spot_refresh']['repull_oi']} written={applied['written']}"
        )
        return {
            "rc": applied["rc"],
            "collected": False,
            "aborted": None if applied["written"] else "no_snapshot",
            "meta": meta,
            "collect_at": None,
            "data": applied["data"],
        }

    if mode == "notify_then_auto" and not force:
        zero = cfg.get("zero_dte") or []
        matrix = [] if cfg.get("skip_matrix") else (cfg.get("matrix") or [])
        preview = (
            f"### GEX 盘前拉链预告\n"
            f"> 链拉取目标 **{target_et} ET**（唤醒 {cfg.get('wake_eastern_time') or DEFAULT_WAKE_ET}）\n"
            f"> 截止 {cfg.get('deadline_eastern_time') or DEFAULT_DEADLINE_ET} ET · spot_session=premarket\n"
            f"> OI=prior-close T+1，对齐赵哥约 {DEFAULT_ZHAO_TIMELINESS_ET}，不是新 OI\n"
            f"> zero_dte: `{','.join(zero)}`\n"
            f"> matrix: `{','.join(matrix) if matrix else '(skip)'}`\n"
            f"> 跳过：在本机创建 `{skip.as_posix() if skip else 'data/gex/.skip_open_session'}`\n"
            f"> 模式: notify_then_auto · 非买卖指令"
        )
        if dry_run:
            safe_print("[open_session] dry-run preview (no wecom):\n", preview)
        elif notify_fn:
            notify_fn(preview)
        if ask_wait > 0 and not dry_run:
            gap = eastern_wait_plan(current(), target_et, max_wait)["wait_sec"]
            notify_sleep = min(float(ask_wait), gap) if gap > 0 else 0.0
            if notify_sleep > 0:
                print(f"[open_session] notify window {notify_sleep:.0f}s (clamped to chain pull {target_et} ET)")
                if not _sleep_with_skip(notify_sleep, skip, force, sleep_fn):
                    if notify_fn:
                        notify_fn("### GEX 盘前拉链已跳过\n> 检测到 skip 文件，本次未拉链。")
                    _clear_skip(skip)
                    return {"rc": 0, "collected": False, "aborted": "skip", "meta": None, "collect_at": None}

    if not no_wait_et:
        plan = eastern_wait_plan(current(), target_et, max_wait)
        if plan["ok"] and plan["action"] == "exceeded":
            print(
                f"[open_session] refusing early chain pull: wait {plan['wait_sec']:.0f}s "
                f"> max {max_wait}s (target {target_et} ET)"
            )
            return {"rc": 3, "collected": False, "aborted": "before_chain_pull", "meta": None, "collect_at": None}
        proceed = wait_for_eastern_market(
            target_et_str=target_et,
            max_wait_seconds=max_wait,
            skip=skip,
            dry_run=dry_run,
            force=force,
            now_fn=now_fn,
            sleep_fn=sleep_fn,
            early_pull="abort",
        )
        if not proceed:
            if notify_fn and not dry_run:
                notify_fn("### GEX 盘前拉链已跳过\n> 检测到 skip 文件，本次未拉链。")
            _clear_skip(skip)
            return {"rc": 0, "collected": False, "aborted": "skip", "meta": None, "collect_at": None}

    if skip and skip.is_file() and not force:
        print("[open_session] skip flag present — abort")
        return {"rc": 0, "collected": False, "aborted": "skip", "meta": None, "collect_at": None}

    if mode == "ask_console" and not force and not dry_run:
        zero = cfg.get("zero_dte") or []
        matrix = [] if cfg.get("skip_matrix") else (cfg.get("matrix") or [])
        ans = input(f"Run GEX collect for {zero}+{matrix}? [y/N] ").strip().lower()
        if ans not in ("y", "yes"):
            print("[open_session] cancelled by console")
            return {"rc": 0, "collected": False, "aborted": "console", "meta": None, "collect_at": None}

    pull_started = current()
    before = latest.read_bytes() if latest.is_file() else None
    rc = int(collect_fn(cfg, dry_run))
    finished = current()
    meta = build_preopen_metadata(pull_started, finished, cfg, spot_only=False)
    changed = latest.is_file() and latest.read_bytes() != before
    if not dry_run and latest.is_file() and (changed or rc == 0):
        apply_metadata(latest, meta, spot_only=False)
        flag = "LATE" if meta["preopen"]["late"] else "on_time"
        print(
            f"[open_session] chain pull finished {meta['preopen']['finished_at_et']} ET "
            f"deadline {meta['preopen']['deadline_et']} → {flag} "
            f"spot_session={meta['spot_session']} oi_inventory={meta['oi_inventory']}"
        )
    elif not dry_run:
        print("[open_session] collect did not write latest.json — deadline not stamped onto a prior snapshot")
    return {
        "rc": rc,
        "collected": True,
        "aborted": None,
        "meta": meta,
        "collect_at": pull_started,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="GEX pre-open runner (Windows win-host + OpenD)")
    ap.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    ap.add_argument("--dry-run", action="store_true", help="Print plan only; do not call OpenD")
    ap.add_argument("--force", action="store_true", help="Ignore skip flag and ask_wait")
    ap.add_argument("--no-wait-et", action="store_true", help="Skip waiting for the 09:00 ET chain pull")
    ap.add_argument("--target-et", type=str, default="", help="Override chain-pull Eastern time (HH:MM, default 09:00)")
    ap.add_argument("--deadline-et", type=str, default="", help="Override deadline Eastern time (HH:MM, default 09:25)")
    ap.add_argument(
        "--spot-only-refresh",
        action="store_true",
        help="09:31 stub: flag a spot-only refresh and do not repull OI or call OpenD",
    )
    args = ap.parse_args()

    cfg = load_config(args.config)
    mode = str(cfg.get("mode") or "notify_then_auto").strip()
    zero = cfg.get("zero_dte") or []
    matrix = [] if cfg.get("skip_matrix") else (cfg.get("matrix") or [])
    wait_sec = int(cfg.get("ask_wait_seconds") or 0)
    skip = skip_path(cfg)
    webhook = resolve_webhook(cfg)
    if args.target_et:
        cfg["target_eastern_time"] = args.target_et.strip()
    if args.deadline_et:
        cfg["deadline_eastern_time"] = args.deadline_et.strip()
    target_et = str(cfg.get("target_eastern_time") or DEFAULT_CHAIN_PULL_ET)
    deadline_et = str(cfg.get("deadline_eastern_time") or DEFAULT_DEADLINE_ET)

    print(
        f"[open_session] mode={mode} zero_dte={zero} matrix={matrix} notify_wait={wait_sec}s "
        f"wake={cfg.get('wake_eastern_time')} chain_pull={target_et} deadline={deadline_et} ET"
    )
    print(f"[open_session] skip_flag={skip} host=win-host gateway=futu-opend")

    def notify(text: str) -> None:
        send_wecom(webhook, text)

    if mode == "auto" and not args.dry_run and not args.spot_only_refresh:
        notify(
            f"### GEX 盘前拉链开始\n> chain_pull `{target_et} ET` · deadline `{deadline_et} ET`\n"
            f"> zero_dte: `{','.join(zero)}` · matrix: `{','.join(matrix) if matrix else '(skip)'}`\n"
            f"> OI=prior-close T+1 · 非买卖指令"
        )

    result = run_preopen(
        cfg,
        dry_run=args.dry_run,
        force=args.force,
        no_wait_et=args.no_wait_et,
        spot_only=args.spot_only_refresh,
        notify_fn=None if args.dry_run else notify,
        skip=skip,
    )
    rc = int(result["rc"])
    if args.spot_only_refresh:
        safe_print("[open_session] spot-only refresh did not call collect_futu; repull_oi=false")
        return rc
    if result.get("aborted"):
        return rc
    pre = (result.get("meta") or {}).get("preopen") or {}
    late = pre.get("deadline_status")
    status = "OK" if rc == 0 else "FAIL"
    if late == "late":
        status = f"{status} LATE"
    if args.dry_run:
        safe_print(
            "[open_session] dry-run result (no wecom, no latest.json write):\n",
            f"### GEX 盘前拉链预演\n> exit={rc}\n> if pulled at this clock: "
            f"deadline={late or 'n/a'} finished_at_et={pre.get('finished_at_et') or '—'}\n> 不是买卖指令",
        )
    else:
        summary = summarize_latest()
        result_msg = f"### GEX 盘前拉链结束 ({status})\n> exit={rc}\n> {summary}\n> 不是买卖指令"
        notify(result_msg)
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
