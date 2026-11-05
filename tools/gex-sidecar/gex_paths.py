#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Shared GEX path / timestamp helpers (collect + post_collect).

Day folders are always America/New_York calendar dates under data/gex/YYYYMMDD/.
New writes use ET-offset ISO for generated_at. Legacy naive timestamps are
interpreted as Asia/Shanghai wall time, then converted to ET.
"""
from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ET_ZONE = "America/New_York"
CST_ZONE = "Asia/Shanghai"
ET = ZoneInfo(ET_ZONE)
CST = ZoneInfo(CST_ZONE)


def now_et() -> datetime:
    return datetime.now(ET)


def et_iso_now() -> str:
    """ET-offset ISO timestamp for snapshot generated_at."""
    return now_et().isoformat(timespec="seconds")


def et_stamp_now() -> str:
    """Filename stamp YYYYMMDD_HHMMSS in America/New_York."""
    return now_et().strftime("%Y%m%d_%H%M%S")


def parse_generated_at(gen_at: str) -> datetime | None:
    """Parse generated_at into a tz-aware datetime in America/New_York.

    - Offset / Z timestamps: convert to ET.
    - Naive timestamps (legacy): treat as Asia/Shanghai wall clock, then to ET.
    """
    raw = (gen_at or "").strip()
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=CST)
    return dt.astimezone(ET)


def day_key_for_generated_at(
    gen_at: str, snapshot_name: str | None = None, stamp_tz: str = ET_ZONE
) -> str:
    """Return YYYYMMDD (America/New_York) for a snapshot.

    Primary: generated_at. Fallback (missing/unparseable): filename stamp
    snapshot_YYYYMMDD_HHMMSS interpreted in ``stamp_tz`` then converted to ET.
    New writer stamps are ET (default); pass Asia/Shanghai for legacy files.
    """
    dt = parse_generated_at(gen_at)
    if dt is not None:
        return dt.strftime("%Y%m%d")
    if snapshot_name:
        m = re.search(r"snapshot_(\d{8})_(\d{6})", snapshot_name)
        if m:
            local = datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S")
            return local.replace(tzinfo=ZoneInfo(stamp_tz)).astimezone(ET).strftime("%Y%m%d")
        m = re.search(r"snapshot_(\d{8})", snapshot_name)
        if m:
            return m.group(1)
    return now_et().strftime("%Y%m%d")


def is_legacy_generated_at(gen_at: str | None) -> bool:
    """True when generated_at is missing or has no UTC offset (pre-ET writer)."""
    raw = (gen_at or "").strip()
    if not raw:
        return True
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).tzinfo is None
    except Exception:
        return True


def day_dir_for_generated_at(
    gex_dir: Path, gen_at: str, snapshot_name: str | None = None, stamp_tz: str = ET_ZONE
) -> Path:
    """Resolve data/gex/YYYYMMDD from generated_at (ET calendar day)."""
    return Path(gex_dir) / day_key_for_generated_at(gen_at, snapshot_name, stamp_tz)


def et_hour(gen_at: str, default: int = 21) -> int:
    """Hour-of-day in America/New_York for session / digest labeling."""
    dt = parse_generated_at(gen_at)
    if dt is None:
        return default
    return dt.hour
