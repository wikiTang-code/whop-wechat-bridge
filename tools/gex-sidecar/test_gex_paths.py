#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""No-network unit checks for gex_paths day-dir convention."""
from __future__ import annotations

from pathlib import Path

from gex_paths import (
    day_dir_for_generated_at,
    day_key_for_generated_at,
    et_hour,
    is_legacy_generated_at,
    parse_generated_at,
)


def test_et_offset_timestamp():
    # 2026-11-05 09:00 ET -> 20261105
    key = day_key_for_generated_at("2026-11-05T09:00:00-05:00")
    assert key == "20261105", key
    d = day_dir_for_generated_at(Path("data/gex"), "2026-11-05T09:00:00-05:00")
    assert d.name == "20261105"
    assert et_hour("2026-11-05T09:00:00-05:00") == 9


def test_naive_shanghai_evening_maps_same_et_day():
    # Shanghai 2026-11-05 21:00 -> ET 2026-11-05 08:00 -> 20261105
    key = day_key_for_generated_at("2026-11-05T21:00:00")
    assert key == "20261105", key


def test_naive_shanghai_morning_maps_previous_et_day():
    # Shanghai 2026-11-05 09:00 -> ET 2026-11-04 20:00 -> 20261104
    key = day_key_for_generated_at("2026-11-05T09:00:00")
    assert key == "20261104", key
    assert et_hour("2026-11-05T09:00:00") == 20


def test_parse_offset_and_naive():
    et = parse_generated_at("2026-11-05T09:00:00-05:00")
    assert et is not None and et.hour == 9
    naive = parse_generated_at("2026-11-05T21:00:00")
    assert naive is not None and naive.hour == 8


def test_filename_stamp_fallback_tz():
    # New ET writer stamp: already ET
    assert day_key_for_generated_at("", "snapshot_20261105_090000.json") == "20261105"
    # Legacy Shanghai stamp 09:00 CST -> 2026-11-04 20:00 ET
    assert day_key_for_generated_at("", "snapshot_20261105_090000.json", "Asia/Shanghai") == "20261104"
    assert is_legacy_generated_at("") and is_legacy_generated_at("2026-11-05T09:00:00")
    assert not is_legacy_generated_at("2026-11-05T09:00:00-05:00")


if __name__ == "__main__":
    test_et_offset_timestamp()
    test_naive_shanghai_evening_maps_same_et_day()
    test_naive_shanghai_morning_maps_previous_et_day()
    test_parse_offset_and_naive()
    test_filename_stamp_fallback_tz()
    print("test_gex_paths: OK")
