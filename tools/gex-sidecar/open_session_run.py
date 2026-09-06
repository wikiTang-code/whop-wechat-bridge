#!/usr/bin/env python3
"""Windows open-session GEX collector (local only — do not run on GCP).

Modes (open_session_config.json):
  auto              — run immediately, notify result
  notify_then_auto  — WeCom preview, wait, skip if flag file exists, then run
  ask_console       — Y/N in terminal (manual only)

Default schedule target: ~09:40 America/New_York via Task Scheduler.
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
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
DEFAULT_CONFIG = HERE / "open_session_config.json"
EXAMPLE_CONFIG = HERE / "open_session_config.example.json"
COLLECT = HERE / "collect_futu.py"


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
    cfg.setdefault("ask_wait_seconds", 300)
    cfg.setdefault("skip_flag_path", "data/gex/.skip_open_session")
    cfg.setdefault("webhook_env", "WECHAT_WORK_WEBHOOK_URL")
    return cfg


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
    return f"generated_at={gen} source={src} collection.ok={ok}\nzero_dte=[{zd}] matrix=[{mx}]"


def main() -> int:
    ap = argparse.ArgumentParser(description="GEX open-session runner (Windows local)")
    ap.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    ap.add_argument("--dry-run", action="store_true", help="Print plan only; do not call OpenD")
    ap.add_argument("--force", action="store_true", help="Ignore skip flag and ask_wait")
    args = ap.parse_args()

    cfg = load_config(args.config)
    mode = str(cfg.get("mode") or "notify_then_auto").strip()
    zero = cfg.get("zero_dte") or []
    matrix = [] if cfg.get("skip_matrix") else (cfg.get("matrix") or [])
    wait_sec = int(cfg.get("ask_wait_seconds") or 0)
    skip = skip_path(cfg)
    webhook = resolve_webhook(cfg)

    print(f"[open_session] mode={mode} zero_dte={zero} matrix={matrix} wait={wait_sec}s")
    print(f"[open_session] skip_flag={skip}")

    if mode == "ask_console" and not args.force and not args.dry_run:
        ans = input(f"Run GEX collect for {zero}+{matrix}? [y/N] ").strip().lower()
        if ans not in ("y", "yes"):
            print("[open_session] cancelled by console")
            return 0

    if mode == "notify_then_auto" and not args.force:
        preview = (
            f"### GEX 开盘采集预告\n"
            f"> 将在 **{wait_sec}s** 后本机拉链\n"
            f"> zero_dte: `{','.join(zero)}`\n"
            f"> matrix: `{','.join(matrix) if matrix else '(skip)'}`\n"
            f"> 跳过：在本机创建 `{skip.as_posix()}`\n"
            f"> 模式: notify_then_auto · 非买卖指令"
        )
        if args.dry_run:
            safe_print("[open_session] dry-run preview (no wecom):\n", preview)
        else:
            send_wecom(webhook, preview)
        if wait_sec > 0 and not args.dry_run:
            print(f"[open_session] waiting {wait_sec}s (create skip file to abort)...")
            deadline = time.time() + wait_sec
            while time.time() < deadline:
                if skip.is_file():
                    print("[open_session] skip flag present — abort")
                    send_wecom(webhook, "### GEX 开盘采集已跳过\n> 检测到 skip 文件，本次未拉链。")
                    try:
                        skip.unlink()
                    except OSError:
                        pass
                    return 0
                time.sleep(min(5, max(1, deadline - time.time())))

    if skip.is_file() and not args.force:
        print("[open_session] skip flag present — abort")
        return 0

    if mode == "auto" and not args.dry_run:
        send_wecom(
            webhook,
            f"### GEX 开盘采集开始\n> zero_dte: `{','.join(zero)}` · matrix: `{','.join(matrix) if matrix else '(skip)'}`",
        )

    rc = run_collect(cfg, dry_run=args.dry_run)
    summary = summarize_latest() if not args.dry_run else "(dry-run)"
    status = "OK" if rc == 0 else "FAIL"
    result_msg = f"### GEX 开盘采集结束 ({status})\n> exit={rc}\n> {summary}\n> 不是买卖指令"
    if args.dry_run:
        safe_print("[open_session] dry-run result (no wecom):\n", result_msg)
    else:
        send_wecom(webhook, result_msg)
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
