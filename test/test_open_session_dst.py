#!/usr/bin/env python3
"""Unit tests for GEX open-session DST alignment and scheduling (DEBT-013).
Validates America/New_York market alignment under both EDT (Summer) and EST (Winter).
"""
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools" / "gex-sidecar"))

from open_session_run import wait_for_eastern_market, load_config, DEFAULT_CONFIG


def test_dst_summer_edt():
    tz_et = ZoneInfo("America/New_York")
    mock_now = datetime(2026, 7, 15, 9, 38, 0, tzinfo=tz_et)
    assert mock_now.tzname() == "EDT"

    res = wait_for_eastern_market(
        target_et_str="09:40",
        max_wait_seconds=5400,
        dry_run=True,
        now_fn=lambda: mock_now,
    )
    assert res is True, "Summer EDT alignment should proceed"
    print("  [PASS] Summer EDT (09:38 -> 09:40) simulated wait passed")


def test_dst_winter_est():
    tz_et = ZoneInfo("America/New_York")
    mock_now = datetime(2026, 12, 15, 8, 38, 0, tzinfo=tz_et)
    assert mock_now.tzname() == "EST"

    res = wait_for_eastern_market(
        target_et_str="09:40",
        max_wait_seconds=5400,
        dry_run=True,
        now_fn=lambda: mock_now,
    )
    assert res is True, "Winter EST alignment should proceed"
    print("  [PASS] Winter EST (08:38 -> 09:40) simulated wait passed")


def test_market_already_open():
    tz_et = ZoneInfo("America/New_York")
    mock_now = datetime(2026, 7, 15, 9, 45, 0, tzinfo=tz_et)

    res = wait_for_eastern_market(
        target_et_str="09:40",
        max_wait_seconds=5400,
        dry_run=True,
        now_fn=lambda: mock_now,
    )
    assert res is True, "Should proceed immediately when past market target"
    print("  [PASS] Past target (09:45 > 09:40) immediate execution passed")


def test_force_flag_bypass():
    tz_et = ZoneInfo("America/New_York")
    mock_now = datetime(2026, 7, 15, 8, 0, 0, tzinfo=tz_et)

    res = wait_for_eastern_market(
        target_et_str="09:40",
        force=True,
        now_fn=lambda: mock_now,
    )
    assert res is True, "Force flag should bypass wait"
    print("  [PASS] Force flag bypass passed")


def test_skip_flag_during_wait():
    with tempfile.TemporaryDirectory() as tmpdir:
        skip_file = Path(tmpdir) / ".skip_test"
        skip_file.write_text("skip", encoding="utf-8")

        tz_et = ZoneInfo("America/New_York")
        mock_now = datetime(2026, 7, 15, 9, 39, 58, tzinfo=tz_et)

        res = wait_for_eastern_market(
            target_et_str="09:40",
            skip=skip_file,
            dry_run=False,
            now_fn=lambda: mock_now,
        )
        assert res is False, "Presence of skip flag must abort wait"
        print("  [PASS] Skip flag detection during wait passed")


def test_max_wait_exceeded():
    tz_et = ZoneInfo("America/New_York")
    mock_now = datetime(2026, 7, 15, 5, 0, 0, tzinfo=tz_et)

    res = wait_for_eastern_market(
        target_et_str="09:40",
        max_wait_seconds=3600,
        dry_run=True,
        now_fn=lambda: mock_now,
    )
    assert res is True, "Excessive wait should fail open with warning instead of hanging"
    print("  [PASS] Excessive lead time safety bound passed")


def main():
    print("===========================================================")
    print("[Test DEBT-013] GEX Open-Session DST Alignment Test Suite")
    print("===========================================================")
    test_dst_summer_edt()
    test_dst_winter_est()
    test_market_already_open()
    test_force_flag_bypass()
    test_skip_flag_during_wait()
    test_max_wait_exceeded()
    print("===========================================================")
    print("[SUCCESS] DEBT-013 DST Alignment 全部单测验证通过！")
    print("===========================================================")


if __name__ == "__main__":
    main()
