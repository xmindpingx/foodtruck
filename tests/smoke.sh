#!/usr/bin/env bash
# Offline smoke test for the food-truck site. Starts server.py on a spare port with a
# throw-away data dir (never touches live data/), checks routes + security + cart math.
# Usage: tests/smoke.sh      (exit 0 = pass). Used by aider's /test.
set -u
cd "$(dirname "$0")/.."
PORT=${SMOKE_PORT:-8199}
TMP=$(mktemp -d); trap 'kill $SRV 2>/dev/null; rm -rf "$TMP"' EXIT
# the throwaway dir would otherwise boot with the whole-site password gate ON (its default)
# and 401 the suite's own probes - the gate itself isn't what this smoke tests
echo '{"siteGateEnabled": false}' > "$TMP/settings.json"
fail=0; ok(){ printf '  ok   %s\n' "$1"; }; bad(){ printf '  FAIL %s\n' "$1"; fail=1; }

echo "== syntax"
python3 -m py_compile server.py && ok "server.py compiles" || bad "server.py does not compile"
for f in js/*.js; do node --check "$f" 2>/dev/null && ok "$f parses" || bad "$f has a syntax error"; done

echo "== server"
PORT=$PORT FOODTRUCK_NO_PREWARM=1 FOODTRUCK_DATA="$TMP" python3 server.py >"$TMP/log" 2>&1 & SRV=$!
for i in $(seq 1 30); do curl -sf "http://127.0.0.1:$PORT/api/menu" >/dev/null && break; sleep 0.2; done
code(){ curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$1"; }
want(){ local c; c=$(code "$1"); [ "$c" = "$2" ] && ok "$1 -> $c" || bad "$1 -> $c (wanted $2)"; }
want /                  200
want /admin             200
want /css/site.css      200
want /js/scene.js       200
# deploys must not sit in a 4-hour Cloudflare/browser cache: pages and modules revalidate
cc(){ curl -sI "http://127.0.0.1:$PORT$1" | tr -d '\r' | awk -F': ' 'tolower($1)=="cache-control"{print $2; exit}'; }
[ "$(cc /3d)" = "no-cache" ] && ok "/3d -> Cache-Control: no-cache" || bad "/3d cache header: $(cc /3d)"
[ "$(cc /js/scene.js)" = "no-cache" ] && ok "/js/scene.js -> Cache-Control: no-cache" || bad "/js/scene.js cache header: $(cc /js/scene.js)"
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
want /mobile            200
want /mobile.html       200
want /css/mobile.css    200
want /img/..%2Fserver.py 404

echo "== lite page: /mobile on any host, / on the m. hostname"
curl -s "http://127.0.0.1:$PORT/mobile" | grep -q 'id="mobileApp"' && ok "/mobile serves mobile.html" || bad "/mobile does not serve mobile.html"
curl -s "http://127.0.0.1:$PORT/mobile" | grep -qE 'src="(js/(scene|avatars|arcade|pacman|chess)\.js|lib/)|import\(.\./js/(scene|avatars|arcade)' && bad "/mobile pulls in the 3D scene" || ok "/mobile has no three.js / scene / games"
curl -s -H 'Host: mfood.signaturediversified.com' "http://127.0.0.1:$PORT/" | grep -q 'id="mobileApp"' && ok "Host mfood.signaturediversified.com / -> mobile.html" || bad "m. host / did not serve mobile.html"
curl -s -H 'Host: mfood.signaturediversified.com' "http://127.0.0.1:$PORT/order" | grep -q 'id="mobileApp"' && ok "m. host /order -> mobile.html" || bad "m. host /order did not serve mobile.html"
curl -s "http://127.0.0.1:$PORT/" | grep -q 'js/scene.js' && ok "default host / -> index.html (3D)" || bad "default host / did not serve index.html"
curl -s -H 'Host: mfood.signaturediversified.com' "http://127.0.0.1:$PORT/3d" | grep -q 'js/scene.js' && ok "m. host /3d -> index.html (lite mode off = 3D truck + games)" || bad "m. host /3d did not serve index.html"
c=$(curl -s -o /dev/null -w '%{http_code}' -I "http://127.0.0.1:$PORT/3d"); [ "$c" = "200" ] && ok "HEAD /3d -> 200" || bad "HEAD /3d -> $c"
c=$(curl -s -o /dev/null -w '%{http_code}' -I -H 'Host: mfood.signaturediversified.com' "http://127.0.0.1:$PORT/")
[ "$c" = "200" ] && ok "HEAD / on the m. host -> 200" || bad "HEAD / on the m. host -> $c"
c=$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: mfood.signaturediversified.com' "http://127.0.0.1:$PORT/data/orders.json")
[ "$c" = "404" ] && ok "m. host /data/orders.json -> 404" || bad "m. host /data/orders.json -> $c"

echo "== SMS opt-in block + legal footer identical on both pages (registered wording)"
python3 - <<'PYX' && ok "index.html / mobile.html #smsOptIn + #foot identical" || bad "SMS opt-in / footer differ between index.html and mobile.html"
import re
def grab(f, pat):
    m = re.search(pat, open(f, encoding='utf-8').read(), re.S); assert m, (f, pat)
    return re.sub(r'\s+', ' ', re.sub(r'<!--.*?-->', '', m.group(0), flags=re.S)).strip()
for pat in (r'<div id="smsOptIn".*?</label>\s*<div style[^>]*>.*?</div>\s*</div>', r'<footer id="foot">.*?</footer>'):
    assert grab('index.html', pat) == grab('mobile.html', pat), pat
PYX

echo "== bling catalog + new endpoints"
want /bling/catalog.json 200
want /bling/bling-crown.webp 200
want /js/life.js 200
want /js/themes.js 200
curl -s "http://127.0.0.1:$PORT/api/account/shop" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if sum(1 for i in d['items'] if i.get('bling'))>=40 else 1)" && ok "shop lists the bling collectibles" || bad "shop is missing bling items"
for ep in gift-npc npc-friend-gift rep; do
  c=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"phone":"0000000000"}' "http://127.0.0.1:$PORT/api/$([ $ep = rep ] && echo rep || echo $ep)")
  [ "$c" = "401" ] && ok "/api/$ep without an account -> 401" || bad "/api/$ep -> $c (wanted 401)"
done
python3 - <<'PYX' && ok "themes: a date picks the right holiday" || bad "themes date logic"
import subprocess, json
js = "import('./js/themes.js').then(m=>{const d=(y,mo,da)=>m.autoTheme(new Date(y,mo-1,da));console.log(JSON.stringify([d(2026,10,27),d(2026,11,1),d(2026,11,24),d(2026,12,15),d(2027,1,1),d(2027,2,10),d(2027,3,14),d(2027,3,25),d(2027,5,3),d(2027,7,2),d(2027,9,10),d(2027,8,1)]))})"
out = subprocess.run(['node', '--input-type=module', '-e', js], capture_output=True, text=True).stdout.strip()
assert json.loads(out) == ['halloween','muertos','thanksgiving','christmas','newyear','valentine','stpatrick','easter','cinco','july4','mexindep','steampunk'], out
PYX

echo "== photo downsizer (thumbnails next to the originals; public menu points at them)"
python3 - "$TMP" <<'PY' && ok "thumbnail helpers" || bad "thumbnail helpers"
import os, sys, struct, zlib
os.environ['FOODTRUCK_DATA'] = sys.argv[1]
import server
assert server.public_image('/img/menu/../server.py') == '/img/menu/../server.py'
assert server.public_image('/img/menu/.hidden.png') == '/img/menu/.hidden.png'
assert server.public_image('/img/menu/no-such-photo.png') == '/img/menu/no-such-photo.png'
assert server.public_image('/img/menu/x.t192.jpg') == '/img/menu/x.t192.jpg'
assert server.public_image('/media/logo.png') == '/media/logo.png'
if not server.MAGICK:
    print('  (ImageMagick not installed here - thumbnails are skipped, originals served)'); sys.exit(0)
def png(w, h):   # minimal valid RGB PNG
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    raw = b''.join(b'\x00' + b'\xe8\x3a\x73' * w for _ in range(h))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
p = os.path.join(sys.argv[1], 'taco-1.png')
open(p, 'wb').write(png(300, 200))
t = server.make_thumb(p)
assert t == os.path.join(sys.argv[1], 'taco-1.t192.jpg') and 0 < os.path.getsize(t) < 20000, t
assert open(t, 'rb').read(3) == b'\xff\xd8\xff', 'thumbnail is not a JPEG'
assert server.make_thumb(t) is None, 'a thumbnail must never be re-thumbnailed'
assert server.make_thumb(p) == t, 'second call must reuse the thumbnail'
bad = os.path.join(sys.argv[1], 'evil.png'); open(bad, 'wb').write(b'<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9"/>')
assert server.make_thumb(bad) is None and not os.path.exists(server.thumb_path(bad)), 'non-PNG bytes must never reach ImageMagick'
assert server.shrink_image(bad, 8) is None and open(bad, 'rb').read(4) == b'<svg'
server.shrink_image(p, 64)
w, h = struct.unpack('>II', open(p, 'rb').read(24)[16:24])
assert (w, h) == (64, 43), (w, h)
assert not [f for f in os.listdir(sys.argv[1]) if f.endswith('.tmp')], 'temp files left behind'
PY

echo "== public settings must not leak internal config"
curl -s "http://127.0.0.1:$PORT/api/settings" | grep -qE 'ollama|comfy|imageService' && bad "/api/settings leaks internal keys" || ok "/api/settings is clean"
# crowd knobs must be public so scene.js can size the lot without an admin call
curl -s "http://127.0.0.1:$PORT/api/settings" | python3 -c "
import json, sys
d = json.load(sys.stdin)
ok = all(isinstance(d.get(k), (int, float)) and 0 <= d[k] <= 3 for k in ('crowdAmount', 'actorsAmount', 'interactAmount', 'clutterAmount'))
sys.exit(0 if ok else 1)" && ok "crowd knobs are public numbers" || bad "crowd knobs missing/non-numeric in /api/settings"

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
body = json.dumps({'name': 'Smoke', 'phone': '4805550100', 'notes': '', 'items': [{'id': it['id'], 'qty': qty, 'protein': ''}], 'smsConsent': True}).encode()
req = urllib.request.Request(f'http://127.0.0.1:{port}/api/order', body, {'Content-Type': 'application/json'})
o = json.load(urllib.request.urlopen(req))
assert round(float(o['total']) * 100) == sub_c + tax_c, (o, sub_c, tax_c)
assert get(f"/api/order/{o['id']}")['status'] == 'new'
PY

echo "== order without sms consent is rejected"
c=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"name":"Smoke","phone":"4805550100","notes":"","items":[{"id":"x","qty":1}]}' "http://127.0.0.1:$PORT/api/order")
[ "$c" = "400" ] && ok "order missing smsConsent -> 400" || bad "order missing smsConsent -> $c (wanted 400)"

echo "== sms inbound webhook"
c=$(curl -s -o /dev/null -w '%{http_code}' -X POST -d 'Body=JOIN&From=%2B14805550100' "http://127.0.0.1:$PORT/api/sms/inbound")
[ "$c" = "403" ] && ok "/api/sms/inbound rejects unsigned requests -> 403" || bad "/api/sms/inbound unsigned -> $c (wanted 403, no valid Twilio signature)"

echo "== bad bodies are rejected"
c=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '[1,2]' "http://127.0.0.1:$PORT/api/order")
[ "$c" = "400" ] && ok "non-object POST body -> 400" || bad "non-object POST body -> $c"

[ $fail = 0 ] && echo "SMOKE PASS" || { echo "SMOKE FAIL"; tail -20 "$TMP/log"; }
exit $fail
