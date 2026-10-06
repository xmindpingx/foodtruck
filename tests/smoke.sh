#!/usr/bin/env bash
# Offline smoke test for the food-truck site. Starts server.py on a spare port with a
# throw-away data dir (never touches live data/), checks routes + security + cart math.
# Usage: tests/smoke.sh      (exit 0 = pass). Used by aider's /test.
set -u
cd "$(dirname "$0")/.."
PORT=${SMOKE_PORT:-8199}
TMP=$(mktemp -d); trap 'kill $SRV 2>/dev/null; rm -rf "$TMP"' EXIT
fail=0; ok(){ printf '  ok   %s\n' "$1"; }; bad(){ printf '  FAIL %s\n' "$1"; fail=1; }

echo "== syntax"
python3 -m py_compile server.py && ok "server.py compiles" || bad "server.py does not compile"
for f in js/*.js; do node --check "$f" 2>/dev/null && ok "$f parses" || bad "$f has a syntax error"; done

echo "== server"
PORT=$PORT FOODTRUCK_DATA="$TMP" python3 server.py >"$TMP/log" 2>&1 & SRV=$!
for i in $(seq 1 30); do curl -sf "http://127.0.0.1:$PORT/api/menu" >/dev/null && break; sleep 0.2; done
code(){ curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$1"; }
want(){ local c; c=$(code "$1"); [ "$c" = "$2" ] && ok "$1 -> $c" || bad "$1 -> $c (wanted $2)"; }
want /                  200
want /admin             200
want /css/site.css      200
want /js/scene.js       200
want /js/shop.js        200
want /js/truck.js       200
want /lib/three.module.js 200
want /api/menu          200
want /api/settings      200
want /data/orders.json  404
want /%64ata/orders.json 404
want /server.py         404
want /server%2Epy       404
want /js/               404
want /CONVENTIONS.md    404
want /api/admin/orders  401

echo "== public settings must not leak internal config"
curl -s "http://127.0.0.1:$PORT/api/settings" | grep -qE 'ollama|comfy|imageService' && bad "/api/settings leaks internal keys" || ok "/api/settings is clean"

echo "== order + cart math (whole cents, half-up tax)"
python3 - "$PORT" <<'PY' && ok "order total matches independent cents math" || bad "order total mismatch"
import json, sys, urllib.request
port = sys.argv[1]
get = lambda u: json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}{u}'))
menu, settings = get('/api/menu'), get('/api/settings')
items = [i for c in menu['categories'] for i in c['items']]
if not items: sys.exit(0)
it = items[0]; qty = 3
sub_c = round(float(it['price']) * 100) * qty
rate_micro = int(round(float(settings.get('taxRate', 0)) * 1_000_000))
tax_c = (sub_c * rate_micro + 500_000) // 1_000_000
body = json.dumps({'name': 'Smoke', 'phone': '4805550100', 'notes': '', 'items': [{'id': it['id'], 'qty': qty, 'protein': ''}]}).encode()
req = urllib.request.Request(f'http://127.0.0.1:{port}/api/order', body, {'Content-Type': 'application/json'})
o = json.load(urllib.request.urlopen(req))
assert round(float(o['total']) * 100) == sub_c + tax_c, (o, sub_c, tax_c)
assert get(f"/api/order/{o['id']}")['status'] == 'new'
PY

echo "== bad bodies are rejected"
c=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '[1,2]' "http://127.0.0.1:$PORT/api/order")
[ "$c" = "400" ] && ok "non-object POST body -> 400" || bad "non-object POST body -> $c"

[ $fail = 0 ] && echo "SMOKE PASS" || { echo "SMOKE FAIL"; tail -20 "$TMP/log"; }
exit $fail
