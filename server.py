#!/usr/bin/env python3
"""El Otro Lado site server: static files + menu/settings/order API + admin API.
Run: python3 server.py  (listens on 127.0.0.1:8095; Cloudflare tunnel fronts it)
"""
import random, json, os, secrets, hashlib, hmac, time, threading, re, base64, zipfile, io, shutil, subprocess
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, urlencode
import urllib.request, urllib.error

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('FOODTRUCK_DATA') or os.path.join(ROOT, 'data')   # tests point this at a temp dir
MEDIA = os.path.join(ROOT, 'media')   # admin-uploaded truck boombox music / TV monitor video (static, served publicly)
MOBILE_HOSTS = tuple(h.strip().lower() for h in os.environ.get('FOODTRUCK_MOBILE_HOSTS', 'mfood.signaturediversified.com').split(',') if h.strip())
MAGICK = shutil.which('magick') or shutil.which('convert')   # ImageMagick 7/6 for the photo downsizer; optional (without it photos are served as uploaded)
THUMB_PX = 192   # menu photos show at 56 css px; 192 stays sharp on 3x phone screens
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
FACES = ('', 'smile', 'neutral', 'surprised', 'wink', 'grumpy')   # whitelisted avatar face expressions

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

def _sms_env(key, default=''):
    """Any TWILIO_* var from the shared sms-gateway .env — one source of truth for the secrets."""
    try:
        with open(_SMS_GATEWAY_ENV) as f:
            for line in f:
                line = line.strip()
                if line.startswith(key + '='):
                    return line.split('=', 1)[1].strip().strip('"\'')
    except FileNotFoundError:
        pass
    return default

def _twilio_creds(s):
    """(sid, token, from_number) with precedence: process env → shared .env → admin settings."""
    sid = os.environ.get('TWILIO_ACCOUNT_SID', '').strip() or _sms_env('TWILIO_ACCOUNT_SID') or str(s.get('twilioSid') or '').strip()
    token = os.environ.get('TWILIO_AUTH_TOKEN', '').strip() or _twilio_auth_token() or str(s.get('twilioToken') or '').strip()
    frm = os.environ.get('TWILIO_FROM_NUMBER', '').strip() or _sms_env('TWILIO_FROM_NUMBER') or str(s.get('twilioFrom') or '').strip()
    svc = str(s.get('twilioServiceSid') or '').strip()
    return sid, token, frm, svc

def _twilio_send(to, message, s=None):
    """DIRECT Twilio send — the newly approved account. Returns {'sid', 'status'}; raises with a
    readable message so send_order_ready_sms / admin can show why nothing was queued."""
    import urllib.request, urllib.parse, base64
    s = s or {**DEFAULT_SETTINGS, **load('settings.json', {})}
    sid, token, frm, svc = _twilio_creds(s)
    if not (sid and token):
        raise RuntimeError('Twilio is not configured — need account SID + auth token')
    data = {'To': to, 'Body': str(message)[:1600]}
    if svc:
        data['MessagingServiceSid'] = svc
    elif frm:
        data['From'] = frm
    else:
        raise RuntimeError('Twilio is not configured — need twilioFrom (sender number) configured')
    req = urllib.request.Request(f'https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json',
        data=urllib.parse.urlencode(data).encode(),
        headers={'Authorization': 'Basic ' + base64.b64encode(f'{sid}:{token}'.encode()).decode()})
    with urllib.request.urlopen(req, timeout=15) as resp:
        out = json.loads(resp.read().decode() or '{}')
    if out.get('status') in ('failed', 'undelivered') or not out.get('sid'):
        raise RuntimeError(out.get('message') or 'Twilio refused the send')
    return {'sid': out['sid'], 'status': out.get('status', 'queued')}

def _sms_send(to, message, idempotency_key=None):
    """Outbound dispatcher. settings.smsGateway picks the carrier:
      'twilio'   (default, newly approved direct REST account),
      'notifyhub'(previous owner-iPhone Shortcut relay),
      'gateway'  (legacy sms-gateway pm2 service).
    COMPLIANCE: every outbound path funnels through here, and recipients who texted STOP
    (data/sms-optouts.json, self-managed because the number has no Messaging Service) are
    refused - the refusal is a dict, not an exception, so callers can log it their way."""
    s = {**DEFAULT_SETTINGS, **load('settings.json', {})}
    if _sms_is_opted_out(to):
        return {'ok': False, 'error': 'opted-out', 'sid': None}
    gw = (s.get('smsGateway') or 'twilio').strip().lower()
    if gw == 'twilio': return _twilio_send(to, message, s)
    if gw == 'gateway': return _gateway_send(to, message, idempotency_key)
    return _notifyhub_send(to, message)

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
    # Hardcoded on purpose: this must stay byte-identical to the sample message registered with
    # Twilio/TCR for campaign QE2c6890da8086d771620e9b13fadeba0b. "(Summer and Jesse)" is the brand
    # name (owner rebrand - the TCR campaign sample was updated to match so carriers see the same
    # sender identity). Do not build it from the admin-editable businessName setting.
    msg = "El Otro Lado (Summer and Jesse): Order #" + str(o['number']) + " is ready for pickup at the window! Reply STOP to opt out, HELP for help."
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
    if _sms_is_opted_out(to):
        print(f"Order {o['id']} (#{o['number']}): customer texted STOP - not texting")
        o['smsStatus'] = 'opted_out'
        return False
    try:
        out = _sms_send(to, order_ready_sms(o))      # carrier picked by settings.smsGateway (twilio now)
        o['smsSentTs'] = int(time.time())   # callers hold LOCK and save orders.json -> exactly one text per order
        o['smsOutboxId'] = out.get('outboxId') or out.get('sid')   # notifyhub outbox id OR Twilio message sid
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
    # --- SMS carrier (outbound texts: order-ready + admin broadcasts) ---
    # 'gateway' pins POST /send → project 'foodtruck' → PROJECT_FROM in the shared .env, which IS
    # the TCR-registered 10DLC number (+12525469420) this campaign must text from. ('twilio' badge
    # would inherit TWILIO_FROM_NUMBER=+18557854152 from that same .env — NOT this campaign's sender.)
    "smsGateway": "gateway",
    "twilioSid": "",          # optional; normally inherited from the shared sms-gateway .env
    "twilioFrom": "",         # sender number; normally inherited from TWILIO_FROM_NUMBER in that .env
    "twilioServiceSid": "",   # optional messaging-service sid (overrides From when set)
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
    # --- Games (Admin → Settings → Games): the 🎪 Midway arcade, each of its six minigames,
    # the 🌭 hot dog contest and the 🤖 trivia bot can all be switched off individually.
    # midwayOn is the master switch (props + panel + HIGH SCORES board); a per-game flag hides
    # that game's prop, tab and score row; triviaBotOn stops new questions immediately (banked
    # points and collections always stay). Everything defaults on ---
    "midwayOn": True,
    "gameClawOn": True, "gameBbtOn": True, "gameTagOn": True,
    "gameC4On": True, "gameTttOn": True, "gamePinOn": True,
    "gamePacmanOn": True,      # 🟡 the Pac-Man arcade cabinet on the lot
"gameUnoOn": True,         # 🃏 the UNO card table on the lot
"gameChessOn": True,        # ♟️ the crystal chess table on the lot
    "hotdogOn": True,
    "waterparkOn": True,         # 🌊 Sir Splash-a-Lot Water Park on the west side (off = "closed for repairs" placeholder)
    "waterparkClosedMsg": "",    # custom "closed" sign line (blank = rotating puns)
    "ambientLifeOn": True,       # 🚶 crowd members who eat, queue, play and wander (off = static crowd only)
    "questsOn": True,            # ❗ pun quests / flash sales / flash dances
    "crowdAmount": 1.0,          # 🎪 static scene-crowd multiplier (0 = empty lot, 1 = default, 2 = double)
    "actorsAmount": 1.0,         # 🚶 ambient AI cast multiplier — walkers/eaters/players (0 = none)
    "interactAmount": 1.0,       # 👋 how often the AI greets/interacts with the player (0 = never)
    "clutterAmount": 1.0,        # 🥤 litter + clutter spawn multiplier (0 = nothing new drops)
    # --- 3D environment / performance (Admin → Environment tab; most values apply on page reload) ---
    "sceneSmokePuffs": 24,       # fog-machine puffs drifting behind the band (0 = no stage smoke)
    "scenePipeSmokers": 35,      # % of the crowd holding a pipe (0 = nobody smokes)
    "scenePipePuffs": 3,         # puffs per smoker, staggered (0 = pipes but no puff clouds)
    "sceneFallMult": 1.0,        # falling confetti / leaves / snow particle multiplier (0 = off)
    "sceneFloatMult": 1.0,       # floating lanterns / balloons multiplier (0 = off)
    "sceneRandomness": 1.0,      # scatter + pose randomness (0 = neat parade rows, 2 = wild lot)
    "sceneCrowdRange": 0,        # meters the static crowd is drawn within; 0 = auto (16 phone / 40 desktop)
    "sceneLifeRange": 0,         # meters the ambient AI cast is alive/reacting within; 0 = auto (22 / 48)
    "sceneClutterNear": 0,       # meters of detailed clutter; 0 = auto (9 phone / 16 desktop)
    "sceneClutterMid": 0,        # meters of simple clutter; 0 = auto (20 / 38), nothing beyond
    "sceneGenCar": False,       # 🚗 ComfyUI-generated lowrider body (models/impala.*). Off by default: the generated
                                # colour still bakes in the reference photo's highlights, so its material split is rough
                                # (see ROADMAP). Flip it on in Admin -> Environment to look at the generated mesh.
    "sceneTextures": True,      # 🖼️ ComfyUI photo textures on the lot (gfx/, tools/gfx_gen.py); off = flat colours, ~2.5 MB less to download
    "sceneShadows": "",          # "", off, 1024, 2048, 4096 (blank = auto: 2048 phone / 4096 desktop)
    "scenePixelRatio": 0,        # fixed renderer pixel ratio; 0 = auto (1.5 phone / 2 desktop)
    "sceneAntialias": True,      # antialiasing on (off = faster on weak GPUs)
    "triviaBotOn": True,
    # --- 3D scene: truck position, set by dragging it in layout mode (see scene.js) ---
    "truckOffsetX": 0.0,
    "truckOffsetZ": 0.0,
    "truckRotation": 0.0,   # degrees
    # --- 3D scene: truck boombox music + TV monitor video, uploaded by the admin ---
    "bgMusicEnabled": False,
    "bgMusicFile": "",       # filename under media/, set by /api/admin/upload-media
    "tvEnabled": False,
    "tvVideoFile": "",       # filename under media/, set by /api/admin/upload-media
    # --- 🎵 jukebox: visitors spend arcade POINTS to play a song for the WHOLE lot (songs are
    # admin-uploaded via upload-media kind=song; rows: {file,title,cost}; each paid play runs
    # jukeboxPlaySecs then the next queued song takes over - state in data/jukebox.json) ---
    "jukeboxOn": True,
    "jukeboxSongs": [],      # [{file,title,cost}]
    "jukeboxPlaySecs": 150,
    # --- 🗺️ geocaching: visitors hide caches on the lot — optionally stashing one of THEIR
    # collectibles inside — and hunt each other's for points + the prize (Settings → Games) ---
    "geocacheOn": True,
    # --- #layout mode's "Save as default": {moverId:{x,z,r}} for the movable lot props
    # (jukebox, claw machine, bean-bag boards, tag arena, HIGH SCORES board, Impala, tables) ---
    "layoutProps": {},
    # --- admin text alerts (visitor problems reported through the chat assistant) ---
    "adminPhone": "",        # E.164 number that gets problem reports texted to it immediately
    "adminSmsAlerts": True,  # off switch for those texts (reports still show in admin)
    "driverPhone": "",       # E.164; customer "DRIVER" texts relay here (see handle_sms_inbound)
    # --- Payments: what the checkout offers; secrets below NEVER leave the server
    # (PUBLIC_SETTINGS only exposes the on/off flags + the public handles) ---
    "payStripe": False,      # card via Stripe Checkout (needs stripeSecret configured below)
    "payCashapp": True,      # manual: customer sends to cashappTag, admin confirms paid
    "payZelle": True,        # manual: customer sends to zelleContact, admin confirms paid
    "payCash": True,         # at the window
    "cashappTag": "",        # e.g. "$ElOtroLado"
    "zelleContact": "",      # phone or email on the Zelle account
    "stripeSecret": "",      # sk_test_... / sk_live_... (admin pastes it; server-only)
    "stripeWebhookSecret": "",   # whsec_... for /api/stripe/webhook signature checks
    # --- Promotions: 'special' rows auto-apply (item at priceCents, optionally only on
    # certain weekdays dow 0=Mon..6=Sun, inside starts/ends dates); 'code' rows are typed at
    # checkout (pctOff or offCents). Row: {id,kind,name,itemId,code,dow,priceCents,pctOff,
    # offCents,starts,ends,active} ---
    "promos": [],
    # --- Rewards: points per $1 on every order (rewardsOn), redeemable for rewardItems
    # {id,name,points,offCents} chosen at checkout; balances ride the phone accounts ---
    "rewardsOn": True,
    "pointsPerDollar": 10,
    "rewardItems": [],
    # --- Marketing: homepage promo banner + social ad campaign bookkeeping (spend lands in
    # the EOM report next to gross sales so ROI is one glance) ---
    "bannerText": "",        # e.g. "Taco Tuesday: Street Tacos $4!" - blank hides the strip
    "bannerLink": "",        # optional target when the banner is tapped
    "marketingCampaigns": [],   # {id,name,platform,budget,spend,starts,ends,notes,active}
    # --- Delivery & grocery partners: public "find us on" links + ops settings per platform
    # (guides for signing up live in the admin Marketing tab) ---
    "partnerGrubhubOn": False,   "partnerGrubhubLink": "",   "partnerGrubhubCommission": 0.20, "partnerGrubhubNote": "",
    "partnerUberOn": False,      "partnerUberLink": "",      "partnerUberCommission": 0.20,    "partnerUberNote": "",
    "partnerDoorDashOn": False,  "partnerDoorDashLink": "", "partnerDoorDashCommission": 0.20, "partnerDoorDashNote": "",
    "partnerInstacartOn": False, "partnerInstacartLink": "", "partnerInstacartCommission": 0.25, "partnerInstacartNote": "",
}

PUBLIC_SETTINGS = ('businessName', 'tagline', 'brandLogo', 'copyrightLine', 'phone', 'email', 'social', 'location', 'hours',
                   'taxRate', 'orderingOpen', 'orderNote', 'avatarChatEnabled', 'aiAssistantEnabled',
                   'truckOffsetX', 'truckOffsetZ', 'truckRotation',
                   'bgMusicEnabled', 'bgMusicFile', 'tvEnabled', 'tvVideoFile',
                   # payments + promos + rewards are public-facing: the checkout needs them
                   # (flags + handles only - never stripeSecret / stripeWebhookSecret)
                   'payStripe', 'payCashapp', 'payZelle', 'payCash', 'cashappTag', 'zelleContact',
                   'rewardsOn', 'pointsPerDollar', 'rewardItems',
                   # marketing banner + delivery partner links (public "find us on" row)
                   'bannerText', 'bannerLink',
                   'partnerGrubhubOn', 'partnerGrubhubLink', 'partnerUberOn', 'partnerUberLink',
                   'partnerDoorDashOn', 'partnerDoorDashLink', 'partnerInstacartOn', 'partnerInstacartLink',
                   # games on/off switches — the 3D lot, the contest and the chat trivia gate on these
                   'midwayOn', 'gameClawOn', 'gameBbtOn', 'gameTagOn', 'gameC4On', 'gameTttOn', 'gamePinOn',
                   'gamePacmanOn', 'gameUnoOn', 'gameChessOn',
                   'hotdogOn', 'triviaBotOn', 'waterparkOn', 'waterparkClosedMsg', 'ambientLifeOn', 'questsOn',
                   'crowdAmount', 'actorsAmount', 'interactAmount', 'clutterAmount',
                   'sceneSmokePuffs', 'scenePipeSmokers', 'scenePipePuffs', 'sceneFallMult', 'sceneFloatMult',
                   'sceneRandomness', 'sceneCrowdRange', 'sceneLifeRange', 'sceneClutterNear', 'sceneClutterMid',
                   'sceneShadows', 'scenePixelRatio', 'sceneAntialias', 'sceneTextures', 'sceneGenCar',
                   # jukebox (public: catalog + on/off) + geocaching switch + saved #layout defaults for the lot props
                   'jukeboxOn', 'jukeboxSongs', 'geocacheOn', 'layoutProps')

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

# ---------- photo downsizing (ImageMagick, optional) ----------
# The generator writes 768px PNGs (~800KB each) and the ordering panel shows them at 56px, so a
# phone used to pull ~10MB of photos for one menu. Each photo gets a square JPEG thumbnail next
# to it (<stem>.t192.jpg) and the public /api/menu points at that. Originals stay for admin.
def thumb_path(src): return os.path.splitext(src)[0] + f'.t{THUMB_PX}.jpg'
def is_thumb(name): return name.endswith(f'.t{THUMB_PX}.jpg')

_CODERS = {'.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp'}
_MAGIC = {'png': lambda h: h[:8] == b'\x89PNG\r\n\x1a\n', 'jpeg': lambda h: h[:3] == b'\xff\xd8\xff', 'webp': lambda h: h[:4] == b'RIFF' and h[8:12] == b'WEBP'}
THUMB_STATE = {'failed': {}, 'busy': set()}   # src -> mtime of a failed conversion (tried once, not per request); photos being converted now
THUMB_LOCK = threading.Lock()

def _coder(path):
    """ImageMagick decoder for this file, from its extension AND its magic bytes (never let IM sniff SVG/PS/MVG)."""
    c = _CODERS.get(os.path.splitext(path)[1].lower())
    try:
        with open(path, 'rb') as f: head = f.read(16)
    except OSError: return None
    return c if c and _MAGIC[c](head) else None

def _magick(src, ops, out):
    """Convert src -> out through a hidden temp file (static_allowed() refuses dotfiles) and move it into place only on success."""
    c = _coder(src)
    if not MAGICK or not c: return False
    tmp = os.path.join(os.path.dirname(out), f'.{os.path.basename(out)}.{secrets.token_hex(4)}.tmp')
    try:
        subprocess.run([MAGICK, '-limit', 'memory', '256MiB', '-limit', 'map', '512MiB', '-limit', 'time', '20', f'{c}:{src}[0]', *ops,
                        f'{_CODERS.get(os.path.splitext(out)[1].lower(), "jpeg")}:{tmp}'], check=True, capture_output=True, timeout=30)
        os.replace(tmp, out); return True
    except Exception:
        try: os.remove(tmp)
        except OSError: pass
        return False

def _fresh(dst, src):
    try: return os.path.getmtime(dst) >= os.path.getmtime(src)
    except OSError: return False

def make_thumb(src):
    """Thumbnail for one menu photo (idempotent by mtime; a photo that fails is retried only after it changes). Returns its path or None."""
    if not MAGICK or is_thumb(src) or not os.path.isfile(src): return None
    dst = thumb_path(src)
    if _fresh(dst, src): return dst
    mt = os.path.getmtime(src)
    with THUMB_LOCK:
        if THUMB_STATE['failed'].get(src) == mt or src in THUMB_STATE['busy']: return None
        THUMB_STATE['busy'].add(src)
    try:
        ok = _magick(src, ['-auto-orient', '-thumbnail', f'{THUMB_PX}x{THUMB_PX}^', '-gravity', 'center', '-extent', f'{THUMB_PX}x{THUMB_PX}', '-strip', '-quality', '82'], dst)
    finally:
        with THUMB_LOCK:
            THUMB_STATE['busy'].discard(src)
            if not _fresh(dst, src): THUMB_STATE['failed'][src] = mt
    return dst if ok else None

def shrink_image(path, px):
    """Downsize an uploaded image in place to fit px×px (never enlarges; keeps its format and transparency)."""
    _magick(path, ['-auto-orient', '-resize', f'{px}x{px}>', '-strip'], path)

def public_image(url):
    """What the public menu shows for a photo: its thumbnail when one is ready, else the photo itself
    (a missing thumbnail is built in the background - ImageMagick never runs inside a public request)."""
    if not isinstance(url, str) or not url.startswith('/img/menu/'): return url
    name = url[len('/img/menu/'):]
    if not name or '/' in name or name.startswith('.') or is_thumb(name) or not MAGICK: return url
    src = os.path.join(ROOT, 'img', 'menu', name); dst = thumb_path(src)
    if _fresh(dst, src): return f'/img/menu/{os.path.basename(dst)}'
    if os.path.isfile(src) and src not in THUMB_STATE['busy']:
        threading.Thread(target=make_thumb, args=(src,), daemon=True).start()
    return url

def prewarm_thumbs():
    """Startup pass over img/menu: build every missing thumbnail and sweep temp files an earlier stop left behind."""
    d = os.path.join(ROOT, 'img', 'menu')
    try: names = sorted(os.listdir(d))
    except OSError: return
    for n in names:
        p = os.path.join(d, n)
        if n.endswith('.tmp') and n.startswith('.'):
            try:
                if time.time() - os.path.getmtime(p) > 60: os.remove(p)
            except OSError: pass
        elif n.lower().endswith(tuple(_CODERS)) and not is_thumb(n): make_thumb(p)

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
        make_thumb(os.path.join(d, fn))
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
ACCOUNTS_LOCK = threading.RLock()                   # accounts.json is a small flat file; exclusive rewrites only

# ---------- trivia bot 🤖 (Mesa / Arizona Q&A race → arcade POINTS redeemable for collectibles) ----------
# data/trivia.json: [{q, a:[keywords], cat}]. A question goes into shared chat and stays scoring for
# TRIVIA_OPEN_S seconds: first correct chat post banks 5 pts, second 3, third 2, everyone else who
# lands a keyword in the window banks 1. Chat POSTs carry the visitor's arcade phone (from their
# sign-in) so points land in their flat-file account; unsigned guests are congratulated once and
# pointed at 🏬 sign-in (banking drives sign-ups). One award per user per question. 20s later the
# answer is revealed; a few seconds pause then the next question. Points redeem in the profile.
TRIVIA_OPEN_S, TRIVIA_GAP_S = 20, 7                 # scoring window per question / pause between
TRIVIA_PLACE_PTS = {1: 5, 2: 3, 3: 2}               # 1st/2nd/3rd… everyone else gets the floor
TRIVIA_FLOOR_PTS = 1
STOPWORDS = {'with', 'your', 'from', 'this', 'that', 'their', 'them', 'which', 'where', 'have', 'has', 'will', 'into', 'more', 'than', 'then', 'over', 'under', 'just', 'like', 'also', 'only', 'some', 'plus', 'choice', 'choices'}

def _norm(s):                                        # keyword/text normalizer (answers are graded on this)
    s = str(s or '').lower()
    s = re.sub(r'[^a-z0-9 ]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()

# ---------- profanity screen 🧼 ----------
# Festival chat, display names and scoreboard entries are family-facing. Each token is matched on a
# leet-collapsed copy ('sh1t', '$h!t', 'coÑo' all trip) and masked as same-length asterisks — the post
# still lands, sanitized. Word-boundary aware, so 'class', 'hello', 'cocktail', 'assess' sail through.
_PROFANE = {'fuck', 'fuk', 'fck', 'shit', 'bitch', 'btch', 'cunt', 'dick', 'ass', 'asshole', 'bastard',
            'whore', 'slut', 'hoe', 'retard', 'porn', 'nude', 'nudes', 'sex', 'boobs', 'tits', 'penis',
            'vagina', 'dildo', 'anal', 'horny', 'jizz', 'cum', 'chinga', 'chingar', 'pendejo', 'verga',
            'cono', 'cabron', 'puto', 'puta', 'culo', 'cojones'}
_PROF_PREFIX = {'fuck', 'fuk', 'fck', 'shit', 'bitch', 'cunt', 'nigg', 'fagg', 'rape', 'pend'}
_LEET = str.maketrans({'1': 'i', '3': 'e', '4': 'a', '5': 's', '0': 'o', '7': 't', '@': 'a', '$': 's',
                       '!': 'i', '*': 'u', '#': 'h', 'ñ': 'n', 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u'})
def _dirty(tok):
    t = re.sub(r'[^a-z]', '', str(tok).lower().translate(_LEET))
    if not t: return False
    if t in _PROFANE or (t.endswith('s') and t[:-1] in _PROFANE): return True
    return any(t.startswith(p) for p in _PROF_PREFIX)
def _clean(text):
    toks = str(text or '').split(' ')
    return ' '.join('*' * max(3, len(t)) if _dirty(t) else t for t in toks)

def _menu_trivia_rows():
    """🌮 Generated from the LIVE menú (data/menu.json) so prices and ingredients never drift from
    what the truck actually sells. Per item: a price question, an ingredient question, a menú-section
    question, and — for protein items — an add-on question. All keywords pre-normalized."""
    rows = []
    m = load('menu.json', {})
    protein_kw = []
    for p in (m.get('proteins') or []):
        ns = _norm(p).split()
        if ns:
            protein_kw.append(' '.join(ns))
            protein_kw.append(ns[0])
    protein_kw = list(dict.fromkeys(protein_kw))
    for c in m.get('categories', []):
        cat = str(c.get('name') or '').strip()
        cat_kw = [_norm(cat)] if cat else []
        for it in c.get('items', []):
            nm = str(it.get('name') or '').strip()
            if not nm: continue
            price = it.get('price')
            try: pv = float(price)
            except (TypeError, ValueError): pv = None
            if pv and pv > 0:
                kws = {_norm('%g' % pv), _norm('%.2f' % pv), _norm('%d' % int(pv))}
                kws.discard('')
                rows.append({'q': 'Menú check — what does the ' + nm + ' cost (in dollars)?',
                             'a': sorted(kws), 'cat': 'Menú'})
            desc = str(it.get('desc') or it.get('description') or '')
            ing = [w for w in _norm(desc).split() if len(w) >= 4 and w not in STOPWORDS]
            ing = list(dict.fromkeys(ing))
            if len(ing) >= 2:
                rows.append({'q': nm + ' — name ANY ONE ingredient straight off its menú description!',
                             'a': ing, 'cat': 'Menú'})
            if protein_kw and it.get('protein'):
                rows.append({'q': 'Which add-on protein can go inside the ' + nm + '? (name any one)',
                             'a': protein_kw, 'cat': 'Menú'})
            if cat_kw:
                rows.append({'q': 'Which menú section is home to the ' + nm + '?', 'a': cat_kw, 'cat': 'Menú'})
    return rows

def _world_rows():
    """🎡 Questions about the LOT ITSELF — every answer is a fixed truth of this build (tables,
    games, economy), verifiable by walking around. Not per-session randomness (crowd shirts vary
    on every screen, so those can't be graded fairly)."""
    R = [
        ('How many picnic tables ring the truck for diners?', ['14']),
        ('How many bean-bag toss boards stand on the west lawn?', ['2']),
        ('How many grabs does one claw-machine game give you?', ['3']),
        ('How many mini prizes sit visible in the claw window?', ['6']),
        ('How many good hits break the piñata?', ['5']),
        ('In the tag arena, how many tags on the runner win the game?', ['3']),
        ('How many COLUMNS does the Connect Four board have?', ['7']),
        ('And how many ROWS does Connect Four run?', ['6']),
        ('Tic-tac-toe has how many squares?', ['9']),
        ('How many seconds does the trivia race stay open?', ['20']),
        ('First correct trivia answer banks how many points?', ['5']),
        ('Second place in the trivia race banks…?', ['3']),
        ('Third place banks…?', ['2']),
        ('Everyone else who answers right in time banks…?', ['1']),
        ('The cheapest collectible in the 🏬 shop costs how many points?', ['40']),
        ('The 🏆 trivia champion cup costs how many points?', ['200']),
        ('How many lowriders can you flip switch-banks on in the lot?', ['1']),
        ('How many stages does the festival run (the big one counts!)?', ['1']),
        ('What plays the tunes by the tables — a jukebox, a boombox, or a DJ booth?', ['jukebox']),
        ('What color is the flag flying at the tag arena?', ['red']),
        ('Which side of the truck takes your order — the serving window side or the mural side?', ['window', 'serving']),
        ('Finish the script on the truck tail — "see you on the ___ side"', ['other']),
        ('The festival crowd gathers on which side of the big stage — the stage front or behind it?', ['front']),
    ]
    return [{'q': q, 'a': a, 'cat': 'World'} for q, a in R]

def _weave(pools):
    """Round-robin the question pools so hand-written Mesa/AZ, World facts and Menú questions
    alternate steadily instead of arriving in big blocks hours apart."""
    pools = [list(p) for p in pools]
    out = []
    while any(pools):
        for p in pools:
            if p: out.append(p.pop(0))
    return out

TRIVIA_STATIC = load('trivia.json', [])              # hand-written Mesa/AZ rows (86)
TRIVIA = _weave([TRIVIA_STATIC, _world_rows(), _menu_trivia_rows()])
SHOP_ITEMS = [                                       # redeem catalog: item id, display label, point cost
    {'item': 'mini-agua-fresca-plush', 'label': '🍡 Mini agua fresca plush', 'cost': 40},
    {'item': 'elote-keychain', 'label': '🌽 Elote keychain', 'cost': 50},
    {'item': 'mini-saguaro-plush', 'label': '🌵 Mini saguaro plush', 'cost': 60},
    {'item': 'tiny-taco-plush', 'label': '🌮 Tiny taco plush', 'cost': 60},
    {'item': 'festival-pinata-charm', 'label': '🪅 Festival piñata charm', 'cost': 80},
    {'item': 'mesa-arrowhead-pin', 'label': '🪶 Mesa arrowhead pin', 'cost': 80},
    {'item': 'adobe-casita-charm', 'label': '🏠 Adobe casita charm', 'cost': 90},
    {'item': 'midway-balloon', 'label': '🎪 Midway balloon', 'cost': 100},
    {'item': 'fossil-replica', 'label': '🦖 Fossil replica', 'cost': 120},
    {'item': 'trivia-champion-cup', 'label': '🏆 Trivia champion cup', 'cost': 200},
    # --- 🌱 festival sprouts: highly detailed plant collectibles you can GIFT to other visitors
    # by clipping them onto their avatar (collar, shoes, hat, chest, shoulder). Redeeming one
    # puts it in your collection; gifting transfers it server-side to the recipient's avatar.
    {'item': 'sprout-tiny', 'label': '🌱 Tiny Sprout (clip to collar)', 'cost': 40, 'sprout': True, 'slot': 'collar'},
    {'item': 'sprout-clover', 'label': '🌿 Lucky Clover (clip to shoe)', 'cost': 60, 'sprout': True, 'slot': 'shoeL'},
    {'item': 'sprout-blossom', 'label': '🌸 Blossom Clip (clip to hat)', 'cost': 80, 'sprout': True, 'slot': 'hat'},
    {'item': 'sprout-charm', 'label': '🍀 Four-Leaf Charm (clip to chest)', 'cost': 100, 'sprout': True, 'slot': 'chest'},
    {'item': 'sprout-sunflower', 'label': '🌻 Sunflower Pin (clip to shoulder)', 'cost': 120, 'sprout': True, 'slot': 'shoulderL'},
]
def _load_bling():
    try:
        with open(os.path.join(ROOT, 'bling', 'catalog.json'), encoding='utf-8') as f: return json.load(f)
    except (OSError, ValueError): return {'items': [], 'themes': {}}
BLING = _load_bling()                                # bling/catalog.json: id, label, theme, slot, cost - the client reads the same file
BLING_SLOTS = ('hat', 'collar', 'chest', 'shoulderL', 'shoulderR', 'shoeL', 'shoeR',
               'glasses', 'beard', 'ears', 'back', 'waist', 'handL', 'handR', 'shoes')   # last row: 3D wearables (js/wear.js)
BLING_MAP = {i['id']: i for i in BLING.get('items', []) if i.get('slot') in BLING_SLOTS}
SHOP_ITEMS += [{'item': i['id'], 'label': i['label'], 'cost': int(i['cost']), 'bling': True, 'slot': i['slot'], 'theme': i.get('theme', '')} for i in BLING_MAP.values()]
SHOP_MAP = {e['item']: e for e in SHOP_ITEMS}
REP_LEVELS = (0, 5, 15, 35, 70, 120)                 # Rep needed for level 0..5 (Newcomer, Regular, Local, Favorite, Celebrity, Legend)
def rep_level(n): return max(i for i, t in enumerate(REP_LEVELS) if int(n or 0) >= t)
TQ = {'i': 0, 'q': None}                             # next row index / open question {'a','cat','at','scored','nudged'}
TQ_LOCK = threading.Lock()

GAME_FLAGS = {'claw': 'gameClawOn', 'bbt': 'gameBbtOn', 'tag': 'gameTagOn', 'c4': 'gameC4On',
              'ttt': 'gameTttOn', 'pin': 'gamePinOn', 'pacman': 'gamePacmanOn',
              'uno': 'gameUnoOn', 'chess': 'gameChessOn', 'hotdog': 'hotdogOn'}   # game id -> settings key
def _game_allowed(s, game):
    """Admin → Settings → Games can switch any single game off. A disabled game's props/tabs
    never render client-side; this keeps a stale client from recording scores for it too."""
    key = GAME_FLAGS.get(str(game or '').strip())
    return bool(s.get(key, True)) if key else True   # unknown game ids pass (flat-file stays permissive)

# ---------- 🎵 jukebox: visitors spend arcade POINTS to play songs for the whole lot ----------
# data/jukebox.json: {"now": {file,title,by,at} or None, "queue": [{file,title,by}, ...]}. A paid
# play takes the stage or joins a short queue (max 3); each play runs jukeboxPlaySecs, and any
# visitor's poll advances the queue once the window passes. Points deduct server-side from the
# phone account (same authority as the 🏬 collectible shop) — the payer can never tip themselves.
def _juke_play_secs(s):
    try: return max(30, min(900, int(s.get('jukeboxPlaySecs') or 150)))
    except (TypeError, ValueError): return 150
def _jukebox_advance(j, play_secs):
    """Expire a finished play, promoting the next queued song (called on every read)."""
    now = j.get('now')
    if now and time.time() - (now.get('at') or 0) > play_secs:
        q = j.setdefault('queue', [])
        nxt = q.pop(0) if q else None
        j['now'] = ({'file': nxt.get('file'), 'title': nxt.get('title'), 'by': nxt.get('by'),
                     'at': time.time()} if nxt else None)
        return True
    return False

# ---------- 🗺️ geocaching: hide caches on the lot, hunt them for points + collectibles ----------
# data/geocaches.json: [{id,x,z,by,note,phone,at,prize:{item,label}|None,founds:[{phone,name,at}]}].
# Coords are lot/world space (never rig-local — a #layout truck move never moves a buried
# cache). The public list fuzzes every pin by ±2m, deterministic per id, so the pin never
# jitters between polls but never shows the exact spot; your OWN pins come back exact via
# ?phone=. A cache stashed with a collectible retires on its first find — the prize transfers
# server-side to the finder's account (same authority as the 🏬 shop). Points: first finder
# +12, everyone after +6, +4 on top when a prize was inside.
GEO_MAX = 24            # active caches on the lot — the oldest already-found ones retire first
GEO_RATE_S = 600        # one hide per visitor per 10 minutes
GEO_FIND_M = 4.0        # "close enough to dig": the pin fuzz is ±2m, so the search circle is wider
GEO_LOCK = threading.Lock()
GEO_LAST = {}           # phone -> last-hide ts (in-memory rate limit, same pattern as CHAT_RATE)
GIFT_LOCK = threading.Lock()            # gifts.json: pending sprout gifts keyed by recipient visitor id
GIFT_LAST = {}          # phone -> last-gift ts (rate limit, same pattern as GEO_LAST)

def _geo_fuzz(cid, x, z):
    """Stable ±2m pin fuzz per cache id — hunters navigate to an AREA, then search on foot."""
    h = int(hashlib.sha1(('geo' + str(cid)).encode()).hexdigest(), 16)
    return (round(float(x) + ((h % 41) - 20) * .1, 2), round(float(z) + ((h // 41 % 41) - 20) * .1, 2))


# ---------- 🃏 UNO helpers (multiplayer, drop in / drop out) ----------
import random as _rnd

def _uno_deck():
    deck = []
    colors = ['red', 'blue', 'green', 'yellow']
    for c in colors:
        deck.append({'color': c, 'value': '0'})
        for v in ['1','2','3','4','5','6','7','8','9','skip','reverse','draw2']:
            deck.append({'color': c, 'value': v}); deck.append({'color': c, 'value': v})
    for _ in range(4):
        deck.append({'color': 'wild', 'value': 'wild'})
        deck.append({'color': 'wild', 'value': 'wild4'})
    _rnd.shuffle(deck)
    return deck

def _uno_can_play(card, top, color):
    if card['color'] == 'wild': return True
    if card['color'] == color: return True
    if card['value'] == top['value'] and top['value'] not in ('wild', 'wild4'): return True
    return False

def _uno_deal_one(room, vid):
    hand = room['hands'].setdefault(vid, [])
    for _ in range(7):
        if not room['deck']:
            if len(room['discard']) > 1:
                top = room['discard'].pop()
                _rnd.shuffle(room['discard'])
                room['deck'] = room['discard']; room['discard'] = [top]
        if room['deck']:
            hand.append(room['deck'].pop())

def _uno_draw(room, vid, n):
    hand = room['hands'].setdefault(vid, [])
    for _ in range(n):
        if not room['deck']:
            if len(room['discard']) > 1:
                top = room['discard'].pop()
                _rnd.shuffle(room['discard'])
                room['deck'] = room['discard']; room['discard'] = [top]
        if room['deck']:
            hand.append(room['deck'].pop())

def _uno_advance(room, n=1):
    players = room['players']
    if not players: return
    idx = room['turn']
    for _ in range(n):
        idx = (idx + room['dir']) % len(players)
    room['turn'] = idx

def _uno_start(room):
    room['deck'] = _uno_deck()
    room['discard'] = []
    room['hands'] = {}
    room['uno'] = {}
    for p in room['players']:
        room['hands'][p['id']] = []
        room['uno'][p['id']] = False
        _uno_deal_one(room, p['id'])
    # first discard: must not be a wild/draw (reshuffle until a plain card)
    while True:
        c = room['deck'].pop()
        if c['color'] != 'wild':
            room['discard'].append(c); break
        room['deck'].insert(0, c)
    top = room['discard'][-1]
    room['color'] = top['color']
    room['value'] = top['value']
    room['dir'] = 1
    room['turn'] = 0
    room['drawStack'] = 0
    room['wild4'] = None
    room['winner'] = None
    room['status'] = 'playing'
    # mode timer not needed for uno

def _uno_play(room, vid, card_idx, chosen_color):
    hand = room['hands'].get(vid, [])
    if card_idx < 0 or card_idx >= len(hand): return 'bad index'
    card = hand[card_idx]
    top = room['discard'][-1]
    if not _uno_can_play(card, top, room['color']): return 'not playable'
    hand.pop(card_idx)
    room['discard'].append(card)
    skip_next = False
    if card['value'] in ('wild', 'wild4'):
        room['color'] = chosen_color if chosen_color in ('red', 'blue', 'green', 'yellow') else 'red'
        if card['value'] == 'wild4':
            nxt_vid = room['players'][(room['turn'] + room['dir']) % len(room['players'])]['id']
            _uno_draw(room, nxt_vid, 4)
            skip_next = True
    elif card['value'] == 'draw2':
        nxt_vid = room['players'][(room['turn'] + room['dir']) % len(room['players'])]['id']
        _uno_draw(room, nxt_vid, 2)
        skip_next = True
    elif card['value'] == 'skip':
        skip_next = True
    elif card['value'] == 'reverse':
        room['dir'] *= -1
        if len(room['players']) == 2:
            skip_next = True
    if not hand:
        room['status'] = 'finished'
        room['winner'] = vid
    if skip_next:
        _uno_advance(room, 2)
    else:
        _uno_advance(room, 1)
    if len(hand) == 1:
        room['uno'][vid] = True
    room['value'] = card['value'] if card['color'] != 'wild' else room['value']
    if card['color'] != 'wild':
        room['value'] = card['value']
    return 'ok'

# ---------- ♟️ chess helpers ----------
_PIECES_START = [
    ['bR','bN','bB','bQ','bK','bB','bN','bR'],
    ['bP','bP','bP','bP','bP','bP','bP','bP'],
    [None]*8, [None]*8, [None]*8, [None]*8,
    ['wP','wP','wP','wP','wP','wP','wP','wP'],
    ['wR','wN','wB','wQ','wK','wB','wN','wR'],
]

def _chess_start():
    return [row[:] for row in _PIECES_START]

def _chess_color(p): return p[0] if p else None
def _chess_type(p): return p[1] if p else None

def _chess_attacks(board, side, ep):
    # set of (x,y) squares attacked by `side`
    res = set()
    for y in range(8):
        for x in range(8):
            p = board[y][x]
            if not p or _chess_color(p) != side: continue
            t = _chess_type(p)
            if t == 'P':
                d = -1 if side == 'w' else 1
                for dx in (-1, 1):
                    nx, ny = x + dx, y + d
                    if 0 <= nx < 8 and 0 <= ny < 8:
                        res.add((nx, ny))
            elif t == 'N':
                for dx, dy in ((1,2),(2,1),(-1,2),(-2,1),(1,-2),(2,-1),(-1,-2),(-2,-1)):
                    nx, ny = x+dx, y+dy
                    if 0 <= nx < 8 and 0 <= ny < 8: res.add((nx, ny))
            elif t == 'K':
                for dx in (-1,0,1):
                    for dy in (-1,0,1):
                        if dx == 0 and dy == 0: continue
                        nx, ny = x+dx, y+dy
                        if 0 <= nx < 8 and 0 <= ny < 8: res.add((nx, ny))
            else:
                # sliding: B, R, Q
                dirs = []
                if t in ('B','Q'): dirs += [(-1,-1),(-1,1),(1,-1),(1,1)]
                if t in ('R','Q'): dirs += [(-1,0),(1,0),(0,-1),(0,1)]
                for dx, dy in dirs:
                    nx, ny = x+dx, y+dy
                    while 0 <= nx < 8 and 0 <= ny < 8:
                        res.add((nx, ny))
                        if board[ny][nx]: break
                        nx += dx; ny += dy
    return res

def _chess_in_check(board, side, ep):
    opp = 'b' if side == 'w' else 'w'
    attacks = _chess_attacks(board, opp, ep)
    # find king
    for y in range(8):
        for x in range(8):
            if board[y][x] == side + 'K':
                return (x, y) in attacks
    return False

def _chess_pseudo_moves(board, x, y, castle, ep):
    p = board[y][x]
    if not p: return []
    side = _chess_color(p); typ = _chess_type(p)
    moves = []
    if typ == 'P':
        d = -1 if side == 'w' else 1   # white moves up the board (toward row 0)
        start = 6 if side == 'w' else 1
        # forward
        if 0 <= y + d < 8 and board[y+d][x] is None:
            moves.append((x, y+d, None))
            if y == start and board[y+2*d][x] is None:
                moves.append((x, y+2*d, None))
        # captures
        for dx in (-1, 1):
            nx, ny = x + dx, y + d
            if 0 <= nx < 8 and 0 <= ny < 8:
                target = board[ny][nx]
                if target and _chess_color(target) != side:
                    moves.append((nx, ny, None))
                # en passant
                if ep and ep == (nx, ny) and target is None:
                    moves.append((nx, ny, 'ep'))
    elif typ == 'N':
        for dx, dy in ((1,2),(2,1),(-1,2),(-2,1),(1,-2),(2,-1),(-1,-2),(-2,-1)):
            nx, ny = x+dx, y+dy
            if 0 <= nx < 8 and 0 <= ny < 8:
                t = board[ny][nx]
                if t is None or _chess_color(t) != side:
                    moves.append((nx, ny, None))
    elif typ in ('B','R','Q'):
        dirs = []
        if typ in ('B','Q'): dirs += [(-1,-1),(-1,1),(1,-1),(1,1)]
        if typ in ('R','Q'): dirs += [(-1,0),(1,0),(0,-1),(0,1)]
        for dx, dy in dirs:
            nx, ny = x+dx, y+dy
            while 0 <= nx < 8 and 0 <= ny < 8:
                t = board[ny][nx]
                if t is None:
                    moves.append((nx, ny, None))
                elif _chess_color(t) != side:
                    moves.append((nx, ny, None)); break
                else:
                    break
                nx += dx; ny += dy
    elif typ == 'K':
        for dx in (-1,0,1):
            for dy in (-1,0,1):
                if dx == 0 and dy == 0: continue
                nx, ny = x+dx, y+dy
                if 0 <= nx < 8 and 0 <= ny < 8:
                    t = board[ny][nx]
                    if t is None or _chess_color(t) != side:
                        moves.append((nx, ny, None))
        # castling
        if side == 'w' and x == 4 and y == 0 and castle.get('wK'):
            if board[0][5] is None and board[0][6] is None and board[0][7] == 'wR':
                if not _chess_in_check(board, 'w', ep) and (5,0) not in _chess_attacks(board, 'b', ep) and (6,0) not in _chess_attacks(board, 'b', ep):
                    moves.append((6, 0, 'castleK'))
            if castle.get('wQ') and board[0][1] is None and board[0][2] is None and board[0][3] is None and board[0][0] == 'wR':
                if not _chess_in_check(board, 'w', ep) and (3,0) not in _chess_attacks(board, 'b', ep) and (2,0) not in _chess_attacks(board, 'b', ep):
                    moves.append((2, 0, 'castleQ'))
        if side == 'b' and x == 4 and y == 7 and castle.get('bK'):
            if board[7][5] is None and board[7][6] is None and board[7][7] == 'bR':
                if not _chess_in_check(board, 'b', ep) and (5,7) not in _chess_attacks(board, 'w', ep) and (6,7) not in _chess_attacks(board, 'w', ep):
                    moves.append((6, 7, 'castleK'))
            if castle.get('bQ') and board[7][1] is None and board[7][2] is None and board[7][3] is None and board[7][0] == 'bR':
                if not _chess_in_check(board, 'b', ep) and (3,7) not in _chess_attacks(board, 'w', ep) and (2,7) not in _chess_attacks(board, 'w', ep):
                    moves.append((2, 7, 'castleQ'))
    # promotion
    out = []
    for (nx, ny, sp) in moves:
        if typ == 'P' and (ny == 0 or ny == 7):
            for pr in ('q','r','b','n'):
                out.append((nx, ny, pr))
        else:
            out.append((nx, ny, sp))
    return out

def _chess_legal_moves(board, side, castle, ep):
    moves = []
    for y in range(8):
        for x in range(8):
            p = board[y][x]
            if not p or _chess_color(p) != side: continue
            for (nx, ny, sp) in _chess_pseudo_moves(board, x, y, castle, ep):
                # simulate
                snap = [row[:] for row in board]
                snap_castle = dict(castle)
                snap_ep = ep
                captured = board[ny][nx]
                # handle ep capture
                if sp == 'ep':
                    cap_y = y
                    snap[cap_y][nx] = None
                board[ny][nx] = board[y][x]
                board[y][x] = None
                # castling rook move
                if sp == 'castleK':
                    board[ny][5] = board[ny][7]; board[ny][7] = None
                elif sp == 'castleQ':
                    board[ny][3] = board[ny][0]; board[ny][0] = None
                # promotion
                if sp in ('q','r','b','n'):
                    board[ny][nx] = side + sp.upper()
                # check legality
                legal = not _chess_in_check(board, side, ep)
                # restore
                for i in range(8): board[i][:] = snap[i][:]
                castle.clear(); castle.update(snap_castle)
                # (castle was mutated above? no — we passed castle ref; restore manually)
                # Actually castle is a dict ref; reassign
                # restore castle properly:
                for k in list(castle.keys()): del castle[k]
                for k, v in snap_castle.items(): castle[k] = v
                if legal:
                    moves.append(((x, y), (nx, ny), sp))
    return moves

def _chess_try_move(room, fx, fy, tx, ty, promo):
    board = room['board']; side = 'w' if room['turn'] == 'white' else 'b'
    castle = room['castle']; ep = room['ep']
    legal = _chess_legal_moves(board, side, castle, ep)
    match = _MISSING = object()
    for (f, t, sp) in legal:
        if f == (fx, fy) and t == (tx, ty):
            if sp in ('q','r','b','n'):
                if sp != promo: continue
            match = sp; break
    if match is _MISSING: return 'illegal move'
    # apply
    p = board[fy][fx]
    captured = board[ty][tx]
    # en passant capture
    if match == 'ep':
        captured = board[fy][tx]
        board[fy][tx] = None
    # castling
    if match == 'castleK':
        board[ty][5] = board[ty][7]; board[ty][7] = None
    elif match == 'castleQ':
        board[ty][3] = board[ty][0]; board[ty][0] = None
    board[ty][tx] = p
    board[fy][fx] = None
    if match in ('q','r','b','n'):
        board[ty][tx] = side + match.upper()
    # update castling rights
    if p == 'wK': castle['wK'] = castle['wQ'] = False
    if p == 'bK': castle['bK'] = castle['bQ'] = False
    if p == 'wR':
        if fx == 0 and fy == 0: castle['wQ'] = False
        if fx == 7 and fy == 0: castle['wK'] = False
    if p == 'bR':
        if fx == 0 and fy == 7: castle['bQ'] = False
        if fx == 7 and fy == 7: castle['bK'] = False
    if captured and captured[1] == 'R':
        if tx == 0 and ty == 0: castle['wQ'] = False
        if tx == 7 and ty == 0: castle['wK'] = False
        if tx == 0 and ty == 7: castle['bQ'] = False
        if tx == 7 and ty == 7: castle['bK'] = False
    # en passant square
    if p[1] == 'P' and abs(fy - ty) == 2:
        room['ep'] = (fx, (fy + ty) // 2)
    else:
        room['ep'] = None
    # half-move clock
    if p[1] == 'P' or captured:
        room['half'] = 0
    else:
        room['half'] += 1
    if side == 'b':
        room['full'] += 1
    room['turn'] = 'black' if side == 'w' else 'white'
    room['moves'].append({'from': chr(fx + 97) + str(8 - fy), 'to': chr(tx + 97) + str(8 - ty),
                          'promo': match if match in ('q','r','b','n') else None,
                          'captured': captured, 'piece': p})
    # checkmate / stalemate
    opp_side = 'w' if room['turn'] == 'white' else 'b'
    opp_moves = _chess_legal_moves(board, opp_side, castle, room['ep'])
    if not opp_moves:
        if _chess_in_check(board, room['turn'] if room['turn'] in ('w','b') else ('w' if room['turn'] == 'white' else 'b'), room['ep']):
            room['winner'] = 'white' if side == 'w' else 'black'
        else:
            room['winner'] = 'draw'
        room['status'] = 'finished'
    # 50-move rule
    if room['half'] >= 100:
        room['winner'] = 'draw'; room['status'] = 'finished'
    return 'ok'

# ---------- leaderboards (data/scores.json) + score-driven trivia ----------
# Every minigame finish (and each hot-dog contest round) reports its result to /api/score. The
# flat file keeps a small rolling ring per game plus best/last shortcuts; /api/scores feeds the
# physical HIGH SCORES board by the truck (click it on site) and the bot's live-score questions.
SCORE_LOCK = threading.Lock()
SCORE_GAMES = ['claw', 'bbt', 'tag', 'c4', 'ttt', 'pin', 'hotdog']
SCORES = load('scores.json', {})
def _scores_ready(g):
    s = SCORES.setdefault(g, {'rows': [], 'best': None, 'last': None})
    s.setdefault('rows', []); s.setdefault('best', None); s.setdefault('last', None)
    return s
def _score_record(game, name, value, label=''):
    g = str(game or '').strip()[:12]
    if g not in SCORE_GAMES: return
    name = (name or 'Guest').strip()[:24]
    try: value = round(float(value), 2)
    except (TypeError, ValueError): return
    s = _scores_ready(g)
    row = {'name': name, 'value': value, 'ts': int(time.time())}
    if label: row['label'] = str(label)[:48]
    s['rows'].append(row); del s['rows'][:-30]                   # small ring per game
    s['last'] = row
    if s['best'] is None or value > s['best']['value']: s['best'] = row
    with SCORE_LOCK: save('scores.json', SCORES)
def _score_name(data):
    """Scoreboard display name: the signed-in account's chosen name always wins; anything posted
    alongside an unsigned result gets the 🧼 censor pass."""
    ph = ''.join(re.findall(r'\d', str(data.get('phone', ''))))[-10:]
    if len(ph) == 10:
        rec = load('accounts.json', {}).get(ph)
        if rec: return rec.get('name') or ''
    return _clean(str(data.get('name', '')))[:24]

def _holder_most(src):                                            # richest account at a grab-bag stat
    a = load('accounts.json', {})
    best, bv = None, 0
    for ph, rec in a.items():
        v = 0
        if src == 'points': v = rec.get('points', 0)
        elif src == 'total': v = sum(int(e.get('count', 1)) for e in rec.get('prizes', []))
        else: v = rec.get('wins', {}).get(src, 0)
        if v > bv and rec.get('name') and rec['name'] != 'Guest': best, bv = rec['name'], v
    if best is None:
        for ph, rec in a.items():                                 # fall back to whatever rec exists
            v = rec.get('points', 0) if src == 'points' else sum(int(e.get('count', 1)) for e in rec.get('prizes', [])) if src == 'total' else rec.get('wins', {}).get(src, 0)
            if v > bv: best, bv = str(rec.get('name') or ph), v
    return best, bv
def _live_rows():                                                 # 🏅 generated from the live lot state
    def num_kw(v):
        s = {_norm('%g' % v), _norm('%.2f' % v), _norm('%d' % int(v))}
        s.discard('')
        return sorted(s)
    rows = []
    hd = SCORES.get('hotdog') or {}
    if hd.get('best'):
        rows.append({'q': 'What is the HOT-DOG CONTEST record — most dogs eaten at once?',
                     'a': num_kw(hd['best']['value']), 'cat': 'Scores'})
    if hd.get('last') and hd['last'].get('name') and _norm(hd['last']['name']) not in ('', 'guest'):
        rows.append({'q': 'Who won the LAST hot-dog eating contest?',
                     'a': [_norm(hd['last']['name'])], 'cat': 'Scores'})
    w, v = _holder_most('claw')
    if w and v > 0: rows.append({'q': 'Who has grabbed the MOST prizes from the claw machine?',
                                 'a': [_norm(w)], 'cat': 'Scores'})
    pin = SCORES.get('pin') or {}
    if pin.get('last') and pin['last'].get('label'):
        lbl = _norm(pin['last']['label'])
        rows.append({'q': 'What fell out of the PIÑATA at its last smash?',
                     'a': sorted({lbl, lbl.replace('mini ', ''), lbl.replace('mini ', '').replace(' plush', '').replace(' charm', '')} - {''}),
                     'cat': 'Scores'})
    claw = SCORES.get('claw') or {}
    if claw.get('last') and claw['last'].get('label'):
        lbl = _norm(claw['last']['label'])
        rows.append({'q': 'What was fished out of the CLAW MACHINE most recently?',
                     'a': sorted({lbl, lbl.replace('mini ', ''), lbl.replace('mini ', '').replace(' plush', '').replace(' charm', '')} - {''}),
                     'cat': 'Scores'})
    bbt = SCORES.get('bbt') or {}
    if bbt.get('best'):
        rows.append({'q': 'What is the BEAN-BAG TOSS high score?', 'a': num_kw(bbt['best']['value']), 'cat': 'Scores'})
    w, v = _holder_most('points')
    if w and v > 0: rows.append({'q': 'Who LEADS the trivia points leaderboard?', 'a': [_norm(w)], 'cat': 'Scores'})
    w, v = _holder_most('total')
    if w and v > 0: rows.append({'q': 'Who brags the BIGGEST collectible shelf overall?',
                                 'a': [_norm(w)], 'cat': 'Scores'})
    return rows

def _trivia_post(text):
    if not text: return
    with CHAT_LOCK:
        CHAT.append({'id': 'triviabot', 'name': 'Trivia Bot', 'hue': 40, 'text': text[:140], 'ts': time.time()})
        del CHAT[:-CHAT_MAX]
    with PRESENCE_LOCK:                              # give the bot presence so its name renders
        PRESENCE.setdefault('triviabot', {'hue': 40, 'ts': time.time()})

def _trivia_next():
    if not TRIVIA: return
    if not {**DEFAULT_SETTINGS, **load('settings.json', {})}.get('triviaBotOn', True):
        with TQ_LOCK: TQ['q'] = None   # owner switched the bot off: close any open race immediately
        return
    live = None
    with TQ_LOCK:
        n = TQ.get('n', 0) + 1                       # served-question counter (every 3rd mirrors the lot)
        TQ['n'] = n
        if n % 3 == 0:
            cand = _live_rows()
            live = cand[(n // 3) % len(cand)] if cand else None   # cycle the live generators
        if live is not None:
            row = live
        else:
            row = TRIVIA[TQ['i'] % len(TRIVIA)]
            TQ['i'] += 1
        prevCat = TQ.get('lastCat')
        cat = row.get('cat', 'Mesa') or 'Mesa'
        TQ['lastCat'] = cat
        TQ['q'] = {'a': row.get('a', []), 'cat': cat,
                   'at': time.time(), 'scored': set(), 'nudged': set()}
    if prevCat is not None and prevCat != cat:       # announce every topic change per owner request
        _trivia_post('🔄 Topics switch: ' + cat + ' trivia!')
    _trivia_post('🤖 TRIVIA (' + cat + '): ' + row['q'] +
                 '  🏁 Race! ' + str(TRIVIA_OPEN_S) + 's: +5 pts for 1st, +3, +2, +1 for everyone who gets it. Redeem at 🏬!')

def _trivia_answer_check(myid, text, name, phone=''):
    """Race scoring: order of arrival sets the payout — 5/3/2 for the podium, +1 for everyone else
    who lands it inside the 20s window. One award per user per question. Returns the points banked
    (int), 0 for an unsigned correct guess (one nudge posted), or None."""
    if not TRIVIA: return None
    if not {**DEFAULT_SETTINGS, **load('settings.json', {})}.get('triviaBotOn', True): return None   # bot is off
    with TQ_LOCK:
        q = TQ['q']
        if not q: return None
        t = _norm(text)
        hit = next((a for a in q['a'] if a in t), None)
        if not hit: return None
        if time.time() - q['at'] > TRIVIA_OPEN_S: return None   # scoring closed after 20s window
        if time.time() - q['at'] < .5: return None              # .5s guards the bot's own echo
        bank = phone and len(phone) == 10
        if bank and myid in q['scored']: return None          # one award per user per question
        place = len(q['scored']) + 1
        pts = TRIVIA_PLACE_PTS.get(place, TRIVIA_FLOOR_PTS)
        if bank: q['scored'].add(myid)
        elif myid in q['nudged']: return None                 # nudge each guest only once per question
        else: q['nudged'].add(myid)
    who = name or 'A visitor'
    if not bank:
        _trivia_post('🎯 ' + who + ' got it! (sign in at 🏬 to bank points)')
        return 0
    a = load('accounts.json', {})
    rec = a.setdefault(phone, {'created': int(time.time()), 'name': 'Guest',
                               'prizes': [], 'wins': {}, 'points': 0})
    rec['points'] = rec.get('points', 0) + pts
    rec.setdefault('prizes', [])
    wins = rec.setdefault('wins', {})
    wins['trivia'] = wins.get('trivia', 0) + 1
    with ACCOUNTS_LOCK: save('accounts.json', a)
    medal = {1: '🥇', 2: '🥈', 3: '🥉'}.get(place, '🎯')
    _trivia_post(medal + ' ' + who + ' keyed in ' + ('first!' if place == 1 else '#' + str(place)) +
                 '  +' + str(pts) + ' pts 🎟')
    return pts

def _trivia_loop():
    time.sleep(15)
    while True:
        _trivia_next()
        time.sleep(TRIVIA_OPEN_S)                             # 20s scoring window
        with TQ_LOCK:
            q = TQ['q']; TQ['q'] = None
        if q:
            n = len(q['scored'])
            _trivia_post('⏰ Time! The answer was: ' + (q['a'][0] if q['a'] else '—') +
                         ('  🏅 ' + str(n) + ' scorer' + ('s' if n != 1 else '') + ' this round!' if n else '  Nobody scored — watch for the next one!'))
        time.sleep(TRIVIA_GAP_S)                              # breather, then the next question

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
    _load_help()        # restore visitor problem threads (the admin alert feed survives restarts)
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

# ---------- commerce: ledger · inventory · promos · rewards · stripe · EOM reports ----------
# All flat files under data/ - append-only ledger.jsonl for the audit trail (orders.json keeps
# only the last 2000, so reports regenerate from the ledger, never from trimmed history),
# inventory.json for ingredients + per-item recipes, and data/reports/eom-<month>.json outputs.
LEDGER_LOCK = threading.Lock()
INV_LOCK = threading.Lock()
REPORT_LOCK = threading.Lock()

def ledger_append(ev):
    """data/ledger.jsonl - append-only commerce trail: sale / void / payment / restock /
    waste events. Never trimmed, so EOM reports can always be rebuilt from scratch."""
    with LEDGER_LOCK:
        with open(os.path.join(DATA, 'ledger.jsonl'), 'a') as f:
            f.write(json.dumps({'ts': int(time.time()), **ev}) + '\n')

def _slug(n):
    return re.sub(r'[^a-z0-9]+', '-', str(n).lower()).strip('-') or 'x'

def get_inventory():
    """data/inventory.json; the first call seeds a starter sheet from the menu (a protein
    ingredient per menu protein + category staples) so tracking works on day one - the
    admin then tunes real quantities and stock levels in the Inventory tab."""
    inv = load('inventory.json', None)
    if inv is None:
        staples = [('tortilla-corn', 'Corn tortilla', 2, 'Tacos'),
                   ('tortilla-flour', 'Flour tortilla', 1, 'Burritos'),
                   ('cup', 'Cup + lid + straw', 1, 'Bebidas')]
        m = load('menu.json', {})
        ings, seen = [], set()
        def add_ing(iid, nm, unit, stock, low):
            if iid in seen: return
            seen.add(iid); ings.append({'id': iid, 'name': nm, 'unit': unit, 'stock': stock, 'lowAt': low})
        for p in (m.get('proteins') or []): add_ing('pro-' + _slug(p), p, 'servings', 600, 100)
        for iid, nm, _, _ in staples: add_ing(iid, nm, 'each', 1200, 200)
        recipes = {}
        for c in m.get('categories') or []:
            staple = next((s for s in staples if s[3] and s[3] in str(c.get('name', ''))), None)
            for it in c.get('items') or []:
                r = []
                if it.get('protein'): r.append({'ing': '$protein', 'qty': 1})
                if staple: r.append({'ing': staple[0], 'qty': staple[2]})
                if r: recipes[it['id']] = r
        inv = {'ingredients': ings, 'recipes': recipes}
        save('inventory.json', inv)
    return inv

def order_ingredients(o):
    """Map an order to {ingredientId: qty} through inventory recipes. '$protein' resolves to
    the chosen protein's own ingredient row (the truck uses one protein ingredient per item)."""
    inv = get_inventory()
    use = {}
    for l in o.get('items') or []:
        for r in (inv.get('recipes') or {}).get(l.get('id')) or []:
            ing = r.get('ing')
            qty = float(r.get('qty') or 0) * int(l.get('qty') or 0)
            if ing == '$protein': ing = 'pro-' + _slug(l.get('protein') or '')
            if not ing or not qty: continue
            use[ing] = round(use.get(ing, 0) + qty, 2)
    return use

def inventory_consume(o):
    """Order placed: deduct ingredients. Shortfalls just go negative - a festival truck never
    stops selling, but the EOM report surfaces every negative dip as a restock reminder."""
    use = order_ingredients(o)
    if use:
        with INV_LOCK:
            inv = get_inventory()
            for ing in inv['ingredients']:
                if ing['id'] in use: ing['stock'] = round(float(ing.get('stock') or 0) - use[ing['id']], 2)
            save('inventory.json', inv)
    o['invUsed'] = use
    return use

def inventory_restore(o):
    """Cancelled order: put the ingredients back (once per order)."""
    if o.get('invRestored'): return {}
    use = order_ingredients(o)
    if use:
        with INV_LOCK:
            inv = get_inventory()
            for ing in inv['ingredients']:
                if ing['id'] in use: ing['stock'] = round(float(ing.get('stock') or 0) + use[ing['id']], 2)
            save('inventory.json', inv)
    o['invRestored'] = True
    return use

def inventory_adjust(ing_id, qty, kind, reason='', cost=None):
    """Admin restock / waste: moves stock and logs it to the ledger. kind: 'restock' or 'waste'."""
    with INV_LOCK:
        inv = get_inventory()
        for ing in inv['ingredients']:
            if ing['id'] == ing_id:
                ing['stock'] = round(float(ing.get('stock') or 0) + (qty if kind == 'restock' else -qty), 2)
                break
        else:
            return False
        save('inventory.json', inv)
    ledger_append({'type': kind, 'ing': ing_id, 'qty': qty, 'reason': (reason or '')[:120], 'cost': cost})
    return True

def reverse_order_rewards(o):
    """Cancelled order: un-bank its earned points and refund redeemed ones (once)."""
    if o.get('rewardsReversed'): return
    ph = ''.join(re.findall(r'\d', str(o.get('phone', ''))))[-10:]
    if len(ph) == 10:
        with ACCOUNTS_LOCK:
            a = load('accounts.json', {})
            rec = a.get(ph)
            if rec:
                rec['points'] = max(0, int(rec.get('points') or 0)
                                    - int(o.get('pointsEarned') or 0) + int(o.get('pointsSpent') or 0))
                a[ph] = rec; save('accounts.json', a)
    o['rewardsReversed'] = True

# ---------- promotions ----------
def _promo_in_window(p, now=None):
    now = now or time.time()
    d = time.strftime('%Y-%m-%d', time.localtime(now))
    starts, ends = str(p.get('starts') or ''), str(p.get('ends') or '')
    if starts and d < starts: return False
    if ends and d > ends: return False
    return True

def _promo_dow_ok(p):
    dow = p.get('dow') or []
    try: dow = [int(x) for x in dow]
    except (TypeError, ValueError): return True
    return (not dow) or (time.localtime().tm_wday in dow)

def active_specials(s):
    """itemId -> promo row for daily/weekly specials running right now (auto-pricing)."""
    out = {}
    for p in s.get('promos') or []:
        if not p.get('active') or p.get('kind') != 'special' or not p.get('itemId'): continue
        if not _promo_dow_ok(p) or not _promo_in_window(p): continue
        if int(p.get('priceCents') or 0) > 0: out[p['itemId']] = p
    return out

def find_promo_code(s, code):
    code = str(code or '').strip().upper()
    if not code: return None
    for p in s.get('promos') or []:
        if (p.get('active') and p.get('kind') == 'code'
                and str(p.get('code') or '').strip().upper() == code):
            return p if (_promo_dow_ok(p) and _promo_in_window(p)) else None
    return None

# ---------- stripe (plain HTTPS, no pip package: checkout session + webhook signature) ----------
def stripe_checkout(s, o, origin):
    """One Stripe Checkout Session: the whole order is a single line item at o.total, so
    specials / promo codes / rewards discounts are already priced in."""
    key = str(s.get('stripeSecret') or '').strip()
    if not (key.startswith('sk_test_') or key.startswith('sk_live_')):
        return None, 'Stripe is not configured yet (admin settings → payments).'
    form = {'mode': 'payment',
            'success_url': f'{origin}/?order={o["id"]}&stripe=success',
            'cancel_url': f'{origin}/?order={o["id"]}&stripe=cancel',
            'client_reference_id': o['id'], 'metadata[orderId]': o['id'],
            'line_items[0][quantity]': '1',
            'line_items[0][price_data][currency]': 'usd',
            'line_items[0][price_data][unit_amount]': str(int(round(float(o['total']) * 100))),
            'line_items[0][price_data][product_data][name]':
                f"{s.get('businessName') or 'El Otro Lado'} order #{o['number']}"}
    req = urllib.request.Request('https://api.stripe.com/v1/checkout/sessions',
                                 data=urlencode(form).encode(),
                                 headers={'Authorization': 'Bearer ' + key})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode()), None
    except urllib.error.HTTPError as e:
        return None, f'Stripe rejected the session: {e.read().decode()[:300]}'
    except Exception as e:
        return None, f'Could not reach Stripe: {e}'

def stripe_verify_webhook(raw, sig_header, whsec):
    """Constant-time check of Stripe's t=…,v1=… signature (Stripe-Signature header)."""
    if not whsec or not sig_header: return False
    ts = sig = None
    for part in sig_header.split(','):
        k, _, v = part.strip().partition('=')
        if k == 't': ts = v
        if k == 'v1': sig = v
    if not ts or not sig: return False
    expected = hmac.new(whsec.encode(), f'{ts}.'.encode() + raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)

# ---------- EOM reports ----------
def month_of(ts):
    return time.strftime('%Y-%m', time.localtime(ts or 0))

def ledger_events(month=None):
    out = []
    try:
        with open(os.path.join(DATA, 'ledger.jsonl')) as f:
            for line in f:
                line = line.strip()
                if not line: continue
                try: ev = json.loads(line)
                except json.JSONDecodeError: continue
                if month is None or month_of(ev.get('ts') or 0) == month: out.append(ev)
    except FileNotFoundError:
        pass
    return out

def build_report(month):
    """EOM stats from the append-only ledger plus a current stock snapshot. Marketing spend
    comes from the admin campaign list so ROI sits right next to gross sales."""
    evs = ledger_events(month)
    sales = [e for e in evs if e.get('type') == 'sale']
    pays = [e for e in evs if e.get('type') == 'payment']
    voids = [e for e in evs if e.get('type') == 'void']
    wastes = [e for e in evs if e.get('type') == 'waste']
    restocks = [e for e in evs if e.get('type') == 'restock']
    gross = sum(e.get('total') or 0 for e in sales)
    disc = sum(e.get('discount') or 0 for e in sales)
    tax = sum(e.get('tax') or 0 for e in sales)
    by_method, by_item, by_hour, by_day = {}, {}, {}, {}
    for e in sales:
        d = by_method.setdefault(e.get('payMethod') or 'cash', {'orders': 0, 'sales': 0.0})
        d['orders'] += 1; d['sales'] += e.get('total') or 0
        lt = time.localtime(e.get('ts') or 0)
        by_day[lt.tm_mday] = by_day.get(lt.tm_mday, 0) + (e.get('total') or 0)
        by_hour[lt.tm_hour] = by_hour.get(lt.tm_hour, 0) + (e.get('total') or 0)
        for it in e.get('items') or []:
            d2 = by_item.setdefault(it.get('name'), {'qty': 0, 'sales': 0.0})
            d2['qty'] += it.get('qty') or 0
            d2['sales'] += (it.get('price') or 0) * (it.get('qty') or 0)
    ing_use = {}
    for e in sales:
        for k, v in (e.get('ing') or {}).items(): ing_use[k] = ing_use.get(k, 0) + v
    payments = {}
    for e in pays:
        d = payments.setdefault(e.get('method') or 'cash', {'count': 0, 'amount': 0.0})
        d['count'] += 1; d['amount'] += e.get('amount') or 0
    promos = {}
    for e in sales:
        if e.get('promo'): promos[e['promo']] = promos.get(e['promo'], 0) + 1
    st = {**DEFAULT_SETTINGS, **load('settings.json', {})}
    camps = [c for c in st.get('marketingCampaigns') or [] if c.get('active')]
    spend = sum(float(c.get('spend') or 0) for c in camps)
    inv = get_inventory()
    name_of = {i['id']: i['name'] for i in inv.get('ingredients') or []}
    return {'month': month, 'generated': int(time.time()),
            'orders': len(sales), 'grossSales': round(gross, 2), 'discounts': round(disc, 2),
            'taxCollected': round(tax, 2), 'netOfTax': round(gross - tax, 2),
            'avgTicket': round(gross / len(sales), 2) if sales else 0,
            'unpaidAtMonthEnd': round(gross - sum(e.get('total') or 0 for e in pays), 2),
            'voids': {'count': len(voids), 'value': round(sum(e.get('total') or 0 for e in voids), 2)},
            'byPaymentMethod': {m: {'orders': d['orders'], 'sales': round(d['sales'], 2)} for m, d in by_method.items()},
            'confirmedPayments': payments,
            'topItems': sorted(({'item': k, 'qty': v['qty'], 'sales': round(v['sales'], 2)} for k, v in by_item.items()),
                               key=lambda x: -x['qty'])[:8],
            'byItem': {k: {'qty': v['qty'], 'sales': round(v['sales'], 2)} for k, v in by_item.items()},
            'busiestDay': max(by_day, key=by_day.get) if by_day else None,
            'salesByDay': {str(k): round(v, 2) for k, v in sorted(by_day.items())},
            'salesByHour': {str(k): round(v, 2) for k, v in sorted(by_hour.items())},
            'promosUsed': promos,
            'rewards': {'pointsEarned': sum(e.get('pointsEarned') or 0 for e in sales),
                        'pointsSpent': sum(e.get('pointsSpent') or 0 for e in sales)},
            'ingredients': {'used': {name_of.get(k, k): round(v, 2) for k, v in sorted(ing_use.items())},
                            'wasted': {name_of.get(e.get('ing'), e.get('ing')): e.get('qty') for e in wastes},
                            'restocked': {name_of.get(e.get('ing'), e.get('ing')): e.get('qty') for e in restocks}},
            'marketing': {'campaigns': camps, 'spend': round(spend, 2),
                          'roiGrossPerDollar': round(gross / spend, 2) if spend else None},
            'stockSnapshot': [{'id': i['id'], 'name': i['name'], 'stock': i.get('stock'),
                               'lowAt': i.get('lowAt')} for i in inv.get('ingredients') or []],
            'lowStock': [i['name'] for i in inv.get('ingredients') or []
                         if float(i.get('stock') or 0) < float(i.get('lowAt') or 0)]}

def write_eom_report(month):
    rep = build_report(month)
    with REPORT_LOCK:
        os.makedirs(os.path.join(DATA, 'reports'), exist_ok=True)
        with open(os.path.join(DATA, 'reports', f'eom-{month}.json'), 'w') as f:
            json.dump(rep, f, indent=2)
    return rep

# ---------- outreach: local-business partner search, contact emails, pairing pitches ----------
# Flat file data/outreach.json = {searches:[], leads:[], templates:{}}. No API keys: the address
# geocodes through OpenStreetMap's Nominatim, businesses come from Overpass (public OSM data),
# and emails are read off each business's own website (homepage + /contact, 6s timeout, 200KB
# cap, gentle pacing). Nothing is ever auto-sent - drafts are written for the admin to send.

OUTREACH_LOCK = threading.Lock()

def get_outreach():
    return load('outreach.json', {'searches': [], 'leads': [], 'templates': {}})

def save_outreach(o):
    with OUTREACH_LOCK: save('outreach.json', o)

# category -> (label, Overpass (tag,value) filters, the pairing angle for the pitch email)
OUTREACH_CATS = {
    'brewery': ('Bars & taprooms', [('amenity', 'bar'), ('amenity', 'pub'), ('craft', 'brewery')],
                'your room and our window are the same night out - we park at your door on the slow weekday and hand you the crowd'),
    'coffee': ('Coffee & tea shops', [('amenity', 'cafe')],
               'your regulars already love good food - a taco-and-cortado bundle brings them back midweek'),
    'gym': ('Gyms & fitness studios', [('leisure', 'fitness_centre'), ('leisure', 'sports_centre')],
            'post-workout protein at your front door: members pre-order our high-protein bowls and skip the meal-prep'),
    'salon': ('Salons & spas', [('shop', 'hairdresser'), ('shop', 'beauty'), ('shop', 'cosmetics'), ('leisure', 'spa')],
              'your clients sit for hours - book a "blowout + birria" evening and we will run the line outside'),
    'office': ('Offices & coworking', [('office', None), ('amenity', 'office')],
               'one food-truck day a week in your parking lot is the cheapest employee perk you will ever approve'),
    'venue': ('Event venues & theaters', [('amenity', 'events_venue'), ('amenity', 'theatre'), ('amenity', 'community_centre')],
              'your event nights need food that never needs your kitchen - we roll up, serve, and roll out'),
    'school': ('Schools & churches', [('amenity', 'school'), ('amenity', 'college'), ('amenity', 'place_of_worship')],
               'fundraiser nights where a slice of every order goes straight back to your program'),
    'retail': ('Retail shops', [('shop', 'mall'), ('shop', 'supermarket'), ('shop', 'clothes'), ('shop', 'books')],
               'weekend foot traffic is our shared customer - a parked truck keeps shoppers on your lot longer'),
}

def _lead_category(tags):
    for cat, (_, filters, _) in OUTREACH_CATS.items():
        for k, v in filters:
            if (v is None and k in tags) or tags.get(k) == v:
                return cat
    return 'retail'

def _lead_address(tags):
    parts = [tags.get('addr:housenumber'), tags.get('addr:street'), tags.get('addr:city')]
    return ', '.join(p for p in parts if p)

def geocode(address):
    req = urllib.request.Request('https://nominatim.openstreetmap.org/search?'
                                 + urlencode({'q': address, 'format': 'json', 'limit': 1}),
                                 headers={'User-Agent': 'elotrolado-foodtruck-outreach/1.0'})
    with urllib.request.urlopen(req, timeout=15) as r:
        j = json.loads(r.read().decode())
    return (float(j[0]['lat']), float(j[0]['lon']), j[0].get('display_name', '')) if j else None

def overpass_search(lat, lon, radius, cats):
    parts = []
    for c in cats:
        for k, v in OUTREACH_CATS[c][1]:
            tag = f'["{k}"]' if v is None else f'["{k}"="{v}"]'
            parts.append(f'nwr{tag}(around:{radius:.0f},{lat:.6f},{lon:.6f});')
    q = '[out:json][timeout:25];(' + ''.join(parts) + ');out center tags 200;'
    # overpass-api.de queues under load; the kumi.systems mirror is the standard fallback
    last = None
    for host in ('https://overpass-api.de/api/interpreter',
                 'https://overpass.kumi.systems/api/interpreter'):
        try:
            req = urllib.request.Request(host, data=urlencode({'data': q}).encode(),
                                         headers={'User-Agent': 'elotrolado-foodtruck-outreach/1.0'})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode()).get('elements') or []
        except Exception as e:
            last = e
    raise last

_EMAIL_RE = re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')

def site_emails(site):
    """Public contact email off a business's own site: homepage then /contact, mailto links
    first, then plain addresses, plus the common 'name (at) domain' obfuscation."""
    found = []
    for url in (site.rstrip('/') + '/', site.rstrip('/') + '/contact'):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'elotrolado-foodtruck-outreach/1.0'})
            with urllib.request.urlopen(req, timeout=6) as r:
                page = r.read(200_000).decode('utf-8', 'ignore')
        except Exception:
            continue
        found.extend(re.findall(r'mailto:([^"\'?>\s]+)', page)[:3])
        found.extend(_EMAIL_RE.findall(page)[:3])
        found.extend(f'{a}@{b}' for a, b in re.findall(
            r'([a-zA-Z0-9._%+-]+)\s*\(\s*at\s*\)\s*([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})', page)[:3])
        if found: break
    good = [e.strip('.').lower() for e in found
            if not e.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'))]
    return good[0] if good else ''

DEFAULT_PITCH = (
    'Subject: {our} x {business} - a food-truck night that fills both of our lots\n\n'
    'Hi {business} team,\n\n'
    'I run {our}, a Mesa food truck ({tagline}) - birria, asada and street tacos with a '
    'text-when-ready pickup line that keeps crowds moving.\n\n'
    'Why us: {angle}.\n\n'
    'We handle everything - permits, power, waste, and the text-alert line so nobody waits. '
    'You get the draw, we split the win, and the first date can be a one-evening pilot before '
    'either of us commits to a schedule.\n\n'
    'Menu + photos: {social}\nCall or text me any time: {phone}\n\n'
    '- Summer & Jesse, {our}')

def draft_pitch(lead, s, template=None):
    """The admin's saved template wins; the default writes itself around {placeholders} with a
    category-specific pairing line, so every email is about THEIR business + OUR truck."""
    tpl = template or (get_outreach().get('templates') or {}).get('default') or DEFAULT_PITCH
    label, _, angle = OUTREACH_CATS.get(lead.get('category')) or ('local business', None,
        'a food-truck night your customers will thank you for')
    fill = {'business': lead.get('name') or 'your business',
            'category': label.lower(), 'angle': angle,
            'address': lead.get('address') or '',
            'our': s.get('businessName') or 'El Otro Lado',
            'tagline': s.get('tagline') or 'The Other Side',
            'phone': s.get('phone') or '',
            'email': s.get('email') or '',
            'social': s.get('social') or ''}
    return re.sub(r'\{(\w+)\}', lambda m: str(fill.get(m.group(1), '')), tpl)

def create_order(s, name, phone, notes, items, sms_consent, ip, method,
                 pay_method='cash', promo_code='', reward_id=''):
    """Shared by the checkout form (/api/order) and the AI chat assistant (/api/assistant)'s
    place_order tool, so a chat-placed order is validated and priced exactly like a form one -
    the AI never invents prices or item names, it only picks real menu ids this function checks.
    Commerce v2: active specials auto-price matching items, one promo code + one reward
    redemption per order (both re-validated here, never trusted from the client), ingredients
    deducted from the flat-file inventory, points banked on the phone account, and the whole
    sale lands in data/ledger.jsonl for the EOM reports."""
    if not s.get('orderingOpen'): raise OrderError('Online ordering is closed right now.', 403)
    name = str(name or '').strip()[:40]
    phone = re.sub(r'[^\d+()\- ]', '', str(phone or ''))[:20]
    if not name or len(re.sub(r'\D', '', phone)) < 7:
        raise OrderError('Name and a valid phone are required.', 400)
    if pay_method not in ('cash', 'cashapp', 'zelle', 'stripe'): pay_method = 'cash'
    if pay_method == 'cashapp' and not s.get('payCashapp'): pay_method = 'cash'
    if pay_method == 'zelle' and not s.get('payZelle'): pay_method = 'cash'
    if pay_method == 'stripe' and not s.get('payStripe'):
        raise OrderError('Card payment is not available right now.', 400)
    now = time.time()
    ORDER_HITS[ip] = [t for t in ORDER_HITS.get(ip, []) if now - t < 600]
    if len(ORDER_HITS[ip]) >= 6:
        raise OrderError('Too many orders from this device. Please order at the window.', 429)
    idx = menu_index(load('menu.json', {}))
    specials = active_specials(s)                      # {itemId: promo} — auto special pricing
    lines, sub_c = [], 0
    for l in (items or [])[:50]:
        if not isinstance(l, dict): continue
        it = idx.get(l.get('id'))
        try: q = int(l.get('qty', 0))
        except (TypeError, ValueError): continue
        if not it or not 1 <= q <= 50: continue
        sp = specials.get(it['id'])
        pc = int(sp['priceCents']) if (sp and int(sp.get('priceCents') or 0) > 0) else int(round(float(it['price']) * 100))
        line = {'id': it['id'], 'name': it['name'], 'qty': q, 'price': pc / 100}
        if sp: line['special'] = True
        if it.get('protein'): line['protein'] = str(l.get('protein', ''))[:30]
        lines.append(line); sub_c += q * pc
    if not lines: raise OrderError('Your cart is empty.', 400)
    # ---- discounts: one promo code + one reward, both validated here, capped at the subtotal
    promo = find_promo_code(s, promo_code)
    disc_c = 0
    if promo:
        if int(promo.get('pctOff') or 0) > 0:
            disc_c += sub_c * min(100, int(promo['pctOff'])) // 100
        disc_c += max(0, int(promo.get('offCents') or 0))
    reward, points_spent = None, 0
    if reward_id and s.get('rewardsOn'):
        reward = next((r for r in s.get('rewardItems') or [] if r.get('id') == str(reward_id)), None)
        if reward and int(reward.get('points') or 0) <= 0: reward = None
    ph = ''.join(re.findall(r'\d', phone))[-10:]
    account = load('accounts.json', {}).get(ph) if len(ph) == 10 else None
    if reward and not account:
        raise OrderError('Rewards need an account - sign in at the arcade first.', 400)
    if reward:
        if int(account.get('points') or 0) < int(reward['points']):
            raise OrderError(f"Not enough points for {reward.get('name') or 'that reward'} yet.", 400)
        points_spent = int(reward['points'])
    reward_off = max(0, int((reward or {}).get('offCents') or 0))
    disc_c = min(disc_c + reward_off, sub_c)
    rate_micro = int(round(float(s.get('taxRate', 0)) * 1_000_000))
    taxed_c = sub_c - disc_c
    tax_c = (taxed_c * rate_micro + 500_000) // 1_000_000
    points_earned = 0
    if s.get('rewardsOn') and account and float(s.get('pointsPerDollar') or 0) > 0:
        points_earned = int(taxed_c / 100 * float(s['pointsPerDollar']))
    if points_spent or points_earned:
        with ACCOUNTS_LOCK:
            a = load('accounts.json', {})
            rec = a.get(ph)
            if rec:
                rec['points'] = int(rec.get('points') or 0) - points_spent + points_earned
                a[ph] = rec; save('accounts.json', a)
    with LOCK:
        orders = load('orders.json', [])
        num = (orders[-1]['number'] % 999 + 1) if orders else 1
        o = {'id': secrets.token_hex(6), 'number': num, 'ts': int(time.time()), 'name': name, 'phone': phone,
             'notes': str(notes or '')[:200], 'items': lines, 'subtotal': sub_c / 100, 'tax': tax_c / 100,
             'total': (taxed_c + tax_c) / 100, 'status': 'new', 'paid': False,
             'payMethod': pay_method, 'discount': disc_c / 100,
             'pointsEarned': points_earned, 'pointsSpent': points_spent,
             'smsConsent': {'agreed': bool(sms_consent), 'ts': int(time.time()), 'ip': ip,
                            'method': method, 'version': SMS_CONSENT_VERSION}}
        if promo: o['promo'] = {'name': promo.get('name') or promo.get('code'), 'code': promo.get('code')}
        if reward: o['reward'] = {'name': reward.get('name'), 'off': reward_off / 100}
        ORDER_HITS[ip].append(now)
        orders.append(o); save('orders.json', orders[-2000:])
        ing_used = inventory_consume(o)
    ledger_append({'type': 'sale', 'orderId': o['id'], 'num': num, 'subtotal': o['subtotal'],
                   'discount': o['discount'], 'tax': o['tax'], 'total': o['total'],
                   'payMethod': pay_method, 'promo': (promo.get('name') or promo.get('code')) if promo else '',
                   'reward': (reward.get('name') if reward else ''),
                   'pointsEarned': points_earned, 'pointsSpent': points_spent,
                   'items': [{'name': l['name'], 'qty': l['qty'], 'price': l['price']} for l in lines],
                   'ing': ing_used})
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
# ---------- assistant smarts: language, order status, problem reports, admin text alerts ----------
HELP_LOG = []              # visitor problem threads (data/help.json, flat file)
HELP_LOCK = threading.Lock()
ALERT_RATE = {}            # admin phone -> last alert ts (one burst per 90s)
SMS_DRIVER_RATE = {}       # customer phone -> last DRIVER relay ts (1 per 10 min)
SMS_HINT_RATE = {}         # customer phone -> last usage-hint reply ts (1 per 2 h)

# ---------- self-managed SMS opt-outs (compliance) ----------
# The campaign number is NOT in a Twilio Messaging Service, so once our custom webhook owns
# inbound, Twilio does NOT auto-handle STOP - we do. Every outbound path funnels through
# _sms_send(), which refuses opted-out recipients; data/sms-optouts.json is the record.

def _sms_optouts():
    return load('sms-optouts.json', {})

def _sms_is_opted_out(to):
    ph = ''.join(re.findall(r'\d', str(to or '')))[-10:]
    return len(ph) == 10 and ph in _sms_optouts()

def _sms_opt_out_set(phone, on, via='sms-keyword'):
    ph = ''.join(re.findall(r'\d', str(phone or '')))[-10:]
    if len(ph) != 10: return
    d = _sms_optouts()
    if on: d[ph] = {'ts': int(time.time()), 'via': via}
    else: d.pop(ph, None)
    save('sms-optouts.json', d)

def _sms_admin_alert(s, text):
    """Lean alert for inbound SMS problems / cancel requests: one text per 90 s to
    settings.adminPhone (same burst discipline as the chat-problem alerts)."""
    ap = _e164(s.get('adminPhone', ''))
    if not (s.get('adminSmsAlerts', True) and ap):
        return False
    if time.time() - ALERT_RATE.get(ap, 0) < 90:
        return False
    ALERT_RATE[ap] = time.time()
    try:
        out = _sms_send(ap, ('EL OTRO LADO: ' + text)[:320])
        return bool((out or {}).get('sid') or (out or {}).get('ok'))
    except Exception:
        return False

def cancel_order(o, by, reason=''):
    """Shared cancel path - admin button, SMS keyword automation, chat. Flips to cancelled
    exactly once, restores ingredients, un-banks points, writes the void ledger event.
    Returns True only for the call that actually flipped the order."""
    if o.get('status') == 'cancelled':
        return False
    was = o.get('status')
    o['status'] = 'cancelled'
    o['cancelledBy'] = by
    if reason: o['cancelReason'] = str(reason)[:200]
    used_back = inventory_restore(o)
    reverse_order_rewards(o)
    ledger_append({'type': 'void', 'orderId': o['id'], 'num': o.get('number'),
                   'total': o['total'], 'discount': o.get('discount') or 0,
                   'pointsReversed': {'earned': o.get('pointsEarned') or 0,
                                      'spent': o.get('pointsSpent') or 0},
                   'ing': used_back, 'by': by, 'hadStarted': bool(was in ('cooking', 'ready'))})
    return True

def _load_help():
    global HELP_LOG
    try: HELP_LOG = list(load('help.json', []))
    except Exception: HELP_LOG = []

def _save_help():
    try: save('help.json', HELP_LOG[-300:])
    except Exception: pass

def _L(lang, en, es): return es if str(lang or 'en').startswith('es') else en

def _account_lang(phone):
    """Preferred language (picked FIRST at sign-up) of a signed account, else 'en'."""
    p = re.sub(r'\D', '', str(phone or ''))[-10:]
    if len(p) != 10: return 'en'
    rec = (load('accounts.json', {}).get(p) or {})
    return 'es' if rec.get('lang') == 'es' else 'en'

def _summary(o):
    its = ' · '.join(f"{l.get('qty', 1)}x {l.get('name')}" for l in (o.get('items') or [])[:3])
    return its + ('…' if len(o.get('items') or []) > 3 else '')

_ORDER_WORDS = {
    'new':      {'en': 'received — the cooks just picked it up from the rail', 'es': 'recibido — los cocineros ya lo agarraron del riel'},
    'cooking':  {'en': 'on the griddle right now', 'es': 'en la plancha ahorita'},
    'ready':    {'en': 'READY at the window — come grab it!', 'es': '¡LISTO en la ventana — ven por él!'},
    'done':     {'en': 'picked up — hope it hit the spot', 'es': 'entregado — ojalá lo hayas disfrutado'},
    'cancelled':{'en': 'cancelled — swing by the window and we will sort it out', 'es': 'cancelado — ven a la ventana y lo resolvemos'},
}

def _recent_order_for(phone, name):
    """The visitor's most recent order (last 24h): by phone digits first, then display name."""
    p = re.sub(r'\D', '', str(phone or ''))[-10:]
    nm = str(name or '').strip().lower()
    orders = load('orders.json', [])
    recent = [o for o in orders if o.get('ts', 0) >= time.time() - 86400][-30:]
    if p:
        for o in reversed(recent):
            if re.sub(r'\D', '', o.get('phone', ''))[-10:] == p: return o
    if nm:
        for o in reversed(recent):
            if o.get('name', '').strip().lower() == nm: return o
    return None

_PROB_RE = re.compile(
    r'wrong|missing|(didn.?t|did\s+not|don.?t) ?(get|receiv\w*)|never (got|receiv\w*)|refund|complain\w*|problem\w*'
    r'|sick|cold food|dropped|spill\w*|bad taste|not (right|what i)'
    r'|problema\w*|incorrecto|no (lleg\w+|puso|me sirvi[oó]|recib\w+)|falt\w+|mal\s+sabor|enferm'
    r'|reembolso|devoluci[oó]n|algo\s+malo|con\s+lo\s+que\s+recib\w*|sali[oó]\s+mal|lleg[oó]\s+(mal|feo|ca[ií]do|fr[ií]o)', re.I)
_CANCEL_RE = re.compile(r'cancel|change|add to my|cambiar|cambie|agregar|agregue|cancelar', re.I)
_STATUS_RE = re.compile(
    r'status|estado|my order|mi pedido|how long|cu[aá]ndo|when (will|can)|ready|listo|tiempo|waiting|still waiting|tard\w+', re.I)

def _assist_classify(text):
    t = str(text or '')
    if _PROB_RE.search(t):
        return 'problem', ('cancel' if _CANCEL_RE.search(t) else 'quality')
    if _CANCEL_RE.search(t):
        return 'problem', 'cancel'      # change/cancel wishes alert the kitchen too
    if _STATUS_RE.search(t): return 'status', ''
    return 'general', ''

def _admin_alert(s, thread, o):
    """Immediate heads-up: the thread always lands in the in-app help feed, and — when the owner
    set their phone in Settings — an SMS goes out right now through the configured gateway."""
    ap = _e164(s.get('adminPhone', ''))
    if s.get('adminSmsAlerts', True) and ap and not ALERT_RATE.get(ap):
        now = time.time()
        if now - ALERT_RATE.get(ap, 0) < 90:
            thread['sms'] = 'rate-limit'
        else:
            ALERT_RATE[ap] = now
            lead = f"#{o['number']} · {o.get('name', '?')}" if o else 'no order matched'
            label = 'CANCEL/CHANGE' if thread['kind'] == 'cancel' else 'PROBLEM'
            msg = f"EL OTRO LADO {label}: {lead} — {thread['text'][:110]}"
            try:
                out = _sms_send(ap, msg[:320])
                thread['sms'] = out.get('sid', '') if isinstance(out, dict) else str(out)
            except Exception as e:
                thread['sms'] = 'failed: ' + str(e)[:80]
    else:
        thread['sms'] = 'off' if not (s.get('adminSmsAlerts', True) and ap) else 'rate-limit'

def _assist_open_problem(s, sess, vid, text, kind, o):
    th = {'id': secrets.token_hex(4), 'ts': int(time.time()), 'vid': vid, 'kind': kind,
          'name': sess.get('name') or (o or {}).get('name') or 'Visitor',
          'phone': sess.get('phone') or (o or {}).get('phone') or '',
          'orderId': (o or {}).get('id', ''), 'orderNumber': (o or {}).get('number', 0),
          'text': str(text)[:400], 'followups': [], 'status': 'open'}
    HELP_LOG.append(th); _save_help()
    if o:
        with LOCK:
            orders = load('orders.json', [])
            for oo in orders:
                if oo['id'] == o['id']:
                    oo['problem'] = {'ts': th['ts'], 'kind': kind, 'text': str(text)[:160],
                                     'helpId': th['id'], 'unseen': True}
                    save('orders.json', orders)
                    break
    _admin_alert(s, th, o)
    _save_help()          # alert stamped thread['sms'] AFTER the first flush — persist it too
    return th

def _assist_followup(sess, text, o):
    with HELP_LOCK:
        th = next((t for t in HELP_LOG if t['id'] == (sess.get('problem') or {}).get('helpId')), None)
        if th and len(th['followups']) < 8:
            th['followups'].append({'ts': int(time.time()), 'text': str(text)[:300]})
    _save_help()
    if o:
        with LOCK:
            orders = load('orders.json', [])
            for oo in orders:
                if oo['id'] == o['id'] and oo.get('problem'):
                    oo['problem']['note'] = str(text)[:160]
                    save('orders.json', orders)
                    break

def assistant_reply(s, vid, user_text, ip, lang_hint=None):
    """Handles the quick answer/diagnosis paths DETERMINISTICALLY (order status, problem
    reports → admin alert, follow-up context) so a missing table flip of the small local
    model can never drop a customer's complaint; everything else flows to the LLM loop."""
    if not s.get('aiAssistantEnabled', True): raise OrderError('The chat assistant is turned off right now.', 403)
    now = time.time()
    with ASSISTANT_LOCK:
        if now - ASSISTANT_RATE.get(vid, 0) < 2.5: raise OrderError('Slow down a bit.', 429)
        ASSISTANT_RATE[vid] = now
    sess = assistant_session(vid)
    # language: account preference (picked first at sign-up) wins; guests send a hint
    lang = (_account_lang(sess.get('phone')) if sess.get('phone')
            else (lang_hint if lang_hint in ('en', 'es') else 'en'))
    sess.setdefault('problem', {})
    open_prob = sess['problem'] if (sess['problem'] and now - sess['problem'].get('ts', 0) < 1500) else None
    cls, kind = _assist_classify(user_text)
    o = _recent_order_for(sess.get('phone'), sess.get('name'))

    def bail(reply):   # log + return without touching the model
        sess['messages'].append({'role': 'assistant', 'content': reply})
        return {'reply': reply, 'cart': sess['cart'], 'name': sess['name'], 'phone': sess['phone'], 'lang': lang}

    # ---- problem report (chip: "Something is wrong with what I received!") ----
    if cls == 'problem':
        sess['messages'].append({'role': 'user', 'content': user_text[:400]})
        sess['messages'] = sess['messages'][-ASSISTANT_MAX_TURNS:]
        th = _assist_open_problem(s, sess, vid, user_text, kind, o)
        sess['problem'] = {'ts': now, 'helpId': th['id'], 'kind': kind}
        num = f" #{o['number']}" if o else ''
        if not o:
            reply = _L(lang, "I couldn't match that to an active order — what's the name or phone number on it? "
                             "I'll flag it for the team either way, and they'll sort it out with you.",
                             "No encontré un pedido abierto para ese reporte — ¿a qué nombre o número está? "
                             "Igual lo marco para el equipo y lo resolvemos contigo.")
        elif kind == 'cancel':
            reply = _L(lang, f"Got it{num} — I flagged it and texted the team right away. "
                             "What exactly would you like changed or removed?",
                             f"Entendido{num} — lo marqué y le mandé mensaje al equipo ahorita. "
                             "¿Qué exactamente quieres cambiar o quitar?")
        else:
            reply = _L(lang, f"I'm so sorry about that! 🙏{num} I flagged it and texted the team immediately — "
                             "they will make it right. Tell me exactly what went wrong (wrong item, something "
                             "missing, or it arrived spilled/cold?) and I'll pass every word along.",
                             f"¡Qué feo, lo siento mucho! 🙏{num} Lo marqué y le mandé mensaje al equipo en "
                             "seguida — van a poner remedio. Dime exactamente qué salió mal (¿un platillo "
                             "equivocado, algo que faltó, o llegó caído/frío?) y les transmito cada palabra.")
        return bail(reply)

    # ---- order status (chip: "What is the status of my order?") — real order state ----
    if cls == 'status':
        sess['messages'].append({'role': 'user', 'content': user_text[:400]})
        sess['messages'] = sess['messages'][-ASSISTANT_MAX_TURNS:]
        if o:
            w = _ORDER_WORDS.get(o.get('status', 'new'), {})
            reply = _L(lang, f"Order #{o['number']} ({_summary(o)}) — {w.get('en', o.get('status'))}. Anything else?",
                       f"Pedido #{o['number']} ({_summary(o)}) — {w.get('es', o.get('status'))}. ¿Algo más?")
        else:
            reply = _L(lang, "You don't have an active order with us yet — tell me what you're craving and I'll start one!",
                       "¡Todavía no tienes un pedido con nosotros — dime qué se te antoja y lo empezamos!")
        return bail(reply)

    # ---- follow-up detail while a problem thread is open ----
    if open_prob and cls == 'general' and len(user_text) >= 6:
        sess['messages'].append({'role': 'user', 'content': user_text[:400]})
        sess['messages'] = sess['messages'][-ASSISTANT_MAX_TURNS:]
        _assist_followup(sess, user_text, o)
        sess['problem']['ts'] = now               # keep the follow-up window rolling
        return bail(_L(lang, "Thank you — I've added those details to the report so the team can fix it fast. "
                             "Anything else I should pass along?",
                             "Gracias — ya agregué esos detalles al reporte para que el equipo lo arregle rápido. "
                             "¿Hay algo más que deba transmitirles?"))

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
    if open_prob:
        sys_prompt += f"\n\nContext: the visitor reported a problem {int(now - (open_prob.get('ts') or now))}s ago " \
                      f"({_L(lang, 'report text', 'texto del reporte')}: {(open_prob.get('text') or '')[:160]!r}) — " \
                      "be warm, be brief; apologize once and reassure them the team was already texted."
    sys_prompt += ("\n\nIMPORTANT: reply in " + ("Spanish" if lang == 'es' else 'English') +
                   " — that is the language this visitor chose at sign-up (switch only if they write "
                   "clearly in the other one). Keep menu item names exactly as written.")
    sess['messages'].append({'role': 'user', 'content': user_text[:400]})
    sess['messages'] = sess['messages'][-ASSISTANT_MAX_TURNS:]
    messages = [{'role': 'system', 'content': sys_prompt}] + sess['messages']

    with ASSISTANT_SEM:
        for _ in range(4):   # bounded tool-call loop
            try:
                raw, _ = http_json(s['ollamaUrl'].rstrip('/') + '/api/chat', {
                    'model': s.get('aiAssistantModel') or 'qwen3:1.7b', 'stream': False,
                    'messages': messages, 'tools': ASSISTANT_TOOLS}, 45)
            except Exception:
                break       # model/gateway down → fall through to the localized "having trouble" bail below
            resp = json.loads(raw).get('message', {})
            tool_calls = resp.get('tool_calls') or []
            messages.append({'role': 'assistant', 'content': resp.get('content', ''), 'tool_calls': tool_calls})
            if not tool_calls:
                reply = resp.get('content', '').strip() or _L(lang, "Sorry, could you say that again?",
                                                              "Perdón, ¿me lo puedes repetir?")
                sess['messages'].append({'role': 'assistant', 'content': reply})
                return {'reply': reply, 'cart': sess['cart'], 'name': sess['name'], 'phone': sess['phone'], 'lang': lang}
            for tc in tool_calls:
                fn = tc.get('function', {})
                result = run_assistant_tool(sess, menu, s, ip, fn.get('name'), fn.get('arguments') or {})
                messages.append({'role': 'tool', 'content': json.dumps(result)})
    reply = _L(lang, "Sorry, I'm having trouble right now - try the menu above, or order at the window.",
               "Perdón, ahorita tengo problema - usa el menú de arriba, o ordena en la ventana.")
    sess['messages'].append({'role': 'assistant', 'content': reply})
    return {'reply': reply, 'cart': sess['cart'], 'name': sess['name'], 'phone': sess['phone'], 'lang': lang}

class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(self, fmt, *a): pass
    # ---------- cache headers ----------
    # Without an origin policy Cloudflare gives .js/.css a 4-hour edge TTL and browsers cache the
    # HTML heuristically, so a deploy kept serving the previous scene.js even after a ?v= bump.
    # Default every response to no-cache (cheap Last-Modified revalidation); handlers that pick
    # their own policy (send_json -> no-store) win because their header is already sent.
    def send_header(self, keyword, value):
        if keyword.lower() == 'cache-control': self._sent_cc = True
        super().send_header(keyword, value)
    def end_headers(self):
        if not getattr(self, '_sent_cc', False):
            top = self.path.split('?', 1)[0].lstrip('/').split('/', 1)[0]
            cc = 'public, max-age=86400' if top in ('lib', 'bling', 'gfx', 'media', 'img') else 'public, max-age=3600' if top == 'tex' else 'no-cache'
            super().send_header('Cache-Control', cc)
        self._sent_cc = False
        super().end_headers()

    # ---------- static-file safety ----------
    PUBLIC_DIRS = ('lib', 'tex', 'img', 'js', 'css', 'media', 'bling', 'gfx', 'models')
    PUBLIC_FILES = ('index.html', 'admin.html', 'mobile.html', 'favicon.ico', 'robots.txt')
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
    LITE_PATHS = ('/', '/index.html', '/order', '/checkout', '/sms-optin', '/menu')
    def page_for(self, p):
        """The HTML file a page-like path maps to (GET and HEAD share this): the lite page on /mobile and, on the m. host, on every
        index alias; /admin; and the 3D index for its deep-link aliases and /3d."""
        if p == '/mobile' or (p in self.LITE_PATHS and self.mobile_host()): return '/mobile.html'
        if p == '/admin': return '/admin.html'
        if p in ('/order', '/checkout', '/sms-optin', '/menu', '/3d'): return '/index.html'
        return None
    def mobile_host(self):
        """True on the m. hostname: same server and API, but / serves the lite page (no three.js)."""
        h = (self.headers.get('Host') or '').strip().lower()
        return h in MOBILE_HOSTS or h.split(':')[0] in MOBILE_HOSTS
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
        request didn't present it. Twilio's webhook can't send a password, so it's exempt;
        so are the other machine-to-machine + checkout paths (Stripe's webhook + redirect
        flow, rewards balance lookup) that could never carry a site password."""
        if p == '/api/sms/inbound' or p == '/api/stripe/webhook' or p == '/api/checkout/stripe':
            return False
        if p.startswith('/api/rewards/'):
            return False
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
        """Twilio inbound-SMS webhook - the number's SmsUrl points here (SMS_INBOUND_PUBLIC_URL).
        Validates the signature, then routes the keyword. The number is NOT in a Messaging
        Service, so Twilio does NOT auto-handle keywords - this router owns compliance:
          bare STOP/UNSUBSCRIBE/...  -> permanent opt-out (data/sms-optouts.json, honored by
                                       every outbound send through _sms_send)
          bare START/YES             -> re-subscribe
          HELP/INFO/AYUDA           -> campaign help text
          DRIVER/CONDUCTOR/CHOFER    -> relay to settings.driverPhone (1 per 10 min)
          cancel prose ("cancel my order"): not started -> AUTO-CANCELLED (ingredients
                                       restocked, points reversed, void ledgered, admin told);
                                       already cooking/ready -> admin alert + make-it-right
          PROBLEM/ISSUE/...          -> flags the order for the admin feed + admin text
          STATUS/ESTADO/PEDIDO       -> the texter's latest open order status
        Replies ride the TwiML response itself (atomic, loop-safe); cross-number forwards go
        through _sms_send. Every inbound is audit-logged to data/sms-inbound.jsonl."""
        n = int(self.headers.get('Content-Length') or 0)
        if n > 20_000:
            self.send_response(400); self.end_headers(); return
        raw = self.rfile.read(n)
        params = {k: v[0] for k, v in parse_qs(raw.decode('utf-8', 'replace')).items()}
        if not _twilio_signature_valid(self.headers.get('X-Twilio-Signature', ''), params):
            self.send_response(403); self.end_headers(); return

        def twiml(text=''):
            inner = f'<Message>{_xml_escape(text)}</Message>' if text else ''
            b = f'<?xml version="1.0" encoding="UTF-8"?><Response>{inner}</Response>'.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/xml')
            self.send_header('Content-Length', str(len(b)))
            self.end_headers(); self.wfile.write(b)

        body = str(params.get('Body') or '').strip()[:400]
        frm = str(params.get('From') or '')
        ph = ''.join(re.findall(r'\d', frm))[-10:]
        now = time.time()
        s = {**DEFAULT_SETTINGS, **load('settings.json', {})}
        digits = lambda x: ''.join(re.findall(r'\d', str(x or '')))[-10:]

        def log_in(action, reply=''):
            try:
                with LEDGER_LOCK:
                    with open(os.path.join(DATA, 'sms-inbound.jsonl'), 'a') as f:
                        f.write(json.dumps({'ts': int(now), 'from': frm, 'body': body[:200],
                                            'action': action, 'reply': (reply or '')[:200]}) + '\n')
            except OSError:
                pass

        def latest_order(open_only=True):
            for o in reversed(load('orders.json', [])):
                if digits(o.get('phone')) == ph:
                    if (not open_only) or o.get('status') in ('new', 'cooking', 'ready'):
                        return o
            return None

        # loop guard: never react to our own senders / admin / driver phones
        if not ph or ph in {d for d in (digits('2525469420'), digits(s.get('adminPhone')),
                                       digits(s.get('driverPhone')), digits(_e164(s.get('twilioFrom') or '')))
                           if len(d) == 10}:
            log_in('self-ignored', '')
            return twiml()

        w = re.sub(r'[^A-Z0-9 ]', ' ', body.upper())
        # ---- compliance keywords (bare) ----
        if re.fullmatch(r'\s*(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT|SALIR|DESUSCRIBIR\S*)\s*', w):
            _sms_opt_out_set(ph, True, 'sms-keyword')
            log_in('opt-out', '')
            return twiml('El Otro Lado: unsubscribed - no more texts. Reply START to re-subscribe.')
        if re.fullmatch(r'\s*(START|UNSTOP|YES|SI)\s*', w):
            _sms_opt_out_set(ph, False, 'sms-keyword')
            log_in('opt-in', '')
            return twiml('El Otro Lado: welcome back! Order-ready texts are on again.')
        if re.fullmatch(r'\s*(HELP|INFO|AYUDA|MORE INFO)\s*', w):
            log_in('help', '')
            return twiml('El Otro Lado alerts: 1 text when your order is ready. Reply STATUS for your '
                         'order, PROBLEM if something is wrong, DRIVER to reach the driver, STOP to '
                         'opt out. Msg&data rates may apply.')
        # ---- DRIVER relay ----
        if re.search(r'\b(DRIVER|CONDUCTOR|CHOFER)\b', w):
            o = latest_order()
            dp = _e164(s.get('driverPhone', ''))
            rate_ok = now - SMS_DRIVER_RATE.get(ph, 0) > 600
            if dp and rate_ok:
                SMS_DRIVER_RATE[ph] = now
                try:
                    _sms_send(dp, f"Customer {('#' + str(o['number'])) if o else '(no order)'} "
                                  f"({frm}): {body[:220]}")
                except Exception:
                    pass
                log_in('driver-relay', '')
                return twiml('Sent to the driver! They will text or call you back.')
            log_in('driver-' + ('rate-limit' if not rate_ok else 'unconfigured'), '')
            return twiml('The driver line is not set up yet - call the window for anything urgent.')
        # ---- cancel automation: prose cancel ("cancel my order", not the bare keyword) ----
        if re.search(r'\b(CANCEL|CANCELA|CHANGE|CAMBIA|FORGET|SCRAP)\w*', w):
            o = latest_order()   # open orders only (new/cooking/ready) - anything else isn't cancellable
            if o and o.get('status') == 'new':
                with LOCK:
                    orders = load('orders.json', [])
                    for oo in orders:
                        if oo['id'] == o['id']:
                            if cancel_order(oo, 'sms-automation', body):   # restocks + reverses + ledger-voids
                                save('orders.json', orders)
                            break
                _sms_admin_alert(s, f"#{o['number']} auto-cancelled by text (nothing started): {body[:110]}")
                log_in('auto-cancel', f"order #{o['number']}")
                return twiml(f"Cancelled - order #{o['number']}, nothing had started. No charge. See you next time!")
            if o and o.get('status') in ('cooking', 'ready'):
                _sms_admin_alert(s, f"CANCEL REQUEST #{o['number']} (already {o['status']}) · {o.get('name', '?')} · {frm}: {body[:110]}")
                log_in('cancel-request-started', f"order #{o['number']}")
                return twiml(f"The kitchen already started order #{o['number']} - I flagged your cancel "
                            f"request to the owner; they will make it right at the window.")
            log_in('cancel-no-open-order', '')
            return twiml('No open order found for this number - reply PROBLEM and we will sort it out.')
        # ---- problem report ----
        if re.search(r'\b(PROBLEM|ISSUE|WRONG|MISSING|BURNT?|COLD|MESSED|PROBLEMA|MAL|EQUIVOCADO)\b\S*', w):
            o = latest_order(open_only=False)
            if o:
                with LOCK:
                    orders = load('orders.json', [])
                    for oo in orders:
                        if oo['id'] == o['id']:
                            oo['problem'] = {'kind': 'other', 'text': body[:300], 'unseen': True,
                                             'ts': int(now), 'via': 'sms'}
                            save('orders.json', orders)
                            break
                _sms_admin_alert(s, f"#{o['number']} · {o.get('name', '?')} texted: {body[:110]}")
            else:
                _sms_admin_alert(s, f"text from {frm} (no order matched): {body[:110]}")
            log_in('problem', '')
            return twiml('Got it - the kitchen has been flagged. Someone will make it right at the window. '
                         'Reply DRIVER to reach the driver.')
        # ---- status ----
        if re.search(r'\b(STATUS|ESTADO|ORDER|PEDIDO|WHERE)\b', w):
            o = latest_order()
            states = {'new': 'received - in the queue', 'cooking': 'cooking now',
                      'ready': 'READY - come to the window!'}
            log_in('status' if o else 'status-none', '')
            if o:
                return twiml(f"El Otro Lado: order #{o['number']} is {states.get(o['status'], o['status'])}. "
                            f"We text you the moment it is ready.")
            return twiml('El Otro Lado: no open order found for this number. Reply PROBLEM if something '
                         'is wrong with a pickup today.')
        # ---- anything else: one usage hint per number per 2 h (loop-safe) ----
        if now - SMS_HINT_RATE.get(ph, 0) > 7200:
            SMS_HINT_RATE[ph] = now
            log_in('hint', '')
            return twiml('El Otro Lado: reply STATUS for your order, PROBLEM if something is wrong, or '
                         'DRIVER to reach the driver. STOP opts out.')
        log_in('hint-suppressed', '')
        return twiml()

    def handle_upload_media(self):
        """Admin-only upload for the truck's boombox music / TV monitor video / header brand logo (see scene.js).
        Body is JSON {kind:'audio'|'video'|'image', filename, data:<base64>} - there's no multipart
        parser anywhere else in this server, so this matches the rest of the API: JSON in,
        JSON out. Caps are generous but bounded so one upload can't fill the disk."""
        LIMITS = {'audio': 20_000_000, 'song': 20_000_000, 'video': 60_000_000, 'image': 3_000_000}   # decoded-file byte caps
        EXT_OK = {'audio': ('.mp3', '.m4a', '.ogg', '.wav'), 'song': ('.mp3', '.m4a', '.ogg', '.wav'),
                  'video': ('.mp4', '.webm', '.mov'),
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
        if kind == 'image': shrink_image(os.path.join(MEDIA, fname), 512)   # the logo shows at ~1.5em; nobody needs the 3MB original
        if kind == 'song':
            # jukebox catalog track: just land in media/ — the Settings → Jukebox row points at
            # it, so unlike audio/video/image there's no single settings slot to replace
            return self.send_json({'ok': True, 'file': fname})
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
        pg = self.page_for(p)
        if pg == '/mobile.html': p = self.path = pg   # lite ordering page: no three.js, no games
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
            with GIFT_LOCK:
                pending = load('gifts.json', {}).get(myid, []) or []
                # claim-on-read: move pending gifts into the response so the client can apply them
            with CHAT_LOCK:
                chat = [m for m in CHAT if m['ts'] > since]
            return self.send_json({'others': others, 'chat': chat, 'now': now,
                                   'gifts': pending})
        if p == '/api/jukebox':        # 🎵 public: what's playing for EVERYONE (+ catalog) — the client poll that syncs the lot
            s = {**DEFAULT_SETTINGS, **load('settings.json', {})}
            with LOCK:
                j = load('jukebox.json', {'now': None, 'queue': []})
                if _jukebox_advance(j, _juke_play_secs(s)):
                    save('jukebox.json', j)
            nowj = j.get('now')
            return self.send_json({'on': bool(s.get('jukeboxOn', True)),
                                   'songs': [{'title': str(r.get('title') or r.get('file')),
                                              'file': str(r.get('file') or ''), 'cost': int(r.get('cost') or 0)}
                                             for r in (s.get('jukeboxSongs') or []) if r.get('file')],
                                   'now': ({'file': nowj['file'], 'title': nowj.get('title'), 'by': nowj.get('by'),
                                            'at': nowj['at'],
                                            'left': max(0, int(_juke_play_secs(s) - (time.time() - nowj['at'])))}
                                           if nowj else None),
                                   'queue': len(j.get('queue') or [])})
        if p == '/api/caches':         # 🗺️ public geocache pins (fuzzed ±2m; your own come back exact via ?phone=)
            s = {**DEFAULT_SETTINGS, **load('settings.json', {})}
            qs = parse_qs(urlparse(self.path).query)
            mine = ''.join(re.findall(r'\d', (qs.get('phone') or [''])[0]))[-10:]
            rows = load('geocaches.json', [])
            out = []
            for c in rows:
                own = bool(mine and c.get('phone') == mine)
                fx, fz = (c['x'], c['z']) if own else _geo_fuzz(c['id'], c['x'], c['z'])
                founds = c.get('founds') or []
                out.append({'id': c['id'], 'x': fx, 'z': fz, 'by': c.get('by') or 'A visitor',
                            'note': c.get('note') or '', 'at': c.get('at'),
                            'prize': (c.get('prize') or {}).get('label') if not founds else None,
                            'found': len(founds),
                            'first': (founds[0] or {}).get('name') if founds else None,
                            'mine': own,
                            'iFound': bool(mine and any(f.get('phone') == mine for f in founds))})
            return self.send_json({'on': bool(s.get('geocacheOn', True)), 'caches': out})
        if p.startswith('/api/account/who'):        # public profile lookup: phone IS the account
            qs = parse_qs(urlparse(self.path).query)
            phone = ''.join(re.findall(r'\d', (qs.get('phone') or [''])[0]))[-10:]
            a = load('accounts.json', {})
            rec = a.get(phone)
            if not rec: return self.send_json({'error': 'No account yet — sign in at the arcade.'}, 404)
            return self.send_json({'phone': phone, 'name': rec.get('name', 'Guest'),
                                   'prizes': rec.get('prizes', []), 'wins': rec.get('wins', {}),
                                   'points': rec.get('points', 0), 'created': rec.get('created'),
                                   'lang': rec.get('lang', 'en'), 'rep': int(rec.get('rep', 0)),
                                   'sprouts': rec.get('sprouts', [])})
        if p == '/api/account/shop':                # redeem catalog for trivia points
            return self.send_json({'items': SHOP_ITEMS, 'race': {'window': TRIVIA_OPEN_S, 'pts': [5, 3, 2, 1]}})
        if p == '/api/scores':                      # ⛹ feeds the HIGH SCORES board by the truck
            out = {}
            for g in SCORE_GAMES:
                s = SCORES.get(g) or {}
                out[g] = {'best': s.get('best'), 'last': s.get('last'), 'rows': (s.get('rows') or [])[-10:]}
            for gsrc in ('claw', 'c4', 'ttt', 'pin'):
                n, v = _holder_most(gsrc)
                out[gsrc]['holder'] = {'name': n, 'wins': v} if n else None
            n, v = _holder_most('total')
            out['collection'] = {'holder': n, 'count': v} if n else None
            n, v = _holder_most('points')
            out['points'] = {'holder': n, 'points': v} if n else None
            return self.send_json(out)
        if p == '/api/menu':
            m = load('menu.json', {})
            for k in ('taxNote', 'priceSource'): m.pop(k, None)   # internal notes, not for the public site
            s = {**DEFAULT_SETTINGS, **load('settings.json', {})}
            sp = active_specials(s)
            m['categories'] = [{**c, 'items': [i for i in c.get('items', []) if not i.get('hidden')]} for c in m.get('categories', []) if not c.get('hidden')]
            if sp:   # specials show their live price right on the menu card
                for c in m['categories']:
                    for i in c['items']:
                        row = sp.get(i['id'])
                        if row: i['specialCents'] = int(row['priceCents'])
            for c in m['categories']:   # the panel shows photos at 56px: send the downsized copies
                for i in c['items']:
                    if i.get('image'): i['image'] = public_image(i['image'])
            return self.send_json(m)
        if p == '/api/settings':   # public: business info only, never internal service config
            s = {**DEFAULT_SETTINGS, **load('settings.json', {})}
            return self.send_json({k: s.get(k) for k in PUBLIC_SETTINGS})
        if p.startswith('/api/order/'):
            oid = p.rsplit('/', 1)[-1]
            o = next((o for o in load('orders.json', []) if o['id'] == oid), None)
            return self.send_json({'id': oid, 'status': o['status']} if o else {'error': 'not found'}, 200 if o else 404)
        if p.startswith('/api/rewards/'):   # checkout shows the phone's points balance live
            ph = ''.join(re.findall(r'\d', p.rsplit('/', 1)[-1]))[-10:]
            rec = load('accounts.json', {}).get(ph) if len(ph) == 10 else None
            return self.send_json({'phone': ph, 'points': int(rec.get('points') or 0) if rec else 0,
                                   'name': (rec.get('name') if rec else '')})
        if p.startswith('/api/admin/'):
            if not self.authed(): return self.send_json({'error': 'unauthorized'}, 401)
            if p == '/api/admin/menu': return self.send_json(load('menu.json', {}))
            if p == '/api/admin/inventory': return self.send_json(get_inventory())
            if p == '/api/admin/report':
                q = parse_qs(urlparse(self.path).query).get('month', [''])[0]
                month = re.sub(r'[^0-9\-]', '', q) or time.strftime('%Y-%m')
                if not re.match(r'^\d{4}-\d{2}$', month): month = time.strftime('%Y-%m')
                return self.send_json(build_report(month))
            if p == '/api/admin/outreach': return self.send_json(get_outreach())
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
            if p == '/api/admin/help':
                # Visitor problem threads from the chat assistant (chips like "Something is
                # wrong with what I received!"). Newest first; the admin badge/banner polls it.
                with HELP_LOCK:
                    return self.send_json({'threads': sorted(HELP_LOG, key=lambda t: -t['ts'])[-60:]})
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
        if p in ('/order', '/checkout', '/sms-optin', '/menu', '/3d'): self.path = '/index.html'   # /3d = the full 3D site on the m. host (its lite chip links back to /)
        if not self.static_allowed(): return self.send_error(404)
        return super().do_GET()

    def do_HEAD(self):
        p = urlparse(self.path).path
        if self.site_gated(p): return
        pg = self.page_for(p)
        if pg: self.path = pg
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

        if p == '/api/stripe/webhook':   # needs the RAW body for the signature check, so it can't go through body()
            n = int(self.headers.get('Content-Length') or 0)
            if n > 200_000: return self.send_json({'error': 'too large'}, 400)
            raw = self.rfile.read(n) or b''
            s = {**DEFAULT_SETTINGS, **load('settings.json', {})}
            if not stripe_verify_webhook(raw, self.headers.get('Stripe-Signature') or '',
                                         str(s.get('stripeWebhookSecret') or '')):
                return self.send_json({'error': 'bad signature'}, 400)
            try: ev = json.loads(raw.decode() or '{}')
            except json.JSONDecodeError: return self.send_json({'error': 'bad payload'}, 400)
            if ev.get('type') == 'checkout.session.completed':
                obj = (ev.get('data') or {}).get('object') or {}
                oid = (obj.get('metadata') or {}).get('orderId') or obj.get('client_reference_id')
                with LOCK:
                    orders = load('orders.json', [])
                    for o in orders:
                        if o['id'] == oid and not o.get('paid'):
                            o['paid'] = True; o['paidLogged'] = True
                            save('orders.json', orders)
                            ledger_append({'type': 'payment', 'orderId': oid, 'num': o.get('number'),
                                           'method': 'stripe', 'amount': o['total'], 'by': 'stripe-webhook'})
                            break
            return self.send_json({'received': True})

        if p == '/api/admin/restore' and not self.authed(): return self.send_json({'error': 'unauthorized'}, 401)   # auth before reading 90 MB
        try:
            if p == '/api/admin/restore':
                data = self.body_large(90_000_000)
            else:
                data = self.body()
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
                    if prf.get('face') in FACES: prof['face'] = prf.get('face')
                    if isinstance(prf.get('bling'), list):   # worn collectibles (cosmetic): known ids only, one per slot
                        seen, wb = set(), []
                        for b in prf['bling'][:8]:
                            it = BLING_MAP.get(str(b))
                            if it and it['slot'] not in seen: seen.add(it['slot']); wb.append(it['id'])
                        prof['bling'] = wb
                    # 🌱 sprouts clipped to this avatar ride along in the profile so everyone sees them
                    if isinstance(prf.get('sprouts'), list):
                        sp_ok = []
                        for sp in prf['sprouts'][:8]:   # rebuilt from known fields only (it is re-sent to every visitor)
                            if not isinstance(sp, dict): continue
                            row = SHOP_MAP.get(str(sp.get('item', '')))
                            if not row or not row.get('sprout') or sp.get('slot') not in BLING_SLOTS: continue
                            sp_ok.append({'slot': sp['slot'], 'item': row['item'], 'from': _clean(str(sp.get('from') or ''))[:40]})
                        prof['sprouts'] = sp_ok
                    if prof: e['profile'] = prof
                    elif 'profile' in e: e.pop('profile')   # emptied = back to the random character look
            name = _clean(NAME_RE.sub('', str(data.get('name', '')))).strip()[:24]   # 🧼 names are family-facing too
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
            text = _clean(re.sub(r'[\x00-\x1f\x7f]', '', str(data.get('text', ''))).strip())[:140]   # 🧼 censored
            if not myid or not text: return self.send_json({'error': 'bad request'}, 400)
            now = time.time()
            with CHAT_LOCK:
                if now - CHAT_RATE.get(myid, 0) < 3: return self.send_json({'error': 'Slow down a bit.'}, 429)
                CHAT_RATE[myid] = now
                hue = PRESENCE.get(myid, {}).get('hue', character_hue(myid))
                msg = {'id': myid, 'name': _clean(character_name(myid, hue)), 'hue': hue, 'text': text, 'ts': now}
                CHAT.append(msg)
                del CHAT[:-CHAT_MAX]
            with PRESENCE_LOCK:   # a chat message is also a heartbeat - no need to wait for the next ping
                e = PRESENCE.get(myid)
                if e: e['ts'] = now
            phone = ''.join(re.findall(r'\d', str(data.get('phone', ''))))[-10:]
            gained = _trivia_answer_check(myid, text, msg.get('name'), phone)   # 🤖 points per correct guess
            return self.send_json({'ok': True, **({'gained': gained} if gained is not None else {})})

        # ---------- arcade accounts (flat-file; the phone number IS the account number) ----------
        # data/accounts.json: { "10-digit phone": {name, created, points, prizes:[{item,name,src,count,got}], wins:{game:n}} }
        # The owner asked deliberately for "simple now": no OTP/verification flow yet — the phone
        # field behaves like a festival wristband number (keep it private-ish, don't expose to
        # other visitors). Points come from trivia (per-user, once per question); arcade minigames
        # mint prizes directly; points redeemed below buy SHOP collectibles.
        if p == '/api/account/enter':
            with ACCOUNTS_LOCK:   # whole read-modify-write under the lock (a stale save would drop other writes)
                a = load('accounts.json', {})
                phone = ''.join(re.findall(r'\d', str(data.get('phone', ''))))[-10:]
                lang = 'es' if str(data.get('lang', '')).lower().startswith('es') else 'en'
                name = _clean(NAME_RE.sub('', str(data.get('name', '')).strip()))[:40]   # 🧼 family-facing scoreboard name
                if len(phone) != 10: return self.send_json({'error': 'Enter a 10-digit phone number'}, 400)
                if not name: return self.send_json({'error': 'Pick a display name — it shows on the scoreboard!'}, 400)
                rec = a.setdefault(phone, {'created': int(time.time())})   # missing key MUST insert into a
                if name: rec['name'] = name
                rec.setdefault('name', 'Guest')
                rec['lang'] = lang                        # language picked FIRST at sign-up — everything else follows
                rec.setdefault('prizes', []); rec.setdefault('wins', {}); rec.setdefault('points', 0)
                rec.setdefault('sprouts', [])   # 🌱 festival sprouts currently clipped to this avatar
                with ACCOUNTS_LOCK: save('accounts.json', a)
                return self.send_json({'ok': True, 'phone': phone, 'name': rec['name'], 'lang': lang,
                                       'prizes': rec['prizes'], 'wins': rec['wins'], 'points': rec['points'], 'rep': int(rec.get('rep', 0))})
        if p == '/api/account/lang':                # the language picked FIRST at sign-up is updatable later
            with ACCOUNTS_LOCK:   # whole read-modify-write under the lock (a stale save would drop other writes)
                a = load('accounts.json', {})
                phone = ''.join(re.findall(r'\d', str(data.get('phone', ''))))[-10:]
                lang = 'es' if str(data.get('lang', '')).lower().startswith('es') else 'en'
                if len(phone) != 10: return self.send_json({'error': 'bad request'}, 400)
                rec = a.get(phone)
                if not rec: return self.send_json({'error': 'No account yet — sign in at the arcade.'}, 404)
                rec['lang'] = lang
                with ACCOUNTS_LOCK: save('accounts.json', a)
                return self.send_json({'ok': True, 'phone': phone, 'lang': lang})
        if p == '/api/account/prize':
            with ACCOUNTS_LOCK:   # whole read-modify-write under the lock (a stale save would drop other writes)
                a = load('accounts.json', {})
                phone = ''.join(re.findall(r'\d', str(data.get('phone', ''))))[-10:]
                item = re.sub(r'[^\w\-]', '', str(data.get('item', '')))[:40]
                label = str(data.get('label', ''))[:48]
                src = re.sub(r'[^\w\-]', '', str(data.get('src', 'game')))[:12]
                if len(phone) != 10 or not item:
                    return self.send_json({'error': 'bad request'}, 400)
                if item in SHOP_MAP or item in BLING_MAP:   # shop collectibles / sprouts only via /api/account/redeem (costs points)
                    return self.send_json({'error': 'bad request'}, 400)
                rec = a.setdefault(phone, {'created': int(time.time()), 'name': 'Guest',
                                           'prizes': [], 'wins': {}, 'points': 0})
                rows = rec.setdefault('prizes', [])
                rec.setdefault('sprouts', [])   # 🌱 gift attachments ride the account too
                row = next((e for e in rows if e.get('item') == item), None)
                if row: row['count'] = row.get('count', 1) + 1
                else: rows.append({'item': item, 'name': label or 'Mystery prize', 'src': src,
                                   'count': 1, 'got': int(time.time())})
                if src: rec.setdefault('wins', {})[src] = rec['wins'].get(src, 0) + 1
                with ACCOUNTS_LOCK: save('accounts.json', a)
                if src in ('claw', 'pin'):              # label-bearing mints also feed the score ring
                    _score_record(src, rec.get('name', 'Guest'), 1, rows[-1]['name'])
                return self.send_json({'ok': True, 'phone': phone, 'name': rec.get('name', 'Guest'),
                                       'prizes': rows, 'wins': rec['wins'], 'points': rec.get('points', 0),
                                       'won': {'item': item, 'name': label or 'Mystery prize'}})
        if p == '/api/account/redeem':              # spend trivia points on SHOP collectibles
            with ACCOUNTS_LOCK:   # whole read-modify-write under the lock (a stale save would drop other writes)
                a = load('accounts.json', {})
                phone = ''.join(re.findall(r'\d', str(data.get('phone', ''))))[-10:]
                item = re.sub(r'[^\w\-]', '', str(data.get('item', '')))[:40]
                row = SHOP_MAP.get(item)
                if len(phone) != 10 or not row: return self.send_json({'error': 'bad request'}, 400)
                rec = a.setdefault(phone, {'created': int(time.time()), 'name': 'Guest',
                                           'prizes': [], 'wins': {}, 'points': 0})
                pts = rec.setdefault('points', 0)
                if pts < row['cost']:
                    return self.send_json({'error': 'Not enough points — ' + str(row['cost'] - pts) +
                                           ' more to go. Answer trivia in chat!'}, 402)
                rec['points'] = pts - row['cost']
                rows = rec.setdefault('prizes', [])
                ex = next((e for e in rows if e.get('item') == item), None)
                if ex: ex['count'] = ex.get('count', 1) + 1
                else: rows.append({'item': item, 'name': row['label'], 'src': 'trivia',
                                   'count': 1, 'got': int(time.time())})
                with ACCOUNTS_LOCK: save('accounts.json', a)
                return self.send_json({'ok': True, 'points': rec['points'], 'prizes': rows,
                                       'wins': rec.get('wins', {}),
                                       'won': {'item': item, 'name': row['label']}})
        if p == '/api/score':                       # ⛹ minigame + contest result reporting (no account needed)
            s = {**DEFAULT_SETTINGS, **load('settings.json', {})}
            if not _game_allowed(s, data.get('game')):
                return self.send_json({'ok': True})   # switched off in Settings → Games: drop silently
            _score_record(data.get('game'), _score_name(data), data.get('value'), data.get('label'))
            return self.send_json({'ok': True})

        if p == '/api/jukebox/play':               # 🎵 pay arcade points to start a song for the whole lot
            s = {**DEFAULT_SETTINGS, **load('settings.json', {})}
            if not s.get('jukeboxOn', True):
                return self.send_json({'error': 'The jukebox is turned off right now.'}, 403)
            row = next((r for r in (s.get('jukeboxSongs') or [])
                        if r.get('file') == str(data.get('file') or '')), None)
            if not row: return self.send_json({'error': 'bad request'}, 400)
            phone = ''.join(re.findall(r'\d', str(data.get('phone', ''))))[-10:]
            who = _clean(NAME_RE.sub('', str(data.get('name', '')).strip()))[:24] or 'A visitor'
            play_secs = _juke_play_secs(s)
            with LOCK:                               # stage/queue check BEFORE charging points
                j = load('jukebox.json', {'now': None, 'queue': []})
                _jukebox_advance(j, play_secs)
                if j.get('now') and len(j.setdefault('queue', [])) >= 3:
                    return self.send_json({'error': 'The jukebox queue is full — try again in a bit.'}, 409)
            with ACCOUNTS_LOCK:                      # points deduct server-side, same authority as the 🏬 shop
                a = load('accounts.json', {})
                rec = a.get(phone)
                if not rec:
                    return self.send_json({'error': 'Sign in at the 🎪 Midway first — songs cost points '
                                                   '(bank them answering trivia in chat!).'}, 401)
                cost = max(0, int(row.get('cost') or 0))
                if rec.get('points', 0) < cost:
                    return self.send_json({'error': 'Not enough points — this song costs ' + str(cost) +
                                                   '. Answer trivia in chat!'}, 402)
                rec['points'] = rec.get('points', 0) - cost
                save('accounts.json', a)
            with LOCK:                               # take the stage, or join the short queue
                if j.get('now'):
                    j.setdefault('queue', []).append({'file': row['file'], 'title': row.get('title'), 'by': who})
                    queued = True
                else:
                    j['now'] = {'file': row['file'], 'title': row.get('title'), 'by': who, 'at': time.time()}
                    queued = False
                save('jukebox.json', j)
            return self.send_json({'ok': True, 'queued': queued, 'points': rec['points']})

        if p == '/api/caches/place':   # 🗺️ hide a cache where you stand (optionally stash one of your collectibles)
            s = {**DEFAULT_SETTINGS, **load('settings.json', {})}
            if not s.get('geocacheOn', True):
                return self.send_json({'error': 'Geocaching is turned off right now.'}, 403)
            phone = ''.join(re.findall(r'\d', str(data.get('phone', ''))))[-10:]
            who = _clean(NAME_RE.sub('', str(data.get('name', '')).strip()))[:24] or 'A visitor'
            if len(phone) != 10:
                return self.send_json({'error': 'Sign in at the 🎪 Midway first — hides and finds ride your account.'}, 401)
            try: x = round(float(data.get('x')), 2); z = round(float(data.get('z')), 2)
            except (TypeError, ValueError): return self.send_json({'error': 'bad request'}, 400)
            if not (-62 <= x <= 62 and -60 <= z <= 34):
                return self.send_json({'error': "That's outside the lot — hide it somewhere visitors can walk!"}, 400)
            note = _clean(re.sub(r'[\x00-\x1f\x7f]', '', str(data.get('note', ''))))[:80]
            pItem = re.sub(r'[^\w\-]', '', str((data.get('prize') or {}).get('item', '')))[:40]
            prize = None
            if pItem:
                with ACCOUNTS_LOCK:                   # the stash leaves YOUR collection for good
                    a = load('accounts.json', {})
                    rec = a.get(phone)
                    if not rec: return self.send_json({'error': 'bad request'}, 400)
                    prow = next((e for e in (rec.get('prizes') or [])
                                 if e.get('item') == pItem and e.get('count', 1) > 0), None)
                    if not prow:
                        return self.send_json({'error': "You don't have one of those to stash!"}, 400)
                    prow['count'] = prow.get('count', 1) - 1
                    if prow['count'] <= 0: rec['prizes'].remove(prow)
                    save('accounts.json', a)
                prize = {'item': pItem, 'label': str((data.get('prize') or {}).get('label') or pItem)[:48]}
            with GEO_LOCK:
                rows = load('geocaches.json', [])
                if any(abs(c['x'] - x) < 1.2 and abs(c['z'] - z) < 1.2 for c in rows):
                    return self.send_json({'error': 'Too close to another cache — wander a bit further first.'}, 409)
                if time.time() - GEO_LAST.get(phone, 0) < GEO_RATE_S:
                    return self.send_json({'error': 'One hide every 10 minutes — give hunters a chance!'}, 429)
                if len(rows) >= GEO_MAX:              # recycle the oldest cache someone already found
                    old = next((c for c in rows if len(c.get('founds') or [])), None)
                    if not old:
                        return self.send_json({'error': 'The lot is full of caches (' + str(GEO_MAX) +
                                                       ') — some need finding first!'}, 409)
                    rows.remove(old)
                rows.append({'id': 'g' + secrets.token_hex(4), 'x': x, 'z': z, 'by': who, 'note': note,
                             'phone': phone, 'at': int(time.time()), 'prize': prize, 'founds': []})
                GEO_LAST[phone] = time.time()
                save('geocaches.json', rows)
            return self.send_json({'ok': True, 'prize': bool(prize)})

        if p == '/api/caches/found':   # 🗺️ dig one up: walk to the pin area, search — points + any stashed prize
            s = {**DEFAULT_SETTINGS, **load('settings.json', {})}
            if not s.get('geocacheOn', True):
                return self.send_json({'error': 'Geocaching is turned off right now.'}, 403)
            phone = ''.join(re.findall(r'\d', str(data.get('phone', ''))))[-10:]
            who = _clean(NAME_RE.sub('', str(data.get('name', '')).strip()))[:24] or 'A visitor'
            if len(phone) != 10:
                return self.send_json({'error': 'Sign in at the 🎪 Midway first — finds bank on your account.'}, 401)
            try: x = round(float(data.get('x')), 2); z = round(float(data.get('z')), 2)
            except (TypeError, ValueError): return self.send_json({'error': 'bad request'}, 400)
            cid = str(data.get('id', ''))
            with GEO_LOCK:
                rows = load('geocaches.json', [])
                c = next((r for r in rows if r['id'] == cid), None)
                if not c:
                    return self.send_json({'error': 'That cache is gone — someone beat you to it!'}, 404)
                if any(f.get('phone') == phone for f in (c.get('founds') or [])):
                    return self.send_json({'error': 'You already logged this one!'}, 409)
                if ((x - c['x']) ** 2 + (z - c['z']) ** 2) ** .5 > GEO_FIND_M:
                    return self.send_json({'error': 'Not close enough — the pin is fuzzy (±2m). Walk around and dig again!'}, 400)
                first = not (c.get('founds') or [])
                prize = c.get('prize') if first else None
            with ACCOUNTS_LOCK:                      # points + the stashed collectible transfer server-side
                a = load('accounts.json', {})
                rec = a.setdefault(phone, {'created': int(time.time()), 'name': who,
                                           'prizes': [], 'wins': {}, 'points': 0})
                pts = (12 if first else 6) + (4 if prize else 0)
                rec['points'] = rec.get('points', 0) + pts
                rec.setdefault('wins', {})['cache'] = rec['wins'].get('cache', 0) + 1
                won = None
                if prize:
                    prow = next((e for e in rec.setdefault('prizes', []) if e.get('item') == prize['item']), None)
                    if prow: prow['count'] = prow.get('count', 1) + 1
                    else: rec['prizes'].append({'item': prize['item'], 'name': prize['label'], 'src': 'geocache',
                                                 'count': 1, 'got': int(time.time())})
                    won = prize['label']
                save('accounts.json', a)
            with GEO_LOCK:
                rows = load('geocaches.json', [])     # re-read: a rival may have retired it meanwhile
                c = next((r for r in rows if r['id'] == cid), None)
                if not c:
                    return self.send_json({'error': 'Someone beat you to the prize — it retired with them!'}, 409)
                if any(f.get('phone') == phone for f in (c.get('founds') or [])):
                    return self.send_json({'error': 'You already logged this one!'}, 409)
                c.setdefault('founds', []).append({'phone': phone, 'name': who, 'at': int(time.time())})
                if c.get('prize'): rows.remove(c)    # a prize cache retires with its first finder — traded, like real geocaching
                save('geocaches.json', rows)
            return self.send_json({'ok': True, 'points': pts, 'prize': won,
                                   'balance': rec['points'], 'first': first})

        if p in ('/api/gift-npc', '/api/npc-friend-gift', '/api/rep'):   # 🤝 crowd members: gifts, their friends' thanks, Rep
            phone = ''.join(re.findall(r'\d', str(data.get('phone', data.get('fromPhone', '')))))[-10:]
            if len(phone) != 10: return self.send_json({'error': 'bad request'}, 400)
            now = time.time(); today = time.strftime('%Y-%m-%d')
            with ACCOUNTS_LOCK:
                a = load('accounts.json', {}); rec = a.get(phone)
                if not rec: return self.send_json({'error': 'Sign in at the \U0001F3AA Midway first.'}, 401)
                if p == '/api/gift-npc':      # a sprout from your collection to a festival-goer: -1 sprout, +3 Rep, their friends may thank you
                    item = re.sub(r'[^\w\-]', '', str(data.get('item', '')))[:40]; row = SHOP_MAP.get(item)
                    if not row or not row.get('sprout'): return self.send_json({'error': 'That item is not a giftable sprout.'}, 400)
                    prow = next((e for e in (rec.get('prizes') or []) if e.get('item') == item and e.get('count', 1) > 0), None)
                    if not prow: return self.send_json({'error': "You don't have one of those to gift!"}, 400)
                    prow['count'] -= 1
                    if prow['count'] <= 0: rec['prizes'].remove(prow)
                    gd = rec.setdefault('gift_day', {'d': today, 'n': 0})
                    if gd.get('d') != today: gd['d'], gd['n'] = today, 0
                    gd['n'] += 1
                    if gd['n'] <= 10: rec['rep'] = int(rec.get('rep', 0)) + 3   # Rep for the first 10 gifts a day
                    rec['npc_gift'] = {'until': now + 300, 'cost': int(row['cost'])}
                    out = {'ok': True, 'gifted': row['label'], 'rep': rec['rep'], 'level': rep_level(rec['rep'])}
                elif p == '/api/npc-friend-gift':   # one friend's thank-you per gift: a cheaper-or-equal sprout (never a profit), max 3/day
                    g = rec.get('npc_gift') or {}
                    if now > g.get('until', 0): return self.send_json({'ok': True, 'gift': None, 'rep': int(rec.get('rep', 0))})
                    rec['npc_gift'] = {}
                    day = rec.setdefault('thanks_day', {'d': today, 'n': 0})
                    if day.get('d') != today: day['d'], day['n'] = today, 0
                    gift = None
                    if day['n'] < 3 and random.random() < .6:
                        pool = [r for r in SHOP_ITEMS if r.get('sprout') and r['cost'] <= g.get('cost', 0)]
                        if pool:
                            r = random.choice(pool); day['n'] += 1; gift = r['label']
                            ex = next((e for e in rec.setdefault('prizes', []) if e.get('item') == r['item']), None)
                            if ex: ex['count'] = ex.get('count', 1) + 1
                            else: rec['prizes'].append({'item': r['item'], 'name': r['label'], 'src': 'friend', 'count': 1, 'got': int(now)})
                    rec['rep'] = int(rec.get('rep', 0)) + 1
                    out = {'ok': True, 'gift': gift, 'rep': rec['rep'], 'level': rep_level(rec['rep'])}
                else:                          # '/api/rep': kind=react (answered a greeting, +1) or quest (+1..5); >=8 s apart, react 40/day, quests 60 Rep/day
                    kind = 'quest' if data.get('kind') == 'quest' else 'react'
                    rr = rec.setdefault('rep_react', {'d': today, 'n': 0, 'last': 0, 'q': 0})
                    if rr.get('d') != today: rr['d'], rr['n'], rr['q'] = today, 0, 0
                    amt = 1
                    if kind == 'quest':
                        try: amt = max(1, min(5, int(data.get('amount', 1))))
                        except (TypeError, ValueError, OverflowError): amt = 1
                        if rr.get('q', 0) + amt > 60: return self.send_json({'ok': True, 'rep': int(rec.get('rep', 0)), 'limited': True})
                    elif rr['n'] >= 40: return self.send_json({'ok': True, 'rep': int(rec.get('rep', 0)), 'limited': True})
                    if kind == 'react':   # greetings are spaced; quest awards can land together (quest + returned item)
                        if now - rr.get('last', 0) < 15: return self.send_json({'ok': True, 'rep': int(rec.get('rep', 0)), 'limited': True})
                        rr['last'] = now
                    if kind == 'quest': rr['q'] = rr.get('q', 0) + amt
                    else: rr['n'] += 1
                    rec['rep'] = int(rec.get('rep', 0)) + amt
                    out = {'ok': True, 'rep': rec['rep'], 'level': rep_level(rec['rep'])}
                save('accounts.json', a)
            return self.send_json(out)
        if p == '/api/gift':               # 🌱 gift a sprout from your collection onto another visitor's avatar
            s = {**DEFAULT_SETTINGS, **load('settings.json', {})}
            from_phone = ''.join(re.findall(r'\d', str(data.get('fromPhone', ''))))[-10:]
            to_vid = re.sub(r'[^a-zA-Z0-9_-]', '', str(data.get('toVisitor', '')))[:64]
            item = re.sub(r'[^\w\-]', '', str(data.get('item', '')))[:40]
            slot = re.sub(r'[^a-z]', '', str(data.get('slot', '')))[:12] or 'collar'
            if len(from_phone) != 10 or not to_vid or not item:
                return self.send_json({'error': 'bad request'}, 400)
            row = SHOP_MAP.get(item)
            if not row or not row.get('sprout'):
                return self.send_json({'error': 'That item is not a giftable sprout.'}, 400)
            with ACCOUNTS_LOCK:              # remove the sprout from the giver's collection
                a = load('accounts.json', {})
                rec = a.get(from_phone)
                if not rec: return self.send_json({'error': 'Sign in at the \U0001F3AA Midway first.'}, 401)
                prow = next((e for e in (rec.get('prizes') or [])
                             if e.get('item') == item and e.get('count', 1) > 0), None)
                if not prow:
                    return self.send_json({'error': "You don't have one of those to gift!"}, 400)
                prow['count'] -= 1
                if prow['count'] <= 0: rec['prizes'].remove(prow)
                save('accounts.json', a)
            # store as a pending gift keyed by the recipient's visitor id (claimed on their next poll)
            gift = {'from': rec.get('name', 'A visitor'), 'item': item, 'label': row['label'],
                    'slot': slot, 'ts': int(time.time())}
            with GIFT_LOCK:
                g = load('gifts.json', {})
                g.setdefault(to_vid, []).append(gift)
                save('gifts.json', g)
            return self.send_json({'ok': True, 'gifted': row['label']})

        if p == '/api/gift/claim':     # 🌱 claim pending sprout gifts into your account (called on every poll)
            phone = ''.join(re.findall(r'\d', str(data.get('phone', ''))))[-10:]
            vid = re.sub(r'[^a-zA-Z0-9_-]', '', str(data.get('visitor', '')))[:64]
            if len(phone) != 10 or not vid:
                return self.send_json({'error': 'bad request'}, 400)
            with GIFT_LOCK:
                g = load('gifts.json', {})
                pending = g.pop(vid, []) or []
                if pending: save('gifts.json', g)
            if not pending:
                return self.send_json({'ok': True, 'claimed': 0, 'sprouts': []})
            with ACCOUNTS_LOCK:
                a = load('accounts.json', {})
                rec = a.setdefault(phone, {'created': int(time.time()), 'name': 'Guest',
                                           'prizes': [], 'wins': {}, 'points': 0})
                rec.setdefault('sprouts', [])
                claimed = []
                for gf in pending:
                    spr = {'slot': gf['slot'], 'item': gf['item'], 'label': gf['label'],
                           'from': gf['from'], 'got': int(time.time())}
                    # replace any sprout already in that slot (one per slot)
                    rec['sprouts'] = [s for s in rec['sprouts'] if s.get('slot') != gf['slot']]
                    rec['sprouts'].append(spr)
                    claimed.append(spr)
                save('accounts.json', a)
            return self.send_json({'ok': True, 'claimed': len(claimed), 'sprouts': claimed})

        # ---------- 🃏 UNO endpoints ----------
        if p == '/api/uno/rooms':
            rooms = load('uno_rooms.json', {})
            out = []
            for rid, r in rooms.items():
                if time.time() - r.get('last', 0) > 7200: continue
                out.append({'id': rid, 'name': r.get('name'), 'players': len(r.get('players', [])),
                            'status': r.get('status'), 'max': 8})
            return self.send_json({'rooms': out})
        if p == '/api/uno/create':
            name = _clean(str(data.get('name') or 'UNO table'))[:24] or 'UNO table'
            vid = re.sub(r'[^a-zA-Z0-9_-]', '', str(data.get('vid', '')))[:64]
            if not vid: return self.send_json({'error': 'bad request'}, 400)
            pname = _clean(str(data.get('pname') or 'Player'))[:24] or 'Player'
            rooms = load('uno_rooms.json', {})
            rid = 'u' + secrets.token_hex(3)
            rooms[rid] = {'id': rid, 'name': name, 'players': [{'id': vid, 'name': pname}],
                          'status': 'lobby', 'deck': [], 'discard': [], 'hands': {vid: []},
                          'color': None, 'value': None, 'dir': 1, 'turn': 0, 'drawStack': 0,
                          'winner': None, 'uno': {vid: False}, 'created': int(time.time()),
                          'last': time.time()}
            with LOCK: save('uno_rooms.json', rooms)
            return self.send_json({'ok': True, 'id': rid})
        if p == '/api/uno/join':
            rid = str(data.get('room', '')); vid = re.sub(r'[^a-zA-Z0-9_-]', '', str(data.get('vid', '')))[:64]
            if not rid or not vid: return self.send_json({'error': 'bad request'}, 400)
            pname = _clean(str(data.get('pname') or 'Player'))[:24] or 'Player'
            rooms = load('uno_rooms.json', {})
            r = rooms.get(rid)
            if not r: return self.send_json({'error': 'room not found'}, 404)
            if any(p['id'] == vid for p in r['players']):
                r['last'] = time.time()
                with LOCK: save('uno_rooms.json', rooms)
                return self.send_json({'ok': True, 'id': rid, 'rejoined': True})
            if len(r['players']) >= 8: return self.send_json({'error': 'room full'}, 409)
            r['players'].append({'id': vid, 'name': pname})
            r['hands'][vid] = []; r['uno'][vid] = False
            r['last'] = time.time()
            if r['status'] == 'playing':
                _uno_deal_one(r, vid)
            with LOCK: save('uno_rooms.json', rooms)
            return self.send_json({'ok': True, 'id': rid, 'joinedMid': r['status'] == 'playing'})
        if p == '/api/uno/leave':
            rid = str(data.get('room', '')); vid = re.sub(r'[^a-zA-Z0-9_-]', '', str(data.get('vid', '')))[:64]
            rooms = load('uno_rooms.json', {})
            r = rooms.get(rid)
            if not r: return self.send_json({'ok': True})
            r['players'] = [p for p in r['players'] if p['id'] != vid]
            r['hands'].pop(vid, None); r['uno'].pop(vid, None)
            if not r['players']:
                rooms.pop(rid, None)
                with LOCK: save('uno_rooms.json', rooms)
                return self.send_json({'ok': True, 'closed': True})
            if r['turn'] >= len(r['players']): r['turn'] = 0
            if r['status'] == 'playing' and len(r['players']) < 2:
                r['status'] = 'finished'; r['winner'] = r['players'][0]['id']
            r['last'] = time.time()
            with LOCK: save('uno_rooms.json', rooms)
            return self.send_json({'ok': True})
        if p == '/api/uno/start':
            rid = str(data.get('room', '')); vid = re.sub(r'[^a-zA-Z0-9_-]', '', str(data.get('vid', '')))[:64]
            rooms = load('uno_rooms.json', {})
            r = rooms.get(rid)
            if not r: return self.send_json({'error': 'room not found'}, 404)
            if r['status'] != 'lobby': return self.send_json({'ok': True, 'status': r['status']})
            if len(r['players']) < 2: return self.send_json({'error': 'need at least 2 players'}, 400)
            _uno_start(r)
            r['last'] = time.time()
            with LOCK: save('uno_rooms.json', rooms)
            return self.send_json({'ok': True, 'status': 'playing'})
        if p == '/api/uno/room':
            rid = str(data.get('room', '')); vid = re.sub(r'[^a-zA-Z0-9_-]', '', str(data.get('vid', '')))[:64]
            rooms = load('uno_rooms.json', {})
            r = rooms.get(rid)
            if not r: return self.send_json({'error': 'room not found'}, 404)
            r['last'] = time.time()
            with LOCK: save('uno_rooms.json', rooms)
            top = r['discard'][-1] if r['discard'] else None
            players = [{'id': p['id'], 'name': p['name'], 'count': len(r['hands'].get(p['id'], [])),
                        'uno': bool(r['uno'].get(p['id']))} for p in r['players']]
            return self.send_json({'ok': True, 'id': rid, 'name': r['name'], 'status': r['status'],
                                   'players': players, 'top': top, 'color': r['color'], 'value': r['value'],
                                   'dir': r['dir'], 'turn': r['turn'],
                                   'turnId': (r['players'][r['turn']]['id'] if r['players'] and r['turn'] < len(r['players']) else None),
                                   'drawStack': r.get('drawStack', 0), 'winner': r['winner'],
                                   'hand': r['hands'].get(vid, []), 'deck': len(r['deck'])})
        if p == '/api/uno/play':
            rid = str(data.get('room', '')); vid = re.sub(r'[^a-zA-Z0-9_-]', '', str(data.get('vid', '')))[:64]
            rooms = load('uno_rooms.json', {})
            r = rooms.get(rid)
            if not r or r['status'] != 'playing': return self.send_json({'error': 'not playing'}, 400)
            if not r['players'] or r['turn'] >= len(r['players']) or r['players'][r['turn']]['id'] != vid:
                return self.send_json({'error': 'not your turn'}, 403)
            idx = int(data.get('idx', -1))
            chosen = str(data.get('color') or '')
            res = _uno_play(r, vid, idx, chosen)
            if res != 'ok': return self.send_json({'error': res}, 400)
            r['last'] = time.time()
            with LOCK: save('uno_rooms.json', rooms)
            return self.send_json({'ok': True})
        if p == '/api/uno/draw':
            rid = str(data.get('room', '')); vid = re.sub(r'[^a-zA-Z0-9_-]', '', str(data.get('vid', '')))[:64]
            rooms = load('uno_rooms.json', {})
            r = rooms.get(rid)
            if not r or r['status'] != 'playing': return self.send_json({'error': 'not playing'}, 400)
            if not r['players'] or r['turn'] >= len(r['players']) or r['players'][r['turn']]['id'] != vid:
                return self.send_json({'error': 'not your turn'}, 403)
            n = r.get('drawStack') or 1
            r['drawStack'] = 0
            _uno_draw(r, vid, n)
            _uno_advance(r, 1)
            r['last'] = time.time()
            with LOCK: save('uno_rooms.json', rooms)
            return self.send_json({'ok': True, 'drawn': n})
        if p == '/api/uno/uno':
            rid = str(data.get('room', '')); vid = re.sub(r'[^a-zA-Z0-9_-]', '', str(data.get('vid', '')))[:64]
            rooms = load('uno_rooms.json', {})
            r = rooms.get(rid)
            if not r: return self.send_json({'error': 'room not found'}, 404)
            r['uno'][vid] = True
            r['last'] = time.time()
            with LOCK: save('uno_rooms.json', rooms)
            return self.send_json({'ok': True})

        # ---------- ♟️ chess endpoints ----------
        if p == '/api/chess/rooms':
            rooms = load('chess_rooms.json', {})
            out = []
            for rid, r in rooms.items():
                if time.time() - r.get('last', 0) > 7200: continue
                out.append({'id': rid, 'name': r.get('name'), 'players': len(r.get('players', [])),
                            'status': r.get('status')})
            return self.send_json({'rooms': out})
        if p == '/api/chess/create':
            name = _clean(str(data.get('name') or 'Chess table'))[:24] or 'Chess table'
            vid = re.sub(r'[^a-zA-Z0-9_-]', '', str(data.get('vid', '')))[:64]
            if not vid: return self.send_json({'error': 'bad request'}, 400)
            pname = _clean(str(data.get('pname') or 'Player'))[:24] or 'Player'
            solo = bool(data.get('solo'))
            rooms = load('chess_rooms.json', {})
            rid = 'c' + secrets.token_hex(3)
            rooms[rid] = {'id': rid, 'name': name, 'players': [{'id': vid, 'name': pname, 'side': 'white'}],
                          'spectators': [], 'status': ('playing' if solo else 'lobby'), 'board': _chess_start(), 'turn': 'white',
                          'castle': {'wK': True, 'wQ': True, 'bK': True, 'bQ': True}, 'ep': None,
                          'half': 0, 'full': 1, 'moves': [], 'winner': None, 'created': int(time.time()),
                          'last': time.time(), 'solo': solo}
            with LOCK: save('chess_rooms.json', rooms)
            return self.send_json({'ok': True, 'id': rid, 'side': 'white', 'solo': solo})
        if p == '/api/chess/join':
            rid = str(data.get('room', '')); vid = re.sub(r'[^a-zA-Z0-9_-]', '', str(data.get('vid', '')))[:64]
            if not rid or not vid: return self.send_json({'error': 'bad request'}, 400)
            pname = _clean(str(data.get('pname') or 'Player'))[:24] or 'Player'
            rooms = load('chess_rooms.json', {})
            r = rooms.get(rid)
            if not r: return self.send_json({'error': 'room not found'}, 404)
            if any(p['id'] == vid for p in r['players']):
                r['last'] = time.time()
                side = next((p['side'] for p in r['players'] if p['id'] == vid), None)
                with LOCK: save('chess_rooms.json', rooms)
                return self.send_json({'ok': True, 'id': rid, 'rejoined': True, 'side': side})
            sides = {p['side'] for p in r['players']}
            side = 'black' if 'black' not in sides else None
            if side:
                r['players'].append({'id': vid, 'name': pname, 'side': side})
                if len(r['players']) >= 2 and r['status'] == 'lobby':
                    r['status'] = 'playing'
            else:
                r['spectators'].append(vid)
            r['last'] = time.time()
            with LOCK: save('chess_rooms.json', rooms)
            return self.send_json({'ok': True, 'id': rid, 'side': side, 'spectator': side is None})
        if p == '/api/chess/leave':
            rid = str(data.get('room', '')); vid = re.sub(r'[^a-zA-Z0-9_-]', '', str(data.get('vid', '')))[:64]
            rooms = load('chess_rooms.json', {})
            r = rooms.get(rid)
            if not r: return self.send_json({'ok': True})
            r['players'] = [p for p in r['players'] if p['id'] != vid]
            r['spectators'] = [s for s in r['spectators'] if s != vid]
            if not r['players']:
                rooms.pop(rid, None)
            elif r['status'] == 'playing' and len(r['players']) < 2:
                r['status'] = 'finished'; r['winner'] = r['players'][0]['side']
            r['last'] = time.time()
            with LOCK: save('chess_rooms.json', rooms)
            return self.send_json({'ok': True})
        if p == '/api/chess/room':
            rid = str(data.get('room', '')); vid = re.sub(r'[^a-zA-Z0-9_-]', '', str(data.get('vid', '')))[:64]
            rooms = load('chess_rooms.json', {})
            r = rooms.get(rid)
            if not r: return self.send_json({'error': 'room not found'}, 404)
            r['last'] = time.time()
            with LOCK: save('chess_rooms.json', rooms)
            side = next((p['side'] for p in r['players'] if p['id'] == vid), None)
            return self.send_json({'ok': True, 'id': rid, 'name': r['name'], 'status': r['status'],
                                   'players': r['players'], 'spectators': len(r['spectators']),
                                   'board': r['board'], 'turn': r['turn'], 'side': side,
                                   'moves': r['moves'][-1:] if r['moves'] else [],
                                   'winner': r['winner'], 'ep': r.get('ep'), 'castle': r.get('castle')})
        if p == '/api/chess/move':
            rid = str(data.get('room', '')); vid = re.sub(r'[^a-zA-Z0-9_-]', '', str(data.get('vid', '')))[:64]
            rooms = load('chess_rooms.json', {})
            r = rooms.get(rid)
            if not r or r['status'] != 'playing': return self.send_json({'error': 'not playing'}, 400)
            if r.get('solo'):
                if not any(p['id'] == vid for p in r['players']): return self.send_json({'error': 'not a player'}, 403)
            else:
                side = next((p['side'] for p in r['players'] if p['id'] == vid), None)
                if side is None: return self.send_json({'error': 'not a player'}, 403)
                if side != r['turn']: return self.send_json({'error': 'not your turn'}, 403)
            fr = str(data.get('from', '')); to = str(data.get('to', ''))
            promo = str(data.get('promo') or 'q')
            if len(fr) != 2 or len(to) != 2: return self.send_json({'error': 'bad squares'}, 400)
            try:
                fx, fy = ord(fr[0]) - 97, 8 - int(fr[1])
                tx, ty = ord(to[0]) - 97, 8 - int(to[1])
            except Exception: return self.send_json({'error': 'bad squares'}, 400)
            if not (0 <= fx < 8 and 0 <= fy < 8 and 0 <= tx < 8 and 0 <= ty < 8):
                return self.send_json({'error': 'off board'}, 400)
            res = _chess_try_move(r, fx, fy, tx, ty, promo)
            if res != 'ok': return self.send_json({'error': res}, 400)
            r['last'] = time.time()
            with LOCK: save('chess_rooms.json', rooms)
            return self.send_json({'ok': True, 'moves': r['moves'][-1:]})
        if p == '/api/chess/reset':
            rid = str(data.get('room', '')); vid = re.sub(r'[^a-zA-Z0-9_-]', '', str(data.get('vid', '')))[:64]
            rooms = load('chess_rooms.json', {})
            r = rooms.get(rid)
            if not r: return self.send_json({'error': 'room not found'}, 404)
            if not any(p['id'] == vid for p in r['players']): return self.send_json({'error': 'not a player'}, 403)
            r['board'] = _chess_start(); r['turn'] = 'white'; r['castle'] = {'wK': True, 'wQ': True, 'bK': True, 'bQ': True}
            r['ep'] = None; r['half'] = 0; r['full'] = 1; r['moves'] = []; r['winner'] = None; r['status'] = 'playing'
            r['last'] = time.time()
            with LOCK: save('chess_rooms.json', rooms)
            return self.send_json({'ok': True})
        if p == '/api/chess/resign':
            rid = str(data.get('room', '')); vid = re.sub(r'[^a-zA-Z0-9_-]', '', str(data.get('vid', '')))[:64]
            rooms = load('chess_rooms.json', {})
            r = rooms.get(rid)
            if not r: return self.send_json({'error': 'room not found'}, 404)
            if not any(p['id'] == vid for p in r['players']): return self.send_json({'error': 'not a player'}, 403)
            if r.get('status') != 'playing': return self.send_json({'error': 'not playing'}, 400)
            side = next((p['side'] for p in r['players'] if p['id'] == vid), None)
            r['winner'] = 'black' if side == 'white' else 'white'
            r['status'] = 'finished'
            r['last'] = time.time()
            with LOCK: save('chess_rooms.json', rooms)
            return self.send_json({'ok': True})


        if p == '/api/assistant':
            s = {**DEFAULT_SETTINGS, **load('settings.json', {})}
            myid = re.sub(r'[^a-zA-Z0-9_-]', '', str(data.get('id', '')))[:64]
            text = re.sub(r'[\x00-\x1f\x7f]', '', str(data.get('text', ''))).strip()[:400]
            lang = 'es' if str(data.get('lang', '')).lower().startswith('es') else 'en'   # guests send their UI language too
            if not myid or not text: return self.send_json({'error': 'bad request'}, 400)
            ap = re.sub(r'\D', '', str(data.get('phone', '')))[-10:]   # signed account chip → the assistant
            if len(ap) == 10:                                           # knows your REAL order without the LLM
                rec0 = load('accounts.json', {}).get(ap)
                if rec0:
                    sess0 = assistant_session(myid)
                    if not sess0.get('phone'):
                        sess0['phone'] = ap
                        sess0['name'] = rec0.get('name') or ''
            try:
                result = assistant_reply(s, myid, text, self.ip(), lang)
            except OrderError as e:
                return self.send_json({'error': str(e)}, e.code)
            except Exception:                      # assistant can NEVER hard-fail a customer-facing request
                return self.send_json({'reply': 'Perdón, ahorita tengo problema — intenta el menú de arriba, o pide en la ventana.' if lang == 'es' else "Sorry, I'm having trouble right now - try the menu above, or order at the window.",
                                       'lang': lang})
            return self.send_json(result)

        if p == '/api/order':
            s = {**DEFAULT_SETTINGS, **load('settings.json', {})}
            try:
                o = create_order(s, data.get('name'), data.get('phone'), data.get('notes'),
                                  data.get('items'), bool(data.get('smsConsent')), self.ip(), 'web-checkout-checkbox',
                                  pay_method=str(data.get('payMethod') or 'cash'),
                                  promo_code=str(data.get('promoCode') or ''),
                                  reward_id=str(data.get('rewardId') or ''))
            except OrderError as e:
                return self.send_json({'error': str(e)}, e.code)
            return self.send_json({'id': o['id'], 'number': o['number'], 'total': o['total'],
                                   'discount': o['discount'], 'payMethod': o['payMethod']})

        if p == '/api/checkout/stripe':   # public: turn a just-placed order into a Stripe Checkout redirect
            s = {**DEFAULT_SETTINGS, **load('settings.json', {})}
            if not s.get('payStripe'): return self.send_json({'error': 'Card payment is off.'}, 403)
            o = next((o for o in load('orders.json', []) if o['id'] == str(data.get('orderId') or '')), None)
            if not o: return self.send_json({'error': 'Order not found'}, 404)
            if o.get('paid'): return self.send_json({'error': 'Already paid.'}, 400)
            origin = ((self.headers.get('X-Forwarded-Proto') or 'http').split(',')[0].strip()
                      + '://' + (self.headers.get('Host') or 'localhost:8095'))
            sess, err = stripe_checkout(s, o, origin)
            if err: return self.send_json({'error': err}, 502)
            return self.send_json({'url': sess.get('url')})

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
        if p == '/api/admin/inventory':   # whole-sheet save from the Inventory tab editor
            if not isinstance(data.get('ingredients'), list) or not isinstance(data.get('recipes'), dict):
                return self.send_json({'error': 'bad inventory'}, 400)
            with INV_LOCK: save('inventory.json', {'ingredients': data['ingredients'], 'recipes': data['recipes']})
            return self.send_json({'ok': True})
        if p == '/api/admin/inventory/adjust':
            try: qty = round(float(data.get('qty') or 0), 2)
            except (TypeError, ValueError): return self.send_json({'error': 'bad qty'}, 400)
            kind = data.get('kind')
            if kind not in ('restock', 'waste') or qty <= 0 or not data.get('ing'):
                return self.send_json({'error': 'bad adjust'}, 400)
            ok = inventory_adjust(str(data['ing']), qty, kind, str(data.get('reason') or ''), data.get('cost'))
            return self.send_json({'ok': bool(ok)}, 200 if ok else 404)
        if p == '/api/admin/report/eom':   # writes data/reports/eom-<month>.json from the ledger
            month = str(data.get('month') or time.strftime('%Y-%m'))
            if not re.match(r'^\d{4}-\d{2}$', month): return self.send_json({'error': 'bad month'}, 400)
            rep = write_eom_report(month)
            return self.send_json({'ok': True, 'file': f'data/reports/eom-{month}.json', 'report': rep})
        if p == '/api/admin/outreach/search':   # local-business partner search around an address
            address = str(data.get('address') or '').strip()[:200]
            if not address: return self.send_json({'error': 'address required'}, 400)
            try: radius = min(20000, max(500, int(float(data.get('radiusM') or 4000))))
            except (TypeError, ValueError): radius = 4000
            cats = [c for c in data.get('categories') or [] if c in OUTREACH_CATS] or list(OUTREACH_CATS)
            try:
                geo = geocode(address)
            except Exception as e:
                return self.send_json({'error': f'Address lookup failed: {e}'}, 502)
            if not geo: return self.send_json({'error': 'Address not found - try a full street address.'}, 404)
            lat, lon, display = geo
            try:
                els = overpass_search(lat, lon, radius, cats)
            except Exception as e:
                return self.send_json({'error': f'Business search failed: {e}'}, 502)
            s = {**DEFAULT_SETTINGS, **load('settings.json', {})}
            o = get_outreach()
            have = {l['id']: l for l in o['leads']}
            new = 0
            for el in els:
                t = el.get('tags') or {}
                nm = str(t.get('name') or '').strip()
                if not nm: continue
                lid = f"{el.get('type','n')}-{el.get('id','')}"
                if lid in have: continue
                lead = {'id': lid, 'name': nm,
                        'category': _lead_category(t),
                        'address': _lead_address(t),
                        'website': (t.get('website') or t.get('contact:website') or ''),
                        'email': (t.get('email') or t.get('contact:email') or ''),
                        'phone': (t.get('phone') or t.get('contact:phone') or ''),
                        'lat': el.get('lat') or (el.get('center') or {}).get('lat'),
                        'lon': el.get('lon') or (el.get('center') or {}).get('lon'),
                        'status': 'new', 'ts': int(time.time())}
                lead['draft'] = draft_pitch(lead, s)
                have[lid] = lead; new += 1
            o['leads'] = list(have.values())
            o['searches'].append({'address': address, 'display': display, 'lat': lat, 'lon': lon,
                                  'radiusM': radius, 'categories': cats, 'new': new, 'ts': int(time.time())})
            save_outreach(o)
            return self.send_json({'ok': True, 'center': {'lat': lat, 'lon': lon, 'display': display},
                                   'new': new, 'leads': o['leads']})
        if p == '/api/admin/outreach/find-emails':   # crawl lead websites for public contact emails
            ids = set(data.get('ids') or [])
            o = get_outreach()
            found, tried = [], 0
            for l in o['leads']:
                if ids and l['id'] not in ids: continue
                if l.get('email') or not l.get('website'): continue
                tried += 1
                em = site_emails(str(l['website']))
                if em:
                    l['email'] = em; found.append({'id': l['id'], 'name': l['name'], 'email': em})
                time.sleep(0.5)   # be a good neighbor to their servers
            save_outreach(o)
            return self.send_json({'ok': True, 'tried': tried, 'found': found})
        if p == '/api/admin/outreach/template':   # save the admin's pitch template (with {placeholders})
            tpl = str(data.get('template') or '').strip()
            if not tpl: return self.send_json({'error': 'template required'}, 400)
            o = get_outreach(); o['templates'] = {'default': tpl[:6000]}; save_outreach(o)
            return self.send_json({'ok': True})
        if p == '/api/admin/outreach/lead':   # edit a lead's draft / email / status by hand
            o = get_outreach()
            for l in o['leads']:
                if l['id'] == data.get('id'):
                    for k in ('email', 'status', 'notes'):
                        if k in data: l[k] = str(data[k])[:600]
                    if 'draft' in data: l['draft'] = str(data['draft'])[:6000]
                    break
            else:
                return self.send_json({'error': 'not found'}, 404)
            save_outreach(o)
            return self.send_json({'ok': True})
        if p == '/api/admin/settings':
            s = {**DEFAULT_SETTINGS, **load('settings.json', {})}
            for k in DEFAULT_SETTINGS:
                if k in data: s[k] = data[k]
            s['taxRate'] = float(s['taxRate']); s['orderingOpen'] = bool(s['orderingOpen']); s['imageGenEnabled'] = bool(s['imageGenEnabled'])
            # 🎪 crowd knobs: bounded multipliers so a typo can't flood (or empty) the lot
            for _ck in ('crowdAmount', 'actorsAmount', 'interactAmount', 'clutterAmount',
                        'sceneFallMult', 'sceneFloatMult', 'sceneRandomness'):
                try: s[_ck] = round(min(3, max(0, float(s.get(_ck, DEFAULT_SETTINGS[_ck])))), 2)
                except (TypeError, ValueError): s[_ck] = DEFAULT_SETTINGS[_ck]
            # 🎛️ environment knobs: meter overrides (0 = auto), integer effect counts, shadow presets
            for _ek in ('sceneCrowdRange', 'sceneLifeRange', 'sceneClutterNear', 'sceneClutterMid', 'scenePixelRatio'):
                try: s[_ek] = round(min(200, max(0, float(s.get(_ek, DEFAULT_SETTINGS[_ek])))), 2)
                except (TypeError, ValueError): s[_ek] = DEFAULT_SETTINGS[_ek]
            for _ik, _hi in (('sceneSmokePuffs', 60), ('scenePipeSmokers', 100), ('scenePipePuffs', 8)):
                try: s[_ik] = max(0, min(_hi, int(float(s.get(_ik, DEFAULT_SETTINGS[_ik])))))
                except (TypeError, ValueError, OverflowError): s[_ik] = DEFAULT_SETTINGS[_ik]
            if s.get('sceneShadows') not in ('', 'off', '1024', '2048', '4096'): s['sceneShadows'] = ''
            s['sceneAntialias'] = bool(s.get('sceneAntialias'))
            s['sceneTextures'] = bool(s.get('sceneTextures'))
            s['sceneGenCar'] = bool(s.get('sceneGenCar'))
            # 🎵 jukebox catalog rows + #layout's saved prop layout get the same care as the rest:
            # known-shape fields only, bounded, nothing executable ever lands in settings.json
            if not isinstance(s.get('jukeboxSongs'), list): s['jukeboxSongs'] = []
            _jrows = []
            for r in s['jukeboxSongs']:
                if not isinstance(r, dict): continue
                f = re.sub(r'[^\w\-.]', '', str(r.get('file') or ''))[:80]
                if not f: continue
                try: c = max(1, min(500, int(r.get('cost') or 5)))
                except (TypeError, ValueError): c = 5
                _jrows.append({'file': f, 'title': _clean(str(r.get('title') or f))[:48], 'cost': c})
            s['jukeboxSongs'] = _jrows[:24]
            try: s['jukeboxPlaySecs'] = max(30, min(900, int(s.get('jukeboxPlaySecs') or 150)))
            except (TypeError, ValueError): s['jukeboxPlaySecs'] = 150
            if not isinstance(s.get('layoutProps'), dict): s['layoutProps'] = {}
            _lp = {}
            for k, v in s['layoutProps'].items():
                if not isinstance(v, dict) or not re.match(r'^[a-z]+\d*$', str(k)): continue
                try: _lp[str(k)[:24]] = {'x': round(float(v.get('x', 0)), 2), 'z': round(float(v.get('z', 0)), 2),
                                         'r': round(float(v.get('r', 0)), 1),
                                         **({'y': round(float(v['y']), 2)} if v.get('y') is not None else {})}
                except (TypeError, ValueError): continue
            s['layoutProps'] = dict(list(_lp.items())[:64])
            if s.get('imageEngine') not in ('comfyui', 'flux-local'): s['imageEngine'] = 'comfyui'
            if s.get('comfyWorkflow', '').strip():
                try: json.loads(s['comfyWorkflow'].replace('%PROMPT%', 'x').replace('%SEED%', '1'))
                except Exception: return self.send_json({'error': 'ComfyUI workflow is not valid JSON (API format).'}, 400)
            for k in ('ollamaUrl', 'imageServiceUrl', 'comfyUrl'):
                if not re.match(r'^https?://(127\.0\.0\.1|localhost)(:\d+)?/?$', str(s[k])): s[k] = DEFAULT_SETTINGS[k]
            with LOCK: save('settings.json', s)
            return self.send_json({'ok': True})
        if p == '/api/admin/backup':
            os.makedirs(os.path.join(DATA, 'backups'), exist_ok=True)
            ts = time.strftime('%Y%m%d-%H%M%S')
            fn = f'backup-{ts}.zip'
            zpath = os.path.join(DATA, 'backups', fn)
            with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
                for root, _, files in os.walk(DATA):
                    for f in files:
                        if f.endswith('.zip'): continue
                        full = os.path.join(root, f)
                        arc = os.path.relpath(full, ROOT)
                        z.write(full, arc)
                if os.path.isdir(MEDIA):
                    for root, _, files in os.walk(MEDIA):
                        for f in files:
                            full = os.path.join(root, f)
                            arc = os.path.relpath(full, ROOT)
                            z.write(full, arc)
            return self.send_json({'ok': True, 'file': fn})
        if p == '/api/admin/backup/download':
            fn = re.sub(r'[^A-Za-z0-9._-]', '', str(data.get('file') or ''))
            if not fn or not fn.startswith('backup-') or not fn.endswith('.zip'):
                return self.send_json({'error': 'bad file'}, 400)
            zpath = os.path.join(DATA, 'backups', fn)
            if not os.path.isfile(zpath): return self.send_json({'error': 'not found'}, 404)
            with open(zpath, 'rb') as f: b = f.read()
            self.send_response(200); self.send_header('Content-Type', 'application/zip')
            self.send_header('Content-Disposition', f'attachment; filename="{fn}"')
            self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
            return
        if p == '/api/admin/restore':
            b64 = data.get('zip_b64') or ''
            try: raw = base64.b64decode(b64)
            except Exception: return self.send_json({'error': 'bad zip'}, 400)
            try:
                z = zipfile.ZipFile(io.BytesIO(raw))
            except zipfile.BadZipFile: return self.send_json({'error': 'bad zip'}, 400)
            with LOCK:
                for info in z.infolist():
                    if info.is_dir(): continue
                    target = os.path.join(ROOT, info.filename)
                    if not os.path.realpath(target).startswith(ROOT): continue
                    os.makedirs(os.path.dirname(target), exist_ok=True)
                    with z.open(info) as src, open(target, 'wb') as dst:
                        shutil.copyfileobj(src, dst)
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
                            if data['status'] == 'cancelled':
                                cancel_order(o, 'admin-button')   # shared path: restock + points + void
                        if 'paid' in data:
                            was = o.get('paid')
                            o['paid'] = bool(data['paid'])
                            if o['paid'] and not was and not o.get('paidLogged'):   # log each real payment once
                                o['paidLogged'] = True
                                ledger_append({'type': 'payment', 'orderId': o['id'], 'num': o.get('number'),
                                               'method': o.get('payMethod') or 'cash',
                                               'amount': o['total'], 'by': 'admin'})
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
                _sms_send(to, str(data['message'])[:1600])   # carrier picked by settings.smsGateway
                return self.send_json({'ok': True})
            except Exception as e:
                return self.send_json({'error': str(e)}, 500)

        if p.startswith('/api/admin/help/seen'):
            # Admin tapped "seen" on a problem report — clears the red flag on the order card
            # and silences the banner, but keeps the thread in the help feed for the record.
            hid = str(data.get('orderId', ''))[:24]
            hit = False
            with LOCK:
                orders = load('orders.json', [])
                for o in orders:
                    if o.get('id') == hid and o.get('problem'):
                        o['problem']['unseen'] = False
                        hit = True
                        break
                if hit: save('orders.json', orders)
            with HELP_LOCK:                       # mark the matching thread handled too
                th = next((t for t in HELP_LOG if t.get('orderId') == hid and t['status'] == 'open'), None)
                if th: th['status'] = 'done'
            if hit: _save_help()
            return self.send_json({'ok': hit})

        return self.send_error(404)

if __name__ == '__main__':
    init()
    threading.Thread(target=_trivia_loop, daemon=True).start()   # 🤖 periodic Mesa/AZ trivia into chat
    if not os.environ.get('FOODTRUCK_NO_PREWARM'): threading.Thread(target=prewarm_thumbs, daemon=True).start()   # downsized copies of the menu photos for /api/menu
    print(f'Serving {ROOT} on 127.0.0.1:{PORT}')
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
