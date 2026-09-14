#!/bin/bash
set -euo pipefail
ROOT="${LOCAL_OPS_REMOTE_ROOT:-/home/wikitang628/whop-wechat-bridge}"
cd "$ROOT"
python3 - <<'PY'
import json, os, shutil, subprocess
out = {"ok": True}
try:
    free = subprocess.check_output(["free", "-m"], text=True, timeout=5)
    lines = [ln.split() for ln in free.strip().splitlines()]
    mem = next((ln for ln in lines if ln and ln[0] == "Mem:"), None)
    if mem and len(mem) >= 7:
        out["mem_mb"] = {
            "total": int(mem[1]),
            "used": int(mem[2]),
            "free": int(mem[3]),
            "available": int(mem[6]),
        }
except Exception as e:
    out["mem_error"] = str(e)
try:
    usage = shutil.disk_usage(".")
    out["disk_gb"] = {
        "total": round(usage.total / (1024**3), 2),
        "used": round(usage.used / (1024**3), 2),
        "free": round(usage.free / (1024**3), 2),
    }
except Exception as e:
    out["disk_error"] = str(e)
try:
    load1, load5, load15 = os.getloadavg()
    out["loadavg"] = [round(load1, 2), round(load5, 2), round(load15, 2)]
except Exception as e:
    out["load_error"] = str(e)
print(json.dumps(out, ensure_ascii=False))
PY
