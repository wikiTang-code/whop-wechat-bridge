#!/usr/bin/env python3
"""Schedule-only morning-session tests: fake clock, no Futu/network/installers."""
import json
import tempfile
from datetime import datetime
from pathlib import Path

from test_open_session_preopen import ET, ROOT, FakeClock, _cfg, _chain, _run
from open_session_run import session_label_for_target
from post_collect_pipeline import generate_gex_analysis_digest


def test_morning_gate_deadlines_and_metadata():
    for month in (1, 7):
        for minute, second, status in ((35, 0, "on_time"), (40, 0, "on_time"), (40, 1, "late")):
            clock = FakeClock(datetime(2026, month, 15, 20, 10, tzinfo=ET))
            cfg = _cfg(wake_eastern_time="20:10", target_eastern_time="20:15",
                       deadline_eastern_time="20:40", finish_window_et="20:35-20:40")
            calls = []
            with tempfile.TemporaryDirectory() as tmp:
                latest = Path(tmp) / "latest.json"

                def collect(_cfg, dry_run):
                    calls.append(clock.now)
                    latest.write_text(json.dumps(_chain(clock)), encoding="utf-8")
                    clock.now = datetime(2026, month, 15, 20, minute, second, tzinfo=ET)
                    return 0

                result = _run(clock, latest, collect, cfg=cfg)
                assert calls == [datetime(2026, month, 15, 20, 15, tzinfo=ET)]
                meta = result["meta"]["preopen"]
                assert meta["wake_et"] == "20:10"
                assert meta["chain_pull_et"] == "20:15"
                assert meta["deadline_et"] == "20:40"
                assert meta["finish_window_et"] == "20:35-20:40"
                assert meta["deadline_status"] == status
    print("[PASS] Morning EST/EDT: 20:10 -> 20:15; 20:35/20:40 on_time, 20:40:01 late")


def test_titles_and_installer_source():
    assert session_label_for_target("08:00") == "盘前开盘(晚场)"
    assert session_label_for_target("20:15") == "盘后结算(早场)"
    for hour, phrase, target in ((8, "开盘前·晚场", "08:00 ET"), (20, "盘后结算·早场", "20:15 ET")):
        digest = generate_gex_analysis_digest({"generated_at": f"2026-11-05T{hour:02d}:15:00-05:00"})
        title = digest.splitlines()[0]
        assert phrase in title and target in title, title
        assert "CST" not in title
    src = (ROOT / "tools/gex-sidecar/install_open_session_task.ps1").read_text(encoding="utf-8")
    assert '--wake-et 20:10 --target-et 20:15 --deadline-et 20:40 --finish-window-et 20:35-20:40' in src
    assert '--wake-et 07:45 --target-et 08:00 --deadline-et 08:25 --finish-window-et 08:20-08:25' in src
    assert '2026-12-02 01:10:00' in src and '2026-07-02 00:10:00' in src
    assert '2026-12-01 12:45:00' in src and '2026-07-01 11:45:00' in src
    assert '$morningLocal.AddMinutes(5)' in src
    print("[PASS] Session titles corrected; installer source anchors and overrides match (installer NOT executed)")


if __name__ == "__main__":
    test_morning_gate_deadlines_and_metadata()
    test_titles_and_installer_source()
    print("[SUCCESS] Morning-session schedule tests passed")