#!/usr/bin/env python3
"""El Otro Lado site server: static files + menu/settings/order API + admin API.
Run: python3 server.py  (listens on 127.0.0.1:8095; Cloudflare tunnel fronts it)
"""
import json, os, secrets, hashlib, hmac, time, threading, re, base64
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('FOODTRUCK_DATA') or os.path.join(ROOT, 'data')   # tests point this at a temp dir
MEDIA = os.path.join(ROOT, 'media')   # admin-uploaded truck boombox music / TV monitor video (static, served publicly)
PORT = int(os.environ.get('PORT', 8095))
LOCK = threading.Lock()
SESSIONS = {}            # token -> expiry
SESSION_TTL = 12 * 3600
FAILS = {}               # ip -> [count, first_ts]
ORDER_HITS = {}          # ip -> [order timestamps]

# ---------- live presence (MMORPG-style avatars of other visitors) ----------
# In-memory only - a visitor's avatar disappearing on a server restart is fine, it's a
# cosmetic "who's browsing right now" layer, not durable data.
PRESENCE = {}             # visitor id -> {ts, hue, order_until, menu_until, profile}
PRESENCE_LOCK = threading.Lock()
PRESENCE_TTL = 20         # seconds of no heartbeat before a visitor is considered gone
ORDER_GLOW_TTL = 25       # seconds an avatar shows its "just ordered" state
CAPS = ('', 'ball', 'cowboy', 'beret', 'cone')   # whitelisted avatar hat styles

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
    msg = "El Otro Lado (John Switzer): Order #" + str(o['number']) + " is ready for pickup at the window! Reply STOP to opt out, HELP for help."
    return str(msg)  # Ensure plain text, no rich text formatting

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
    "brandLogo": "",          # filename under media/, set by /api/admin/upload-media kind=image
    "copyrightLine": "",      # footer notice; empty keeps the standard Sole Proprietor wording
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
                  "natural daylight, shallow depth of field, close-up, appetizing, no text, no logos",
    # --- ComfyUI sampling / quality ---
    "comfySamplingSteps": 25,
    "comfyGuidanceScale": 7.5,
    "comfySampler": "euler",
    "comfyScheduler": "karras",
    # --- ComfyUI image control ---
    "comfyWidth": 512,
    "comfyHeight": 512,
    "comfyDenoise": 1.0,
    "comfySeed": "random",
    # --- ComfyUI performance ---
    "comfyBatchSize": 1,
    "comfyMemoryOptimization": "",       # "" = none, "sequential", "smart", "aggressive"
    "comfyPrecision": "fp32",            # "fp32", "fp16", "fp8"
    # --- whole-site password gate (separate from the admin login) ---
    "siteGateEnabled": True,
    # --- live avatars / chat (unmoderated public chat - off switch for abuse) ---
    "avatarChatEnabled": True,
    # --- AI order-taking chat assistant ---
    "aiAssistantEnabled": True,
    "aiAssistantModel": "qwen3:1.7b",
    # --- 3D scene: truck position, set by dragging it in layout mode (see scene.js) ---
    "truckOffsetX": 0.0,
    "truckOffsetZ": 0.0,
    "truckRotation": 0.0,   # degrees
    # --- 3D scene: truck boombox music + TV monitor video, uploaded by the admin ---
    "bgMusicEnabled": False,
    "bgMusicFile": "",       # filename under media/, set by /api/admin/upload-media
    "tvEnabled": False,
    "tvVideoFile": "",       # filename under media/, set by /api/admin/upload-media
}

PUBLIC_SETTINGS = ('businessName', 'tagline', 'brandLogo', 'copyrightLine', 'phone', 'email', 'social', 'location', 'hours',
                   'taxRate', 'orderingOpen', 'orderNote', 'avatarChatEnabled', 'aiAssistantEnabled',
                   'truckOffsetX', 'truckOffsetZ', 'truckRotation',
                   'bgMusicEnabled', 'bgMusicFile', 'tvEnabled', 'tvVideoFile')

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
    seed_s = str(s.get('comfySeed', 'random') or 'random').strip()
    seed = int(seed_s) if seed_s.lstrip('-').isdigit() else secrets.randbelow(2**31)
    W = max(256, int(s.get('comfyWidth', 768) or 768) // 16 * 16)
    H = max(256, int(s.get('comfyHeight', 768) or 768) // 16 * 16)
    steps = max(1, int(s.get('comfySamplingSteps', 4) or 4))
    batch = max(1, int(s.get('comfyBatchSize', 1) or 1))
    if s.get('comfyWorkflow', '').strip():
        wf = json.loads(s['comfyWorkflow'].replace('%PROMPT%', json.dumps(prompt)[1:-1]).replace('%SEED%', str(seed)))
    elif not (s.get('comfyCheckpoint') or '').strip():
        # Built-in: FLUX.2 klein 4B (distilled: 4 steps, no CFG — guidance scale is ignored here)
        wf = {
            '1': {'class_type': 'UNETLoader', 'inputs': {'unet_name': 'flux-2-klein-4b.safetensors', 'weight_dtype': 'default'}},
            '2': {'class_type': 'CLIPLoader', 'inputs': {'clip_name': 'qwen_3_4b.safetensors', 'type': 'flux2', 'device': 'default'}},
            '3': {'class_type': 'VAELoader', 'inputs': {'vae_name': 'flux2-vae.safetensors'}},
            '4': {'class_type': 'CLIPTextEncode', 'inputs': {'text': prompt, 'clip': ['2', 0]}},
            '5': {'class_type': 'EmptyFlux2LatentImage', 'inputs': {'width': W, 'height': H, 'batch_size': batch}},
            '6': {'class_type': 'Flux2Scheduler', 'inputs': {'steps': steps, 'width': W, 'height': H}},
            '7': {'class_type': 'KSamplerSelect', 'inputs': {'sampler_name': s.get('comfySampler', 'euler') or 'euler'}},
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
            '4': {'class_type': 'EmptyLatentImage', 'inputs': {'width': W, 'height': H, 'batch_size': batch}},
            '5': {'class_type': 'KSampler', 'inputs': {'model': ['1', 0], 'positive': ['2', 0], 'negative': ['3', 0], 'latent_image': ['4', 0],
                  'seed': seed, 'steps': steps, 'cfg': float(s.get('comfyGuidanceScale', 6.5) or 1.0),
                  'sampler_name': s.get('comfySampler', 'dpmpp_2m') or 'dpmpp_2m', 'scheduler': s.get('comfyScheduler', 'karras') or 'karras',
                  'denoise': float(s.get('comfyDenoise', 1.0) or 1.0)}},
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

# ---------- persistent characters + live chat (same visitor id as PRESENCE above) ----------
# Names persist to disk (characters.json) since a visitor picking "Gus" should still be "Gus"
# next week. Chat is memory-only and capped - it's a live "who's at the lot" layer, not a
# permanent message log, which also limits how much an abusive message can stick around.
CHARACTERS = load('characters.json', {})          # id -> {"name": str}
CHAT = []                                          # [{id, name, hue, text, ts}], newest last
CHAT_LOCK = threading.Lock()
CHAT_RATE = {}                                     # id -> last post ts
CHAT_MAX = 50
NAME_RE = re.compile(r'[^\w \-\'.]', re.UNICODE)

def character_hue(vid): return int(hashlib.sha1(vid.encode()).hexdigest(), 16) % 360
def character_name(vid, hue):
    nm = (CHARACTERS.get(vid) or {}).get('name')
    return nm if nm else f'Guest{hue}'

def hash_pw(pw, salt=None):
    salt = salt or secrets.token_hex(16)
    return salt, hashlib.pbkdf2_hmac('sha256', pw.encode(), bytes.fromhex(salt), 200_000).hex()

def site_password_ok(pw):
    """Whole-site HTTP Basic Auth gate - separate from the admin login. Lets the owner keep the
    site off the open internet while it's still test data / in development, without blocking
    the Twilio webhook (see site_gated below, which exempts /api/sms/inbound)."""
    a = load('site_auth.json', None)
    if not a: return True   # not provisioned yet (shouldn't happen after init()) - fail open, not locked out
    _, h = hash_pw(pw or '', a.get('salt'))
    return hmac.compare_digest(h, a.get('hash', ''))

def init():
    os.makedirs(DATA, exist_ok=True)
    os.makedirs(MEDIA, exist_ok=True)
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
    if not os.path.exists(path('site_auth.json')):
        pw = secrets.token_urlsafe(9)
        s, h = hash_pw(pw)
        save('site_auth.json', {"salt": s, "hash": h})
        with open(path('SITE_PASSWORD.txt'), 'w') as f:
            f.write(pw + '\n')
        os.chmod(path('SITE_PASSWORD.txt'), 0o600)
        print('Site password written to data/SITE_PASSWORD.txt')

def menu_index(menu):
    return {i['id']: i for c in menu.get('categories', []) for i in c.get('items', []) if not i.get('hidden')}

class OrderError(Exception):
    def __init__(self, msg, code=400): super().__init__(msg); self.code = code

def create_order(s, name, phone, notes, items, sms_consent, ip, method):
    """Shared by the checkout form (/api/order) and the AI chat assistant (/api/assistant)'s
    place_order tool, so a chat-placed order is validated and priced exactly like a form one -
    the AI never invents prices or item names, it only picks real menu ids this function checks."""
    if not s.get('orderingOpen'): raise OrderError('Online ordering is closed right now.', 403)
    name = str(name or '').strip()[:40]
    phone = re.sub(r'[^\d+()\- ]', '', str(phone or ''))[:20]
    if not name or len(re.sub(r'\D', '', phone)) < 7:
        raise OrderError('Name and a valid phone are required.', 400)
    now = time.time()
    ORDER_HITS[ip] = [t for t in ORDER_HITS.get(ip, []) if now - t < 600]
    if len(ORDER_HITS[ip]) >= 6:
        raise OrderError('Too many orders from this device. Please order at the window.', 429)
    idx = menu_index(load('menu.json', {}))
    lines, sub_c = [], 0
    for l in (items or [])[:50]:
        if not isinstance(l, dict): continue
        it = idx.get(l.get('id'))
        try: q = int(l.get('qty', 0))
        except (TypeError, ValueError): continue
        if not it or not 1 <= q <= 50: continue
        pc = int(round(float(it['price']) * 100))
        line = {'id': it['id'], 'name': it['name'], 'qty': q, 'price': pc / 100}
        if it.get('protein'): line['protein'] = str(l.get('protein', ''))[:30]
        lines.append(line); sub_c += q * pc
    if not lines: raise OrderError('Your cart is empty.', 400)
    rate_micro = int(round(float(s.get('taxRate', 0)) * 1_000_000))
    tax_c = (sub_c * rate_micro + 500_000) // 1_000_000
    with LOCK:
        orders = load('orders.json', [])
        num = (orders[-1]['number'] % 999 + 1) if orders else 1
        o = {'id': secrets.token_hex(6), 'number': num, 'ts': int(time.time()), 'name': name, 'phone': phone,
             'notes': str(notes or '')[:200], 'items': lines, 'subtotal': sub_c / 100, 'tax': tax_c / 100,
             'total': (sub_c + tax_c) / 100, 'status': 'new', 'paid': False,
             'smsConsent': {'agreed': bool(sms_consent), 'ts': int(time.time()), 'ip': ip,
                            'method': method, 'version': SMS_CONSENT_VERSION}}
        ORDER_HITS[ip].append(now)
        orders.append(o); save('orders.json', orders[-2000:])
    return o

# ---------- AI order-taking chat assistant (local Ollama, tool-calling) ----------
# One conversation per visitor id (same id the presence/chat system uses), in memory only.
# The model NEVER invents menu items or prices - every add_item call is checked against the
# real menu.json by assistant_add_item() below, same as a human clicking "+" on the site.
ASSISTANT_SESSIONS = {}    # visitor id -> {messages:[...], cart:[...], name, phone, ts}
ASSISTANT_LOCK = threading.Lock()
ASSISTANT_RATE = {}        # visitor id -> last request ts
ASSISTANT_SEM = threading.Semaphore(1)   # serialize model calls - one shared GPU with ComfyUI
ASSISTANT_TTL = 1800       # drop idle sessions after 30 min
ASSISTANT_MAX_TURNS = 20   # trim history so context/cost can't grow unbounded

ASSISTANT_TOOLS = [
    {'type': 'function', 'function': {'name': 'add_item', 'description': 'Add a menu item to the order by its exact name.',
        'parameters': {'type': 'object', 'properties': {
            'name': {'type': 'string', 'description': 'exact menu item name'},
            'qty': {'type': 'integer', 'description': 'how many, default 1'},
            'protein': {'type': 'string', 'description': 'protein choice, only if the item needs one'}},
            'required': ['name']}}},
    {'type': 'function', 'function': {'name': 'remove_item', 'description': 'Remove a menu item the customer no longer wants.',
        'parameters': {'type': 'object', 'properties': {'name': {'type': 'string'}}, 'required': ['name']}}},
    {'type': 'function', 'function': {'name': 'view_cart', 'description': "Get the customer's current cart and total so far.",
        'parameters': {'type': 'object', 'properties': {}}}},
    {'type': 'function', 'function': {'name': 'set_contact', 'description': 'Save the name and phone number for the order (required before placing it).',
        'parameters': {'type': 'object', 'properties': {'name': {'type': 'string'}, 'phone': {'type': 'string'}}, 'required': ['name', 'phone']}}},
    {'type': 'function', 'function': {'name': 'place_order', 'description': 'Submit the order for real once the customer has confirmed their cart and given their name and phone.',
        'parameters': {'type': 'object', 'properties': {'notes': {'type': 'string', 'description': 'special requests, e.g. no onions'}}}}},
]

def _assistant_menu_text(menu):
    out = []
    for c in menu.get('categories', []):
        if c.get('hidden'): continue
        for i in c.get('items', []):
            if i.get('hidden') or i.get('soldOut'): continue
            bits = f"{i['name']} - ${float(i['price']):.2f}"
            if i.get('desc'): bits += f" ({i['desc']})"
            if i.get('protein'): bits += ' [customer must pick a protein]'
            out.append(bits)
    return '\n'.join(out) or '(menu is empty right now)'

def _assistant_find_item(menu, name):
    name = (name or '').strip().lower()
    items = [i for c in menu.get('categories', []) for i in c.get('items', []) if not i.get('hidden') and not i.get('soldOut')]
    exact = [i for i in items if i['name'].strip().lower() == name]
    if exact: return exact[0], []
    partial = [i for i in items if name in i['name'].strip().lower() or i['name'].strip().lower() in name]
    if len(partial) == 1: return partial[0], []
    return None, partial

def assistant_session(vid):
    with ASSISTANT_LOCK:
        now = time.time()
        for k in [k for k, v in ASSISTANT_SESSIONS.items() if now - v['ts'] > ASSISTANT_TTL]: ASSISTANT_SESSIONS.pop(k, None)
        sess = ASSISTANT_SESSIONS.get(vid)
        if not sess:
            if len(ASSISTANT_SESSIONS) > 300: raise OrderError('Assistant is busy, try again shortly.', 503)
            sess = ASSISTANT_SESSIONS[vid] = {'messages': [], 'cart': [], 'name': None, 'phone': None, 'ts': now}
        sess['ts'] = now
        return sess

def run_assistant_tool(sess, menu, s, ip, name, args):
    if name == 'add_item':
        it, candidates = _assistant_find_item(menu, args.get('name', ''))
        if not it:
            if candidates: return {'error': f"Not sure which one - did they mean: {', '.join(c['name'] for c in candidates[:5])}?"}
            return {'error': f"\"{args.get('name','')}\" isn't on the menu. Here's what is:\n{_assistant_menu_text(menu)}"}
        qty = max(1, min(50, int(args.get('qty', 1) or 1)))
        line = {'id': it['id'], 'name': it['name'], 'qty': qty, 'price': float(it['price'])}
        if it.get('protein'): line['protein'] = str(args.get('protein', '') or '')[:30]
        sess['cart'].append(line)
        return {'ok': True, 'cart': sess['cart']}
    if name == 'remove_item':
        nm = (args.get('name') or '').strip().lower()
        before = len(sess['cart'])
        sess['cart'] = [l for l in sess['cart'] if nm not in l['name'].lower()]
        return {'removed': before - len(sess['cart']), 'cart': sess['cart']}
    if name == 'view_cart':
        return {'cart': sess['cart'], 'name': sess['name'], 'phone': sess['phone']}
    if name == 'set_contact':
        sess['name'] = str(args.get('name', ''))[:40]; sess['phone'] = str(args.get('phone', ''))[:20]
        return {'ok': True, 'name': sess['name'], 'phone': sess['phone']}
    if name == 'place_order':
        try:
            items = [{'id': l['id'], 'qty': l['qty'], 'protein': l.get('protein', '')} for l in sess['cart']]
            # chat orders never carry SMS consent - the registered opt-in is the checkout
            # page's explicit, unchecked-by-default checkbox, which a chat message can't be.
            o = create_order(s, sess['name'], sess['phone'], args.get('notes'), items, False, ip, 'ai-chat-assistant')
            sess['cart'] = []
            return {'ok': True, 'orderNumber': o['number'], 'total': o['total'], 'orderId': o['id']}
        except OrderError as e:
            return {'error': str(e)}
    return {'error': f'unknown tool {name}'}

def assistant_reply(s, vid, user_text, ip):
    if not s.get('aiAssistantEnabled', True): raise OrderError('The chat assistant is turned off right now.', 403)
    now = time.time()
    with ASSISTANT_LOCK:
        if now - ASSISTANT_RATE.get(vid, 0) < 2.5: raise OrderError('Slow down a bit.', 429)
        ASSISTANT_RATE[vid] = now
    sess = assistant_session(vid)
    menu = load('menu.json', {})
    sys_prompt = (
        f"You are the friendly order-taking assistant for {s.get('businessName','this food truck')} "
        f"({s.get('tagline','')}), a food truck in {s.get('location') or 'Mesa, AZ'}. Hours: {s.get('hours') or 'see the site'}.\n"
        f"Menu:\n{_assistant_menu_text(menu)}\n\n"
        "Only ever add items from this exact menu via the add_item tool - never invent items or prices. "
        "If something isn't on the menu, say so and suggest what is. Keep replies short and conversational. "
        "Before calling place_order you must have at least one item in the cart and have called set_contact "
        "with the customer's name and phone, and you should read the cart and total back to them for confirmation first. "
        "Do not call place_order until the customer has clearly confirmed. "
        "You cannot sign anyone up for text alerts - if asked, tell them to check the box at checkout on the site instead."
    )
    sess['messages'].append({'role': 'user', 'content': user_text[:400]})
    sess['messages'] = sess['messages'][-ASSISTANT_MAX_TURNS:]
    messages = [{'role': 'system', 'content': sys_prompt}] + sess['messages']

    with ASSISTANT_SEM:
        for _ in range(4):   # bounded tool-call loop
            raw, _ = http_json(s['ollamaUrl'].rstrip('/') + '/api/chat', {
                'model': s.get('aiAssistantModel') or 'qwen3:1.7b', 'stream': False,
                'messages': messages, 'tools': ASSISTANT_TOOLS}, 45)
            resp = json.loads(raw).get('message', {})
            tool_calls = resp.get('tool_calls') or []
            messages.append({'role': 'assistant', 'content': resp.get('content', ''), 'tool_calls': tool_calls})
            if not tool_calls:
                reply = resp.get('content', '').strip() or "Sorry, could you say that again?"
                sess['messages'].append({'role': 'assistant', 'content': reply})
                return {'reply': reply, 'cart': sess['cart'], 'name': sess['name'], 'phone': sess['phone']}
            for tc in tool_calls:
                fn = tc.get('function', {})
                result = run_assistant_tool(sess, menu, s, ip, fn.get('name'), fn.get('arguments') or {})
                messages.append({'role': 'tool', 'content': json.dumps(result)})
    sess['messages'].append({'role': 'assistant', 'content': "Sorry, I'm having trouble right now - try the menu above, or order at the window."})
    return {'reply': sess['messages'][-1]['content'], 'cart': sess['cart'], 'name': sess['name'], 'phone': sess['phone']}

class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(self, fmt, *a): pass

    # ---------- static-file safety ----------
    PUBLIC_DIRS = ('lib', 'tex', 'img', 'js', 'css', 'media')
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
    def body_large(self, max_bytes):
        """Like body(), but with a caller-chosen cap - for the media-upload route, whose JSON
        payload is mostly a base64-encoded file and so is much bigger than the normal 200KB cap."""
        n = int(self.headers.get('Content-Length') or 0)
        if n > max_bytes: raise ValueError('too large')
        return json.loads(self.rfile.read(n) or b'{}')
    def authed(self):
        t = (self.headers.get('Authorization') or '').removeprefix('Bearer ').strip()
        exp = SESSIONS.get(t)
        if exp and exp > time.time(): return True
        SESSIONS.pop(t, None); return False
    def site_gated(self, p):
        """True (and already responded 401) if the whole-site password gate is on and this
        request didn't present it. Twilio's webhook can't send a password, so it's exempt."""
        if p == '/api/sms/inbound': return False
        s = {**DEFAULT_SETTINGS, **load('settings.json', {})}
        if not s.get('siteGateEnabled'): return False
        auth = self.headers.get('Authorization', '')
        if auth.startswith('Basic '):
            try:
                _, _, pw = base64.b64decode(auth[6:].strip()).decode('utf-8', 'replace').partition(':')
                if site_password_ok(pw): return False
            except Exception: pass
        body = b'Password required.'
        self.send_response(401)
        self.send_header('WWW-Authenticate', 'Basic realm="El Otro Lado - private preview"')
        self.send_header('Content-Type', 'text/plain')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers(); self.wfile.write(body)
        return True

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

    def handle_upload_media(self):
        """Admin-only upload for the truck's boombox music / TV monitor video / header brand logo (see scene.js).
        Body is JSON {kind:'audio'|'video'|'image', filename, data:<base64>} - there's no multipart
        parser anywhere else in this server, so this matches the rest of the API: JSON in,
        JSON out. Caps are generous but bounded so one upload can't fill the disk."""
        LIMITS = {'audio': 20_000_000, 'video': 60_000_000, 'image': 3_000_000}   # decoded-file byte caps
        EXT_OK = {'audio': ('.mp3', '.m4a', '.ogg', '.wav'), 'video': ('.mp4', '.webm', '.mov'),
                  'image': ('.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif')}
        try:
            data = self.body_large(90_000_000)   # base64 is ~33% bigger than the decoded file, plus JSON overhead
        except Exception:
            return self.send_json({'error': 'Upload too large or malformed.'}, 400)
        if not isinstance(data, dict): return self.send_json({'error': 'bad request'}, 400)
        kind = data.get('kind')
        if kind not in LIMITS: return self.send_json({'error': "kind must be 'audio' or 'video'"}, 400)
        name = str(data.get('filename') or '')
        ext = os.path.splitext(name)[1].lower()
        if ext not in EXT_OK[kind]:
            return self.send_json({'error': f'{kind} files must be one of: {", ".join(EXT_OK[kind])}'}, 400)
        b64 = data.get('data') or ''
        try:
            raw = base64.b64decode(b64.split(',', 1)[-1], validate=False)   # tolerate a data: URL prefix
        except Exception:
            return self.send_json({'error': 'file data is not valid base64'}, 400)
        if not raw or len(raw) > LIMITS[kind]:
            mb = LIMITS[kind] // 1_000_000
            return self.send_json({'error': f'{kind} file must be under {mb}MB'}, 400)
        fname = f"{kind}-{secrets.token_hex(6)}{ext}"
        os.makedirs(MEDIA, exist_ok=True)
        with open(os.path.join(MEDIA, fname), 'wb') as f:
            f.write(raw)
        key = {'audio': 'bgMusicFile', 'video': 'tvVideoFile', 'image': 'brandLogo'}[kind]
        with LOCK:
            s = {**DEFAULT_SETTINGS, **load('settings.json', {})}
            old = s.get(key) or ''
            s[key] = fname
            save('settings.json', s)
        if old:   # best-effort cleanup of the previous file for this slot
            try: os.remove(os.path.join(MEDIA, old))
            except Exception: pass
        return self.send_json({'ok': True, 'file': fname})

    # ---------- routing ----------
    def do_GET(self):
        p = urlparse(self.path).path
        if self.site_gated(p): return
        if p.startswith('/data') or p.endswith('.py') or '/.' in p:
            return self.send_error(404)
        if p == '/api/presence':
            qs = parse_qs(urlparse(self.path).query)
            myid = (qs.get('id') or [''])[0][:64]
            try: since = float((qs.get('since') or ['0'])[0])
            except ValueError: since = 0
            now = time.time()
            with PRESENCE_LOCK:
                for k in [k for k, v in PRESENCE.items() if now - v['ts'] > PRESENCE_TTL]: PRESENCE.pop(k, None)
                others = [{'id': k, 'hue': v['hue'], 'name': character_name(k, v['hue']),
                           'status': ('ordering' if v.get('order_until', 0) > now else
                                      'menu' if v.get('menu_until', 0) > now else 'browsing'),
                           'profile': v.get('profile') or {}}
                          for k, v in PRESENCE.items() if k != myid]
            with CHAT_LOCK:
                chat = [m for m in CHAT if m['ts'] > since]
            return self.send_json({'others': others, 'chat': chat, 'now': now})
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
            if p == '/api/admin/chat':
                # Moderation/audit log for the live site chat - it's unmoderated in real time,
                # so this is the only after-the-fact way to see what visitors have been saying.
                with CHAT_LOCK: return self.send_json({'messages': list(CHAT)})
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
        if self.site_gated(urlparse(self.path).path): return
        if not self.static_allowed(): return self.send_error(404)
        return super().do_HEAD()

    def do_POST(self):
        p = urlparse(self.path).path

        if p == '/api/sms/inbound':
            return self.handle_sms_inbound()
        if self.site_gated(p): return

        if p == '/api/admin/upload-media':   # handled separately: needs a much bigger body cap than every other route
            if not self.authed(): return self.send_json({'error': 'unauthorized'}, 401)
            return self.handle_upload_media()

        try: data = self.body()
        except Exception: return self.send_json({'error': 'bad request'}, 400)
        if not isinstance(data, dict): return self.send_json({'error': 'bad request'}, 400)

        if p == '/api/presence':
            myid = re.sub(r'[^a-zA-Z0-9_-]', '', str(data.get('id', '')))[:64]
            if not myid: return self.send_json({'error': 'bad id'}, 400)
            now = time.time()
            with PRESENCE_LOCK:
                if len(PRESENCE) > 500 and myid not in PRESENCE:   # hard cap so a bad actor can't balloon memory
                    return self.send_json({'ok': False}, 503)
                e = PRESENCE.get(myid)
                if not e: e = PRESENCE[myid] = {'hue': character_hue(myid), 'order_until': 0}
                e['ts'] = now
                if data.get('ordered'): e['order_until'] = now + ORDER_GLOW_TTL
                if data.get('menu'): e['menu_until'] = now + 25   # browsing the menu = in line at the truck
                else: e['menu_until'] = 0
                prf = data.get('profile')
                if isinstance(prf, dict):
                    prof = {}
                    try: prof['hue'] = max(0, min(359, int(prf.get('hue', e.get('profile', {}).get('hue', 0)))))
                    except (TypeError, ValueError): pass
                    try: prof['sk'] = max(0, min(5, int(prf.get('sk', e.get('profile', {}).get('sk', 0)))))
                    except (TypeError, ValueError): pass
                    if prf.get('cap') in CAPS: prof['cap'] = prf.get('cap')
                    if prof: e['profile'] = prof
                    elif 'profile' in e: e.pop('profile')   # emptied = back to the random character look
            name = NAME_RE.sub('', str(data.get('name', ''))).strip()[:24]
            if name and (CHARACTERS.get(myid) or {}).get('name') != name:
                # only hits disk when a visitor actually sets/changes a name, not on every heartbeat
                with LOCK:
                    CHARACTERS[myid] = {'name': name}
                    save('characters.json', CHARACTERS)
            return self.send_json({'ok': True, 'name': character_name(myid, PRESENCE[myid]['hue'])})

        if p == '/api/chat':
            s = {**DEFAULT_SETTINGS, **load('settings.json', {})}
            if not s.get('avatarChatEnabled', True): return self.send_json({'error': 'Chat is turned off right now.'}, 403)
            myid = re.sub(r'[^a-zA-Z0-9_-]', '', str(data.get('id', '')))[:64]
            text = re.sub(r'[\x00-\x1f\x7f]', '', str(data.get('text', ''))).strip()[:140]
            if not myid or not text: return self.send_json({'error': 'bad request'}, 400)
            now = time.time()
            with CHAT_LOCK:
                if now - CHAT_RATE.get(myid, 0) < 3: return self.send_json({'error': 'Slow down a bit.'}, 429)
                CHAT_RATE[myid] = now
                hue = PRESENCE.get(myid, {}).get('hue', character_hue(myid))
                msg = {'id': myid, 'name': character_name(myid, hue), 'hue': hue, 'text': text, 'ts': now}
                CHAT.append(msg)
                del CHAT[:-CHAT_MAX]
            with PRESENCE_LOCK:   # a chat message is also a heartbeat - no need to wait for the next ping
                e = PRESENCE.get(myid)
                if e: e['ts'] = now
            return self.send_json({'ok': True})

        if p == '/api/assistant':
            s = {**DEFAULT_SETTINGS, **load('settings.json', {})}
            myid = re.sub(r'[^a-zA-Z0-9_-]', '', str(data.get('id', '')))[:64]
            text = re.sub(r'[\x00-\x1f\x7f]', '', str(data.get('text', ''))).strip()[:400]
            if not myid or not text: return self.send_json({'error': 'bad request'}, 400)
            try:
                result = assistant_reply(s, myid, text, self.ip())
            except OrderError as e:
                return self.send_json({'error': str(e)}, e.code)
            return self.send_json(result)

        if p == '/api/order':
            s = {**DEFAULT_SETTINGS, **load('settings.json', {})}
            try:
                o = create_order(s, data.get('name'), data.get('phone'), data.get('notes'),
                                  data.get('items'), bool(data.get('smsConsent')), self.ip(), 'web-checkout-checkbox')
            except OrderError as e:
                return self.send_json({'error': str(e)}, e.code)
            return self.send_json({'id': o['id'], 'number': o['number'], 'total': o['total']})

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
