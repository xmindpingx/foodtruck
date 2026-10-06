#!/usr/bin/env python3
"""El Otro Lado site server: static files + menu/settings/order API + admin API.
Run: python3 server.py  (listens on 127.0.0.1:8095; Cloudflare tunnel fronts it)
"""
import json, os, secrets, hashlib, hmac, time, threading, re
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('FOODTRUCK_DATA') or os.path.join(ROOT, 'data')   # tests point this at a temp dir
PORT = int(os.environ.get('PORT', 8095))
LOCK = threading.Lock()
SESSIONS = {}            # token -> expiry
SESSION_TTL = 12 * 3600
FAILS = {}               # ip -> [count, first_ts]
ORDER_HITS = {}          # ip -> [order timestamps]

DEFAULT_SETTINGS = {
    "businessName": "El Otro Lado", "tagline": "The Other Side",
    "phone": "", "email": "", "social": "", "location": "", "hours": "",
    "taxRate": 0.083, "orderingOpen": True,
    "orderNote": "Pickup at the window. Pay when you pick up — card (Square) or cash.",
    # --- AI menu photos (admin) ---
    "imageGenEnabled": True,
    "ollamaUrl": "http://127.0.0.1:11434",
    "ollamaModel": "gemma4:12b",
    "imageServiceUrl": "http://127.0.0.1:8097",
    "imageEngine": "comfyui",            # "comfyui" or "flux-local"
    "comfyUrl": "http://127.0.0.1:8188",
    "comfyCheckpoint": "",               # blank = first checkpoint ComfyUI lists
    "comfyWorkflow": "",                 # optional ComfyUI API-format JSON with %PROMPT% and %SEED% placeholders
    "photoStyle": "realistic food photography, served from a Mexican food truck in Mesa Arizona, "
                  "natural daylight, shallow depth of field, close-up, appetizing, no text, no logos"
}

PUBLIC_SETTINGS = ('businessName', 'tagline', 'phone', 'email', 'social', 'location', 'hours',
                   'taxRate', 'orderingOpen', 'orderNote')

JOBS = {}   # job id -> {status, item, image, prompt, error, ts}

def http_json(url, payload, timeout):
    import urllib.request
    r = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return resp.read(), resp.headers.get('Content-Type', '')

def comfy_render(s, prompt, j):
    """Queue a txt2img workflow on ComfyUI, wait for it, return PNG bytes."""
    import urllib.request, urllib.parse
    base = s['comfyUrl'].rstrip('/')
    seed = secrets.randbelow(2**31)
    if s.get('comfyWorkflow', '').strip():
        wf = json.loads(s['comfyWorkflow'].replace('%PROMPT%', json.dumps(prompt)[1:-1]).replace('%SEED%', str(seed)))
    elif not (s.get('comfyCheckpoint') or '').strip():
        # Built-in: FLUX.2 klein 4B (distilled, 4 steps, no CFG)
        W = H = 768
        wf = {
            '1': {'class_type': 'UNETLoader', 'inputs': {'unet_name': 'flux-2-klein-4b.safetensors', 'weight_dtype': 'default'}},
            '2': {'class_type': 'CLIPLoader', 'inputs': {'clip_name': 'qwen_3_4b.safetensors', 'type': 'flux2', 'device': 'default'}},
            '3': {'class_type': 'VAELoader', 'inputs': {'vae_name': 'flux2-vae.safetensors'}},
            '4': {'class_type': 'CLIPTextEncode', 'inputs': {'text': prompt, 'clip': ['2', 0]}},
            '5': {'class_type': 'EmptyFlux2LatentImage', 'inputs': {'width': W, 'height': H, 'batch_size': 1}},
            '6': {'class_type': 'Flux2Scheduler', 'inputs': {'steps': 4, 'width': W, 'height': H}},
            '7': {'class_type': 'KSamplerSelect', 'inputs': {'sampler_name': 'euler'}},
            '8': {'class_type': 'RandomNoise', 'inputs': {'noise_seed': seed}},
            '9': {'class_type': 'BasicGuider', 'inputs': {'model': ['1', 0], 'conditioning': ['4', 0]}},
            '10': {'class_type': 'SamplerCustomAdvanced', 'inputs': {'noise': ['8', 0], 'guider': ['9', 0], 'sampler': ['7', 0], 'sigmas': ['6', 0], 'latent_image': ['5', 0]}},
            '11': {'class_type': 'VAEDecode', 'inputs': {'samples': ['10', 0], 'vae': ['3', 0]}},
            '12': {'class_type': 'SaveImage', 'inputs': {'images': ['11', 0], 'filename_prefix': 'elotrolado_menu'}},
        }
    else:
        ck = s['comfyCheckpoint'].strip()
        neg = 'text, watermark, logo, blurry, deformed, cartoon, illustration, plastic, oversaturated'
        wf = {
            '1': {'class_type': 'CheckpointLoaderSimple', 'inputs': {'ckpt_name': ck}},
            '2': {'class_type': 'CLIPTextEncode', 'inputs': {'text': prompt, 'clip': ['1', 1]}},
            '3': {'class_type': 'CLIPTextEncode', 'inputs': {'text': neg, 'clip': ['1', 1]}},
            '4': {'class_type': 'EmptyLatentImage', 'inputs': {'width': 768, 'height': 768, 'batch_size': 1}},
            '5': {'class_type': 'KSampler', 'inputs': {'model': ['1', 0], 'positive': ['2', 0], 'negative': ['3', 0], 'latent_image': ['4', 0],
                  'seed': seed, 'steps': 28, 'cfg': 6.5, 'sampler_name': 'dpmpp_2m', 'scheduler': 'karras', 'denoise': 1.0}},
            '6': {'class_type': 'VAEDecode', 'inputs': {'samples': ['5', 0], 'vae': ['1', 2]}},
            '7': {'class_type': 'SaveImage', 'inputs': {'images': ['6', 0], 'filename_prefix': 'elotrolado_menu'}},
        }
    raw, _ = http_json(base + '/prompt', {'prompt': wf, 'client_id': 'elotrolado'}, 30)
    pid = json.loads(raw)['prompt_id']
    t0 = time.time()
    while time.time() - t0 < 900:
        time.sleep(2)
        h = json.loads(urllib.request.urlopen(f'{base}/history/{pid}', timeout=10).read()).get(pid)
        if not h: continue
        st = h.get('status', {})
        if st.get('status_str') == 'error':
            raise RuntimeError('ComfyUI error: ' + json.dumps(st.get('messages', []))[-400:])
        for node in h.get('outputs', {}).values():
            for im in node.get('images', []):
                q = urllib.parse.urlencode({'filename': im['filename'], 'subfolder': im.get('subfolder', ''), 'type': im.get('type', 'output')})
                return urllib.request.urlopen(f'{base}/view?{q}', timeout=30).read()
    raise RuntimeError('ComfyUI timed out after 15 minutes')

def comfy_free(s):
    """Ask ComfyUI to drop its models from VRAM (RX 6800 is shared with Ollama)."""
    if s.get('imageEngine') != 'comfyui': return
    # unload_models only: weights move VRAM -> system RAM and stay cached.
    # (free_memory would also drop the cache and force a 16 GB re-read from the HDD every photo)
    try: http_json(s['comfyUrl'].rstrip('/') + '/free', {'unload_models': True, 'free_memory': False}, 15)
    except Exception: pass

def ollama_keep_alive(s):
    """Unload the model after our call only if WE loaded it.
    If another app already has it loaded (e.g. Open WebUI with a 30m keep-alive), keep its remaining timer."""
    import urllib.request
    from datetime import datetime, timezone
    try:
        ps = json.loads(urllib.request.urlopen(s['ollamaUrl'].rstrip('/') + '/api/ps', timeout=5).read())
        for m in ps.get('models', []):
            if m.get('name') == s['ollamaModel'] or m.get('model') == s['ollamaModel']:
                exp = m.get('expires_at', '')
                exp = datetime.fromisoformat(re.sub(r'(\.\d{6})\d+', r'\1', exp.replace('Z', '+00:00')))
                left = int((exp - datetime.now(timezone.utc)).total_seconds())
                return max(left, 60) if left < 10**8 else -1   # far-future = "keep forever"
    except Exception:
        pass
    return 0   # not loaded by anyone else -> unload right after so ComfyUI gets the GPU

def run_image_job(jid, item, s):
    j = JOBS[jid]
    try:
        j['status'] = 'freeing GPU for Ollama'
        comfy_free(s); time.sleep(1)
        j['status'] = 'writing prompt (Ollama on GPU)'
        ask = ("Write ONE paragraph (max 70 words) describing a photograph of this exact menu item so an image "
               "generator can draw it. Describe only what is physically on the plate: tortilla type, fillings, "
               "toppings, sauces, container (paper taco boat, foil, cup, bottle), and angle. Do not add ingredients "
               "that the description does not imply. No preamble, no quotes.\n\n"
               f"Item: {item.get('name')}\nDescription: {item.get('desc') or 'none'}\n"
               f"Protein options: {', '.join(item.get('_proteins', [])) if item.get('protein') else 'n/a'}")
        raw, _ = http_json(s['ollamaUrl'].rstrip('/') + '/api/generate',
                           {'model': s['ollamaModel'], 'prompt': ask, 'stream': False, 'think': False,
                            'keep_alive': ollama_keep_alive(s),
                            'options': {'temperature': 0.4}}, 180)
        desc = json.loads(raw).get('response', '').strip().strip('"')
        desc = re.sub(r'<think>.*?</think>', '', desc, flags=re.S).strip()
        prompt = f"{desc} Style: {s['photoStyle']}."
        j['prompt'] = prompt; j['status'] = 'rendering image (ComfyUI on GPU)'
        if s.get('imageEngine') == 'comfyui':
            png = comfy_render(s, prompt, j)
        else:
            png, ctype = http_json(s['imageServiceUrl'].rstrip('/') + '/generate', {'prompt': prompt, 'width': 768, 'height': 768}, 900)
            if 'image' not in ctype: raise RuntimeError(png[:300].decode(errors='replace'))
        d = os.path.join(ROOT, 'img', 'menu'); os.makedirs(d, exist_ok=True)
        fn = f"{item['id']}-{int(time.time())}.png"
        with open(os.path.join(d, fn), 'wb') as f: f.write(png)
        j['image'] = f'/img/menu/{fn}'; j['status'] = 'done'
    except Exception as e:
        j['status'] = 'error'; j['error'] = f'{type(e).__name__}: {e}'
    finally:
        comfy_free(s)   # give the GPU back to the rest of the ROCm stack

def path(n): return os.path.join(DATA, n)

def load(n, default):
    try:
        with open(path(n)) as f: return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default

def save(n, obj):
    os.makedirs(DATA, exist_ok=True)
    tmp = path(n) + '.tmp'
    with open(tmp, 'w') as f: json.dump(obj, f, indent=2)
    os.replace(tmp, path(n))

def hash_pw(pw, salt=None):
    salt = salt or secrets.token_hex(16)
    return salt, hashlib.pbkdf2_hmac('sha256', pw.encode(), bytes.fromhex(salt), 200_000).hex()

def init():
    os.makedirs(DATA, exist_ok=True)
    if not os.path.exists(path('settings.json')): save('settings.json', DEFAULT_SETTINGS)
    if not os.path.exists(path('menu.json')):
        seed = os.path.join(ROOT, 'menu.json')
        save('menu.json', load(seed, {"categories": [], "proteins": []}) if os.path.exists(seed) else {"categories": [], "proteins": []})
    if not os.path.exists(path('orders.json')): save('orders.json', [])
    if not os.path.exists(path('admin.json')):
        pw = secrets.token_urlsafe(9)
        s, h = hash_pw(pw)
        save('admin.json', {"salt": s, "hash": h})
        with open(path('INITIAL_ADMIN_PASSWORD.txt'), 'w') as f:
            f.write(pw + '\n')
        os.chmod(path('INITIAL_ADMIN_PASSWORD.txt'), 0o600)
        print('Initial admin password written to data/INITIAL_ADMIN_PASSWORD.txt')

def menu_index(menu):
    return {i['id']: i for c in menu.get('categories', []) for i in c.get('items', []) if not i.get('hidden')}

class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(self, fmt, *a): pass

    # ---------- static-file safety ----------
    PUBLIC_DIRS = ('lib', 'tex', 'img', 'js', 'css')
    PUBLIC_FILES = ('index.html', 'admin.html', 'favicon.ico', 'robots.txt')
    def static_allowed(self):
        """Decide on the DECODED filesystem path (the raw URL can hide '/data' as '/%64ata')."""
        real = os.path.realpath(self.translate_path(self.path))
        rel = os.path.relpath(real, ROOT)
        if rel == '.': return True                     # "/" -> index.html
        if rel.startswith('..') or os.path.isabs(rel): return False
        parts = rel.split(os.sep)
        if any(x.startswith('.') for x in parts): return False
        if len(parts) == 1: return parts[0] in self.PUBLIC_FILES
        return parts[0] in self.PUBLIC_DIRS and not real.endswith('.py')
    def list_directory(self, path):          # no folder listings
        self.send_error(404); return None

    # ---------- helpers ----------
    def ip(self): return self.headers.get('CF-Connecting-IP') or self.client_address[0]
    def send_json(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers(); self.wfile.write(b)
    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n > 200_000: raise ValueError('too large')
        return json.loads(self.rfile.read(n) or b'{}')
    def authed(self):
        t = (self.headers.get('Authorization') or '').removeprefix('Bearer ').strip()
        exp = SESSIONS.get(t)
        if exp and exp > time.time(): return True
        SESSIONS.pop(t, None); return False

    # ---------- routing ----------
    def do_GET(self):
        p = urlparse(self.path).path
        if p.startswith('/data') or p.endswith('.py') or '/.' in p:
            return self.send_error(404)
        if p == '/api/menu':
            m = load('menu.json', {})
            m['categories'] = [{**c, 'items': [i for i in c.get('items', []) if not i.get('hidden')]} for c in m.get('categories', []) if not c.get('hidden')]
            return self.send_json(m)
        if p == '/api/settings':   # public: business info only, never internal service config
            s = {**DEFAULT_SETTINGS, **load('settings.json', {})}
            return self.send_json({k: s.get(k) for k in PUBLIC_SETTINGS})
        if p.startswith('/api/order/'):
            oid = p.rsplit('/', 1)[-1]
            o = next((o for o in load('orders.json', []) if o['id'] == oid), None)
            return self.send_json({'id': oid, 'status': o['status']} if o else {'error': 'not found'}, 200 if o else 404)
        if p.startswith('/api/admin/'):
            if not self.authed(): return self.send_json({'error': 'unauthorized'}, 401)
            if p == '/api/admin/menu': return self.send_json(load('menu.json', {}))
            if p == '/api/admin/settings': return self.send_json({**DEFAULT_SETTINGS, **load('settings.json', {})})
            if p == '/api/admin/orders': return self.send_json(load('orders.json', [])[-300:])
            if p.startswith('/api/admin/genjob/'):
                j = JOBS.get(p.rsplit('/', 1)[-1])
                return self.send_json(j if j else {'error': 'not found'}, 200 if j else 404)
            if p == '/api/admin/comfy-checkpoints':
                s = {**DEFAULT_SETTINGS, **load('settings.json', {})}
                try:
                    import urllib.request
                    info = json.loads(urllib.request.urlopen(s['comfyUrl'].rstrip('/') + '/object_info/CheckpointLoaderSimple', timeout=5).read())
                    return self.send_json(info['CheckpointLoaderSimple']['input']['required']['ckpt_name'][0])
                except Exception: return self.send_json([])
            if p == '/api/admin/imagegen-health':
                s = {**DEFAULT_SETTINGS, **load('settings.json', {})}
                out = {}
                for k, u in (('ollama', s['ollamaUrl'].rstrip('/') + '/api/version'), ('images', s['imageServiceUrl'].rstrip('/') + '/health'),
                             ('comfyui', s['comfyUrl'].rstrip('/') + '/system_stats')):
                    try:
                        import urllib.request
                        out[k] = json.loads(urllib.request.urlopen(u, timeout=4).read())
                    except Exception as e: out[k] = {'error': str(e)}
                return self.send_json(out)
            return self.send_error(404)
        if p == '/admin': self.path = '/admin.html'
        if not self.static_allowed(): return self.send_error(404)
        return super().do_GET()

    def do_HEAD(self):
        if not self.static_allowed(): return self.send_error(404)
        return super().do_HEAD()

    def do_POST(self):
        p = urlparse(self.path).path
        try: data = self.body()
        except Exception: return self.send_json({'error': 'bad request'}, 400)
        if not isinstance(data, dict): return self.send_json({'error': 'bad request'}, 400)

        if p == '/api/order':
            s = {**DEFAULT_SETTINGS, **load('settings.json', {})}
            if not s.get('orderingOpen'): return self.send_json({'error': 'Online ordering is closed right now.'}, 403)
            name = str(data.get('name', '')).strip()[:40]
            phone = re.sub(r'[^\d+()\- ]', '', str(data.get('phone', '')))[:20]
            if not name or len(re.sub(r'\D', '', phone)) < 7:
                return self.send_json({'error': 'Name and a valid phone are required.'}, 400)
            # flood guard: max 6 orders per visitor per 10 minutes
            ip, now = self.ip(), time.time()
            ORDER_HITS[ip] = [t for t in ORDER_HITS.get(ip, []) if now - t < 600]
            if len(ORDER_HITS[ip]) >= 6:
                return self.send_json({'error': 'Too many orders from this device. Please order at the window.'}, 429)
            idx = menu_index(load('menu.json', {}))
            items = data.get('items') if isinstance(data.get('items'), list) else []
            lines, sub_c = [], 0
            for l in items[:50]:
                if not isinstance(l, dict): continue
                it = idx.get(l.get('id'))
                try: q = int(l.get('qty', 0))
                except (TypeError, ValueError): continue
                if not it or not 1 <= q <= 50: continue
                pc = int(round(float(it['price']) * 100))
                line = {'id': it['id'], 'name': it['name'], 'qty': q, 'price': pc / 100}
                if it.get('protein'): line['protein'] = str(l.get('protein', ''))[:30]
                lines.append(line); sub_c += q * pc
            if not lines: return self.send_json({'error': 'Your cart is empty.'}, 400)
            # whole-cents tax, half-up — identical to the formula in index.html
            rate_micro = int(round(float(s.get('taxRate', 0)) * 1_000_000))
            tax_c = (sub_c * rate_micro + 500_000) // 1_000_000
            with LOCK:
                orders = load('orders.json', [])
                num = (orders[-1]['number'] % 999 + 1) if orders else 1
                o = {'id': secrets.token_hex(6), 'number': num, 'ts': int(time.time()), 'name': name, 'phone': phone,
                     'notes': str(data.get('notes', ''))[:200], 'items': lines, 'subtotal': sub_c / 100, 'tax': tax_c / 100,
                     'total': (sub_c + tax_c) / 100, 'status': 'new', 'paid': False}
                ORDER_HITS[ip].append(now)
                orders.append(o); save('orders.json', orders[-2000:])
            return self.send_json({'id': o['id'], 'number': num, 'total': o['total']})

        if p == '/api/admin/login':
            ip = self.ip(); f = FAILS.get(ip, [0, time.time()])
            if f[0] >= 8 and time.time() - f[1] < 900: return self.send_json({'error': 'Too many attempts. Wait 15 minutes.'}, 429)
            a = load('admin.json', {})
            _, h = hash_pw(str(data.get('password', '')), a.get('salt'))
            if a and hmac.compare_digest(h, a.get('hash', '')):
                FAILS.pop(ip, None); t = secrets.token_urlsafe(24); SESSIONS[t] = time.time() + SESSION_TTL
                return self.send_json({'token': t})
            FAILS[ip] = [f[0] + 1 if time.time() - f[1] < 900 else 1, f[1] if time.time() - f[1] < 900 else time.time()]
            return self.send_json({'error': 'Wrong password'}, 401)

        if not p.startswith('/api/admin/'): return self.send_error(404)
        if not self.authed(): return self.send_json({'error': 'unauthorized'}, 401)

        if p == '/api/admin/menu':
            if not isinstance(data.get('categories'), list): return self.send_json({'error': 'bad menu'}, 400)
            for c in data['categories']:
                for i in c.get('items', []):
                    i['price'] = round(float(i.get('price', 0)), 2)
                    i['id'] = re.sub(r'[^a-z0-9_-]', '', str(i.get('id') or secrets.token_hex(3)).lower())[:24] or secrets.token_hex(3)
            with LOCK: save('menu.json', data)
            return self.send_json({'ok': True})
        if p == '/api/admin/settings':
            s = {**DEFAULT_SETTINGS, **load('settings.json', {})}
            for k in DEFAULT_SETTINGS:
                if k in data: s[k] = data[k]
            s['taxRate'] = float(s['taxRate']); s['orderingOpen'] = bool(s['orderingOpen']); s['imageGenEnabled'] = bool(s['imageGenEnabled'])
            if s.get('imageEngine') not in ('comfyui', 'flux-local'): s['imageEngine'] = 'comfyui'
            if s.get('comfyWorkflow', '').strip():
                try: json.loads(s['comfyWorkflow'].replace('%PROMPT%', 'x').replace('%SEED%', '1'))
                except Exception: return self.send_json({'error': 'ComfyUI workflow is not valid JSON (API format).'}, 400)
            for k in ('ollamaUrl', 'imageServiceUrl', 'comfyUrl'):
                if not re.match(r'^https?://(127\.0\.0\.1|localhost)(:\d+)?/?$', str(s[k])): s[k] = DEFAULT_SETTINGS[k]
            with LOCK: save('settings.json', s)
            return self.send_json({'ok': True})
        if p == '/api/admin/order':
            with LOCK:
                orders = load('orders.json', [])
                for o in orders:
                    if o['id'] == data.get('id'):
                        if data.get('status') in ('new', 'cooking', 'ready', 'done', 'cancelled'): o['status'] = data['status']
                        if 'paid' in data: o['paid'] = bool(data['paid'])
                save('orders.json', orders)
            return self.send_json({'ok': True})
        if p == '/api/admin/genimage':
            s = {**DEFAULT_SETTINGS, **load('settings.json', {})}
            if not s.get('imageGenEnabled'): return self.send_json({'error': 'AI photos are turned off in Settings.'}, 403)
            if any(j['status'] not in ('done', 'error') for j in JOBS.values()):
                return self.send_json({'error': 'Another image is still generating — wait for it to finish.'}, 409)
            item = data.get('item') or {}
            if not item.get('name'): return self.send_json({'error': 'Item needs a name first.'}, 400)
            item = {'id': re.sub(r'[^a-z0-9_-]', '', str(item.get('id') or 'item').lower())[:24] or 'item',
                    'name': str(item['name'])[:80], 'desc': str(item.get('desc', ''))[:300], 'protein': bool(item.get('protein')),
                    '_proteins': load('menu.json', {}).get('proteins', [])}
            jid = secrets.token_hex(6)
            JOBS[jid] = {'id': jid, 'status': 'queued', 'item': item['id'], 'ts': int(time.time())}
            threading.Thread(target=run_image_job, args=(jid, item, s), daemon=True).start()
            return self.send_json({'job': jid})
        if p == '/api/admin/password':
            pw = str(data.get('password', ''))
            if len(pw) < 8: return self.send_json({'error': 'Use at least 8 characters.'}, 400)
            s, h = hash_pw(pw); save('admin.json', {'salt': s, 'hash': h})
            try: os.remove(path('INITIAL_ADMIN_PASSWORD.txt'))
            except FileNotFoundError: pass
            return self.send_json({'ok': True})
        if p == '/api/admin/logout':
            SESSIONS.pop((self.headers.get('Authorization') or '').removeprefix('Bearer ').strip(), None)
            return self.send_json({'ok': True})
        return self.send_error(404)

if __name__ == '__main__':
    init()
    print(f'Serving {ROOT} on 127.0.0.1:{PORT}')
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
