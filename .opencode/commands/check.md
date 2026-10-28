---
description: Run all offline checks (py_compile, node --check, smoke test)
---
Run the three checks from AGENTS.md section 4 and report the result in two lines.
!`python3 -m py_compile server.py && echo PY_OK; for f in js/*.js; do node --check "$f" || echo "BAD $f"; done; bash tests/smoke.sh 2>&1 | tail -5`
