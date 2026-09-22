#!/usr/bin/env python3
"""Fake-clock tests for the CHG-059 pre-open GEX chain pull (no OpenD)."""
import json
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools" / "gex-sidecar"))

from open_session_run import (  # noqa: E402
    EXAMPLE_CONFIG,
    deadline_status,
    eastern_wait_plan,
    load_config,
    run_preopen,
)

ET = ZoneInfo("America/New_York")


class FakeClock:
    def __init__(self, start: datetime):
        self.now = start

    def __call__(self):
        return self.now

    def sleep(self, sec: float) -> None:
        self.now = self.now + timedelta(seconds=sec)


def _cfg(**overrides) -> dict:
    cfg = {
        "mode": "auto",
        "zero_dte": ["SPY"],
        "matrix": ["TSLA"],
        "skip_matrix": False,
        "expiries": 5,
        "wake_eastern_time": "08:45",
        "target_eastern_time": "09:00",
        "deadline_eastern_time": "09:25",
        "ask_wait_seconds": 0,
        "max_et_wait_seconds": 5400,
        "oi_inventory": "prior_close_t1",
    }
    cfg.update(overrides)
    return cfg


def _chain(clock: FakeClock) -> dict:
    return {
        "generated_at": clock.now.isoformat(timespec="seconds"),
        "source": "futu-opend",
        "zero_dte": {"SPY": {"oi": 10, "spot": 500.0}},
        "matrix": {"TSLA": {"oi": 3, "spot": 400.0}},
        "collection": {"ok": True},
    }


def _run(clock: FakeClock, latest: Path, collect, cfg=None, **kwargs) -> dict:
    return run_preopen(
        cfg or _cfg(),
        now_fn=clock,
        sleep_fn=clock.sleep,
        collect_fn=collect,
        latest_path=latest,
        dry_run=False,
        notify_fn=lambda _text: None,
        **kwargs,
    )


def test_plan_dst_and_gate():
    summer = datetime(2026, 7, 15, 8, 45, tzinfo=ET)
    winter = datetime(2026, 1, 15, 8, 45, tzinfo=ET)
    assert summer.tzname() == "EDT"
    assert winter.tzname() == "EST"
    for now in (summer, winter):
        plan = eastern_wait_plan(now, "09:00", 5400)
        assert plan["action"] == "wait", plan
        assert plan["wait_sec"] == 15 * 60, plan
        assert plan["tzname"] == now.tzname()
    at_pull = datetime(2026, 7, 15, 9, 0, tzinfo=ET)
    assert eastern_wait_plan(at_pull, "09:00", 5400)["action"] == "proceed"
    early = eastern_wait_plan(datetime(2026, 7, 15, 5, 0, tzinfo=ET), "09:00", 5400)
    assert early["action"] == "exceeded"
    print("  [PASS] DST wait plan 08:45 → 09:00 (EDT and EST)")


def test_deadline_boundaries():
    day = datetime(2026, 7, 15, tzinfo=ET)
    assert deadline_status(day.replace(hour=9, minute=20), "09:25") == "on_time"
    assert deadline_status(day.replace(hour=9, minute=25), "09:25") == "on_time"
    assert deadline_status(day.replace(hour=9, minute=25, second=1), "09:25") == "late"
    print("  [PASS] deadline inclusive at 09:25:00, late after")


def test_chain_pull_waits_until_0900_and_stamps():
    clock = FakeClock(datetime(2026, 7, 15, 8, 45, tzinfo=ET))
    calls = []

    def collect(cfg, dry_run):
        calls.append(clock.now)
        latest.write_text(json.dumps(_chain(clock)), encoding="utf-8")
        clock.now = datetime(2026, 7, 15, 9, 22, tzinfo=ET)
        return 0

    with tempfile.TemporaryDirectory() as tmp:
        latest = Path(tmp) / "latest.json"
        result = _run(clock, latest, collect)
        assert calls == [datetime(2026, 7, 15, 9, 0, tzinfo=ET)], calls
        assert result["rc"] == 0
        data = json.loads(latest.read_text(encoding="utf-8"))
        assert data["spot_session"] == "premarket"
        assert data["oi_as_of"] == "yesterday_close"
        assert data["oi_inventory"] == "prior_close_t1"
        assert "09:32" in data["oi_note"]
        assert data["preopen"]["wake_et"] == "08:45"
        assert data["preopen"]["chain_pull_et"] == "09:00"
        assert data["preopen"]["deadline_et"] == "09:25"
        assert data["preopen"]["deadline_status"] == "on_time"
        assert data["preopen"]["late"] is False
        assert data["preopen"]["finished_at_et"] == "09:22:00"
        assert data["preopen"]["host"] == "win-host"
        assert data["preopen"]["gateway"] == "futu-opend"
        assert data["preopen"]["zhao_timeliness_et"] == "09:32"
        assert data["zero_dte"]["SPY"]["oi"] == 10
        assert data["spot_refresh"]["repull_oi"] is False
        assert data["spot_refresh"]["status"] == "not_this_run"
        assert clock.now.tzname() == "EDT"
    print("  [PASS] fake clock holds chain pull until 09:00 ET and stamps on_time")


def test_winter_clock_and_late_mark():
    clock = FakeClock(datetime(2026, 1, 15, 8, 45, tzinfo=ET))
    assert clock.now.tzname() == "EST"

    def collect(cfg, dry_run):
        assert clock.now == datetime(2026, 1, 15, 9, 0, tzinfo=ET)
        latest.write_text(json.dumps(_chain(clock)), encoding="utf-8")
        clock.now = datetime(2026, 1, 15, 9, 25, 1, tzinfo=ET)
        return 0

    with tempfile.TemporaryDirectory() as tmp:
        latest = Path(tmp) / "latest.json"
        result = _run(clock, latest, collect)
        data = json.loads(latest.read_text(encoding="utf-8"))
        assert result["meta"]["spot_session"] == "premarket"
        assert data["preopen"]["deadline_status"] == "late"
        assert data["preopen"]["late"] is True
        assert data["preopen"]["finished_at_et"] == "09:25:01"
    print("  [PASS] EST winter pull and late mark after 09:25")


def test_deadline_exact_and_window():
    def finish_at(hour, minute, second=0):
        clock = FakeClock(datetime(2026, 7, 15, 9, 0, tzinfo=ET))

        def collect(cfg, dry_run):
            latest.write_text(json.dumps(_chain(clock)), encoding="utf-8")
            clock.now = datetime(2026, 7, 15, hour, minute, second, tzinfo=ET)
            return 0

        with tempfile.TemporaryDirectory() as tmp:
            latest = Path(tmp) / "latest.json"
            result = _run(clock, latest, collect)
            return result["meta"]["preopen"]["deadline_status"]

    assert finish_at(9, 20) == "on_time"
    assert finish_at(9, 25, 0) == "on_time"
    assert finish_at(9, 25, 1) == "late"
    print("  [PASS] 09:20 and 09:25:00 on_time; 09:25:01 late")


def test_notify_window_cannot_delay_past_0900():
    clock = FakeClock(datetime(2026, 7, 15, 8, 45, tzinfo=ET))
    calls = []

    def collect(cfg, dry_run):
        calls.append(clock.now)
        latest.write_text(json.dumps(_chain(clock)), encoding="utf-8")
        return 0

    with tempfile.TemporaryDirectory() as tmp:
        latest = Path(tmp) / "latest.json"
        _run(clock, latest, collect, cfg=_cfg(mode="notify_then_auto", ask_wait_seconds=60))
        assert calls == [datetime(2026, 7, 15, 9, 0, tzinfo=ET)], calls
    print("  [PASS] 60s notify window still pulls at 09:00 ET")


def test_refuse_early_pull():
    clock = FakeClock(datetime(2026, 7, 15, 5, 0, tzinfo=ET))
    called = []

    def collect(cfg, dry_run):
        called.append(True)
        raise AssertionError("chain must not be pulled hours early")

    with tempfile.TemporaryDirectory() as tmp:
        latest = Path(tmp) / "latest.json"
        result = _run(clock, latest, collect)
        assert result["rc"] == 3
        assert result["aborted"] == "before_chain_pull"
        assert called == []
        assert not latest.exists()
    print("  [PASS] excessive lead refuses the chain pull")


def test_spot_only_does_not_repull_oi():
    clock = FakeClock(datetime(2026, 7, 15, 9, 31, tzinfo=ET))
    payload = {
        "spot_session": "premarket",
        "oi_as_of": "yesterday_close",
        "oi_inventory": "prior_close_t1",
        "oi_note": "keep",
        "zero_dte": {"SPY": {"oi": 10, "spot": 500.0}},
        "matrix": {"TSLA": {"oi": 3}},
        "collection": {"ok": True, "script": "tools/gex-sidecar/collect_futu.py"},
    }

    def collect(cfg, dry_run):
        raise AssertionError("spot-only refresh must not call collect_futu")

    with tempfile.TemporaryDirectory() as tmp:
        latest = Path(tmp) / "latest.json"
        latest.write_text(json.dumps(payload), encoding="utf-8")
        result = _run(clock, latest, collect, spot_only=True)
        assert result["rc"] == 0
        assert result["collected"] is False
        data = json.loads(latest.read_text(encoding="utf-8"))
        assert data["zero_dte"] == payload["zero_dte"]
        assert data["matrix"] == payload["matrix"]
        assert data["oi_as_of"] == "yesterday_close"
        assert data["oi_inventory"] == "prior_close_t1"
        assert data["oi_note"] == "keep"
        assert data["collection"] == payload["collection"]
        assert data["spot_session"] == "premarket"
        assert data["spot_refresh"]["repull_oi"] is False
        assert data["spot_refresh"]["implemented"] is False
        assert data["spot_refresh"]["status"] == "stub_no_chain_split"
        assert data["spot_refresh"]["optional_et"] == "09:31"
        missing = Path(tmp) / "missing.json"
        missing_result = _run(clock, missing, collect, spot_only=True)
        assert missing_result["rc"] == 2
        assert not missing.exists()
    print("  [PASS] 09:31 spot-only stub does not repull OI")


def test_example_config_and_installer():
    cfg = load_config(EXAMPLE_CONFIG)
    assert cfg["wake_eastern_time"] == "08:45"
    assert cfg["target_eastern_time"] == "09:00"
    assert cfg["deadline_eastern_time"] == "09:25"
    assert cfg["spot_session"] == "premarket"
    assert cfg["oi_inventory"] == "prior_close_t1"
    text = (ROOT / "tools" / "gex-sidecar" / "install_open_session_task.ps1").read_text(encoding="utf-8")
    assert "2026-07-01 12:45:00" in text
    assert "08:45" in text
    assert "09:00" in text
    assert "09:25" in text
    assert "WhopGexOpenSession0940ET" in text
    assert "13:33:00" not in text
    assert "09:35" not in text
    print("  [PASS] example config and Task Scheduler script match the pre-open contract")


def main():
    print("===========================================================")
    print("[Test CHG-059] GEX pre-open fake-clock suite")
    print("===========================================================")
    test_plan_dst_and_gate()
    test_deadline_boundaries()
    test_chain_pull_waits_until_0900_and_stamps()
    test_winter_clock_and_late_mark()
    test_deadline_exact_and_window()
    test_notify_window_cannot_delay_past_0900()
    test_refuse_early_pull()
    test_spot_only_does_not_repull_oi()
    test_example_config_and_installer()
    print("===========================================================")
    print("[SUCCESS] CHG-059 pre-open fake-clock tests passed")
    print("===========================================================")


if __name__ == "__main__":
    main()
