#!/usr/bin/env python3
"""El Otro Lado site server: static files + menu/settings/order API + admin API.
Run: python3 server.py  (listens on 127.0.0.1:8095; Cloudflare tunnel fronts it)
"""
import json, os, secrets, hashlib, hmac, time, threading, re, base64
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('FOODTRUCK_DATA') or os.path.join(ROOT, 'data')   # tests point this at a temp dir
PORT = int(os.environ.get('PORT', 8095))
LOCK = threading.Lock()
SESSIONS = {}            # token -> expiry
SESSION_TTL = 12 * 3600
FAILS = {}               # ip -> [count, first_ts]
ORDER_HITS = {}          # ip -> [order timestamps]

# ---------- inbound SMS (Twilio webhook) ----------
# Public URL Twilio is configured to POST to (must match the Messaging Service's
# inboundRequestUrl exactly - Twilio signs the request with this URL).
SMS_INBOUND_PUBLIC_URL = os.environ.get('SMS_INBOUND_PUBLIC_URL',
    'https://food.signaturediversified.com/api/sms/inbound')
# The Twilio auth token lives in the shared sms-gateway's .env (same server, same owner) -
# read it from there rather than keeping a second copy of the secret.
_SMS_GATEWAY_ENV = os.environ.get('SMS_GATEWAY_ENV_PATH',
    '/home/dad/AAAaiderstacks/sms-gateway/.env')

def _twilio_auth_token():
    try:
        with open(_SMS_GATEWAY_ENV) as f:
            for line in f:
                line = line.strip()
                if line.startswith('TWILIO_AUTH_TOKEN='):
                    return line.split('=', 1)[1].strip().strip('"\'')
    except FileNotFoundError:
        pass
    return None

def _twilio_signature_valid(signature, params):
    """Twilio's request-validation algorithm: HMAC-SHA1 over the full URL with
    POST params sorted by name and appended (name+value, no delimiter), base64-encoded."""
    token = _twilio_auth_token()
    if not token or not signature:
        return False
    s = SMS_INBOUND_PUBLIC_URL
    for k in sorted(params.keys()):
        s += k + params[k]
    computed = base64.b64encode(hmac.new(token.encode(), s.encode(), hashlib.sha1).digest()).decode()
    return hmac.compare_digest(computed, signature)

def _xml_escape(s):
    return (s or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


# ---------- order-ready SMS (A2P 10DLC campaign: one message per order) ----------
# Consent is collected ONLY via the optional, unchecked-by-default checkbox at checkout
# (index.html #smsConsent). Consent is not a condition of purchase: orders are accepted
# without it, and the order-ready text is sent only when the box was checked.
# SMS_CONSENT_VERSION is stored with each order so the proof-of-consent record says which
# checkbox wording the customer agreed to. Bump it whenever the checkbox text changes.
SMS_CONSENT_VERSION = '2026-10-20'

def order_ready_sms(o):
    """The one message this campaign sends. Must stay consistent with the sample messages
    registered with Twilio/TCR: brand name + order-ready notice + opt-out instruction.
    Customer-typed order notes are deliberately NOT echoed into the SMS."""
    # Hardcoded on purpose: this must stay byte-identical to sample message #1 registered with
    # Twilio/TCR for campaign QE2c6890da8086d771620e9b13fadeba0b. "(John Switzer)" is the registered
    # Sole Proprietor brand name. Do not build it from the admin-editable businessName setting.
    return (f"El Otro Lado (John Switzer): Order #{o['number']} is ready for pickup at the window! "
            f"Reply STOP to opt out, HELP for help.")

def send_order_ready_sms(o):
    """Queue the order-ready text (via notifyhub -> the owner's iPhone) if this order opted in.
    Returns True if it was successfully QUEUED - that is not the same as delivered, since the
    owner still has to tap "Send via phone". Sets o['smsStatus'] so the admin UI can show and
    poll real status instead of assuming a queued text went out:
      'no_consent' | 'bad_phone' | 'queued' (see o['smsOutboxId']) | 'failed' (see o['smsError'])
    (Loads settings itself: the admin order handlers do not have a settings dict in scope -
    the previous inline code raised NameError on `s` there, silently swallowed by its try/except.)"""
    if not (o.get('smsConsent') or {}).get('agreed'):
        print(f"Order {o['id']} (#{o['number']}): no SMS opt-in - not texting")
        o['smsStatus'] = 'no_consent'
        return False
    if o.get('smsSentTs'):
        print(f"Order {o['id']} (#{o['number']}): order-ready text already sent - not texting again")
        return False
    to = _e164(o.get('phone', ''))
    if not to:
        print(f"Order {o['id']} (#{o['number']}): phone not a valid US number - not texting")
        o['smsStatus'] = 'bad_phone'
        return False
    try:
        out = _notifyhub_send(to, order_ready_sms(o))
        o['smsSentTs'] = int(time.time())   # callers hold LOCK and save orders.json -> exactly one text per order
        o['smsOutboxId'] = out.get('outboxId')
        o['smsStatus'] = 'queued'
        o.pop('smsError', None)
        return True
    except Exception as e:
        print(f"Failed to send SMS for order {o['id']}: {str(e)}")
        o['smsStatus'] = 'failed'
        o['smsError'] = str(e)[:200]
        return False

# ---------- notifyhub client (customer texts go out via the owner's iPhone, not Twilio) ----------
# notifyhub (systemd --user aaservers-notifyhub, 127.0.0.1:8773) expects POST /send with header
# X-Hub-Key and body {to (E.164), text, via}. via="phone" queues the text for the owner's iPhone
# Shortcut ("Hub Send") to actually send from his own number - it never falls through to Fi or
# Twilio. See /home/dad/aaservers/notifyhub/README.md. The key lives in ~/.secrets/notifyhub.key
# (or env NOTIFYHUB_KEY).
NOTIFYHUB_URL = os.environ.get('NOTIFYHUB_URL', 'http://127.0.0.1:8773')

def _notifyhub_key():
    k = os.environ.get('NOTIFYHUB_KEY', '').strip()
    if k:
        return k
    try:
        with open(os.path.expanduser('~/.secrets/notifyhub.key')) as f:
            return f.read().strip()
    except FileNotFoundError:
        return ''

def _notifyhub_send(to, message):
    """POST /send via=phone. notifyhub's response has no structured id field, just
    info: "queued for your phone (<id>)" - pull the id out of that so we can later check
    /sms for whether it's still sitting in the outbox (not sent) or gone (sent)."""
    import urllib.request
    payload = {'to': to, 'text': message, 'via': 'phone'}
    r = urllib.request.Request(NOTIFYHUB_URL.rstrip('/') + '/send', data=json.dumps(payload).encode(),
                               headers={'Content-Type': 'application/json', 'X-Hub-Key': _notifyhub_key()})
    with urllib.request.urlopen(r, timeout=15) as resp:
        out = json.loads(resp.read().decode() or '{}')
    if not out.get('ok'):
        raise RuntimeError(out.get('info') or 'notifyhub refused the send')
    m = re.search(r'\(([0-9a-f]{6,32})\)', out.get('info') or '')
    out['outboxId'] = m.group(1) if m else None
    return out

def _notifyhub_outbox():
    """Current notifyhub iPhone outbox snapshot: [{id, to, text, ts}, ...]. An order's
    smsOutboxId missing from this list means the Shortcut has sent it (or it expired)."""
    import urllib.request
    r = urllib.request.Request(NOTIFYHUB_URL.rstrip('/') + '/sms',
                               headers={'X-Hub-Key': _notifyhub_key()})
    with urllib.request.urlopen(r, timeout=10) as resp:
        return json.loads(resp.read().decode() or '{}').get('outbox', [])

# ---------- sms-gateway client (Twilio - kept for other projects / fallback, NOT used by foodtruck) ----------
# sms-gateway (pm2 `sms-gateway`, 127.0.0.1:4010) expects POST /send with header X-Gateway-Key
# and body {project, to (E.164), message[, idempotency_key]}; the key lives in
# ~/.secrets/sms-gateway.key (or env SMS_GATEWAY_KEY). See AAAaiderstacks/sms-gateway/CONVENTIONS.md.
SMS_GATEWAY_URL = os.environ.get('SMS_GATEWAY_URL', 'http://127.0.0.1:4010')

def _gateway_key():
    k = os.environ.get('SMS_GATEWAY_KEY', '').strip()
    if k:
        return k
    try:
        with open(os.path.expanduser('~/.secrets/sms-gateway.key')) as f:
            return f.read().strip()
    except FileNotFoundError:
        return ''

def _e164(phone):
    """US-only normalisation: '4805551234' / '(480) 555-1234' / '+14805551234' -> '+14805551234'."""
    d = re.sub(r'\D', '', str(phone or ''))
    if len(d) == 10:
        return '+1' + d
    if len(d) == 11 and d.startswith('1'):
        return '+' + d
    return None

def _gateway_send(to, message, idempotency_key=None):
    import urllib.request
    payload = {'project': 'foodtruck', 'to': to, 'message': message}
    if idempotency_key:
        payload['idempotency_key'] = idempotency_key
    r = urllib.request.Request(SMS_GATEWAY_URL.rstrip('/') + '/send', data=json.dumps(payload).encode(),
                               headers={'Content-Type': 'application/json', 'X-Gateway-Key': _gateway_key()})
    with urllib.request.urlopen(r, timeout=15) as resp:
        return json.loads(resp.read().decode() or '{}')

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

    def handle_sms_inbound(self):
        """Twilio inbound-SMS webhook (Messaging Service inboundRequestUrl). Validates the
        signature and replies with empty TwiML - there is no keyword opt-in on this number."""
        n = int(self.headers.get('Content-Length') or 0)
        if n > 20_000:
            self.send_response(400); self.end_headers(); return
        raw = self.rfile.read(n)
        params = {k: v[0] for k, v in parse_qs(raw.decode('utf-8', 'replace')).items()}
        if not _twilio_signature_valid(self.headers.get('X-Twilio-Signature', ''), params):
            self.send_response(403); self.end_headers(); return
        # No keyword opt-in: the checkout checkbox is the ONLY opt-in method registered with TCR, so every
        # inbound text gets an empty TwiML response. STOP/START/HELP are handled by Twilio itself.
        twiml = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
        b = twiml.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/xml')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers(); self.wfile.write(b)

    # ---------- routing ----------
    def do_GET(self):
        p = urlparse(self.path).path
        if p.startswith('/data') or p.endswith('.py') or '/.' in p:
            return self.send_error(404)
        if p == '/api/menu':
            m = load('menu.json', {})
            for k in ('taxNote', 'priceSource'): m.pop(k, None)   # internal notes, not for the public site
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
            if p.startswith('/api/admin/order/'):
                o = next((o for o in load('orders.json', []) if o['id'] == p.rsplit('/', 1)[-1]), None)
                return self.send_json(o if o else {'error': 'not found'}, 200 if o else 404)
            if p.startswith('/api/admin/genjob/'):
                j = JOBS.get(p.rsplit('/', 1)[-1])
                return self.send_json(j if j else {'error': 'not found'}, 200 if j else 404)
            if p == '/api/admin/sms/outbox':
                # Lets admin.html tell "queued" from "actually sent": an order's smsOutboxId
                # missing from this list means the owner's phone Shortcut has sent it.
                try: return self.send_json({'outbox': _notifyhub_outbox()})
                except Exception as e: return self.send_json({'outbox': [], 'error': str(e)}, 200)
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
        # Real paths for the ordering panel / SMS opt-in (index.html's deep-link script reads the pathname):
        # reviewers and link tools often drop URL fragments, so /order must work without '#'.
        if p in ('/order', '/checkout', '/sms-optin', '/menu'): self.path = '/index.html'
        if not self.static_allowed(): return self.send_error(404)
        return super().do_GET()

    def do_HEAD(self):
        if not self.static_allowed(): return self.send_error(404)
        return super().do_HEAD()

    def do_POST(self):
        p = urlparse(self.path).path

        if p == '/api/sms/inbound':
            return self.handle_sms_inbound()

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
            # SMS opt-in is OPTIONAL (consent is not a condition of purchase). Record the
            # customer's choice; the order-ready text is only sent if they checked the box.
            sms_consent = bool(data.get('smsConsent'))
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
                     'total': (sub_c + tax_c) / 100, 'status': 'new', 'paid': False,
                     'smsConsent': {'agreed': sms_consent, 'ts': int(time.time()), 'ip': ip,
                                    'method': 'web-checkout-checkbox', 'version': SMS_CONSENT_VERSION}}
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
            sms = None
            with LOCK:
                orders = load('orders.json', [])
                for o in orders:
                    if o['id'] == data.get('id'):
                        if data.get('status') in ('new', 'cooking', 'ready', 'done', 'cancelled'):
                            o['status'] = data['status']
                            if data['status'] == 'ready':
                                send_order_ready_sms(o)   # only texts customers who opted in; sets o['smsStatus']
                                sms = {'status': o.get('smsStatus'), 'outboxId': o.get('smsOutboxId'), 'error': o.get('smsError')}
                        if 'paid' in data: o['paid'] = bool(data['paid'])
                save('orders.json', orders)
            return self.send_json({'ok': True, 'sms': sms})
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
            pass
            # Add new endpoint for order completion SMS
        if p == '/api/admin/order-ready':
            with LOCK:
                orders = load('orders.json', [])
                for o in orders:
                    if o['id'] == data.get('id'):
                        if o['status'] == 'ready':
                            send_order_ready_sms(o)   # only texts customers who opted in, once
                save('orders.json', orders)
            SESSIONS.pop((self.headers.get('Authorization') or '').removeprefix('Bearer ').strip(), None)
            return self.send_json({'ok': True})
        if p == '/api/admin/sms/send':
            # Admin "send SMS" button (admin.html). Reached only through the /api/admin/ gate above, so it
            # is authenticated. (The old '/api/sms/send' path sat below that gate and always 404'd.)
            if 'to' not in data or 'message' not in data:
                return self.send_json({'error': 'Missing required fields'}, 400)
            to = _e164(data['to'])
            if not to:
                return self.send_json({'error': 'Invalid phone number'}, 400)
            try:
                _notifyhub_send(to, str(data['message'])[:1600])
                return self.send_json({'ok': True})
            except Exception as e:
                return self.send_json({'error': str(e)}, 500)
            
        return self.send_error(404)

if __name__ == '__main__':
    init()
    print(f'Serving {ROOT} on 127.0.0.1:{PORT}')
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
