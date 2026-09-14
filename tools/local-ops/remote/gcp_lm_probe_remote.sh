#!/bin/bash
set -euo pipefail
# Probe whether reverse-mapped LM is reachable on the VM loopback.
python3 - <<'PY'
import json, socket, time
host, port = "127.0.0.1", 8080
started = time.time()
ok = False
detail = ""
try:
    s = socket.create_connection((host, port), timeout=1.5)
    s.close()
    ok = True
    detail = "connect"
except Exception as e:
    detail = str(e)
print(json.dumps({
    "ok": ok,
    "host": host,
    "port": port,
    "rtt_ms": int((time.time() - started) * 1000),
    "detail": detail,
}, ensure_ascii=False))
PY
