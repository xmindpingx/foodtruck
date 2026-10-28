# AGENTS.md — working guide for coding agents (OpenCode, aider, Claude, etc.)

This is the El Otro Lado food-truck site: a Python standard-library HTTP server (`server.py`) that serves a
3D festival lot (three.js) with online ordering, plus a lite phone-only ordering page. Read this file first,
then `ROADMAP.md` (known bugs + next features). `CONVENTIONS.md` and `ARCHITECTURE.md` are older notes written
for aider; where they disagree with this file, this file wins.

Live site: https://food.signaturediversified.com (3D) and https://mfood.signaturediversified.com (lite).
Both are the same server process (pm2 app `foodtruck-site`, port 8095) behind a Cloudflare tunnel.

## 0. How to work here (read before touching anything)

1. Work in small steps. One task at a time. After every edit run the checks in section 4.
2. You cannot see the 3D scene. Verify with the smoke test, `node --check`, curl, and the console
   simulation snippets in section 5. If a change is visual, say so in your final message and ask the
   owner to look at `http://localhost:8223/3d`.
3. **Allowed (owner-granted):** `pm2 restart|reload|status|logs|describe foodtruck-site`, and git `add <files>` / `commit` / `pull --ff-only` /
   `push origin main`. **Never run** `sudo`, `systemctl`, `docker`, `rm -rf`, any other pm2 app (this machine hosts ~10), `pm2 delete|stop`,
   force-push, `commit --amend`, `reset --hard`, `git add -A`/`git add .`, or touch Cloudflare/DNS. After you change a served file
   (`server.py`, `index.html`, `mobile.html`, `admin.html`, `css/*`, `js/*`, `models/*`) and the checks pass, commit, push, then
   `pm2 restart foodtruck-site` and confirm `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8095/3d` prints 200.
   OpenCode shortcuts: `/check`, `/review`, `/ship`, `/next` (`.opencode/commands/`), agents `reviewer` + `release` (`.opencode/agents/`).
4. Never touch `data/` (live orders, settings, password hashes), `lib/` (vendored three.js), `tex/`, `img/`,
   `media/`, `models/pilot-*`. Never read `data/settings.json` in full — it holds service URLs and keys. Never print secrets.
   Do not touch Cloudflare, DNS, or anything under `/home/dad/.secrets`.
5. No new dependencies: Python standard library only on the server; vanilla ES modules + the vendored
   three.js r160 in `lib/` in the browser. No npm, no bundler, no CDN scripts, no new files in `lib/`.
6. Family-facing site with kids on the lot: no nudity, no "flashing", no gambling, keep puns clean.
7. Do not rewrite whole files. Make targeted edits and keep each file's existing compact style.

## 1. The module version trap (most common way to break the site)

Browser modules are imported with a cache-busting query string, e.g. `import ... from './shop.js?v=8'`.
**Two different query strings for the same file load the module TWICE** (two copies of the state, menu
rendered twice, events fired twice). So when you change a JS module you must bump its `?v=` in **every**
importer, all to the same number. Versions change all the time, so never trust a number written in a
doc — print the live graph instead:

```bash
grep -rnoE "(\./|js/)[a-z_]+\.(js|css)\?v=[0-9]+" index.html mobile.html js/*.js | sort -t: -k3
```

Who imports what (stable): `index.html` loads `js/scene.js` (entry point, imported by nobody else),
`hotdog jukebox gps pacman uno chess cards` and inline-imports `shop.js`; `mobile.html` imports only `shop.js`.
`scene.js` imports almost every module (shop truck avatars people themes themefx life waterpark gfx rep stuff
quests account arcade). `avatars.js` ← arcade hotdog jukebox pacman scene. `shop.js` / `account.js` ← most
modules. `people.js` ← avatars life stuff waterpark scene.

Recipe after editing, say, `people.js`: `grep -rn "people.js?v=" js/ index.html mobile.html`, then change
every hit to the same new number (current + 1). Rule of thumb: **after any JS edit, bump the edited file's
version everywhere, then bump `js/scene.js?v=` in `index.html`.** The smoke test fails ("a module is imported
with two different ?v= strings") if you miss an importer — that check is your safety net, run it.

## 2. File map

```
server.py        ~3900 lines. ThreadingHTTPServer on 127.0.0.1:$PORT (default 8095). Static files + JSON API.
                 Routing: class H → page_for() (which HTML a path maps to), do_GET, do_POST, static_allowed().
                 Only PUBLIC_FILES at the root and PUBLIC_DIRS ('lib','tex','img','js','css','media','bling')
                 are ever served. data/ is never served. Decisions use the DECODED real path.
index.html       The 3D site shell: header/nav, the three panels (#menu #find #contact), lite-mode chip,
                 loader safety net, deep-link module. No three.js code in here.
mobile.html      Lite ordering page (no three.js). Same panel markup + ids as index.html so js/shop.js works
                 unchanged. The SMS opt-in block (#smsOptIn) and footer (#foot) MUST stay byte-identical to
                 index.html (registered wording; the smoke test checks it).
admin.html       Admin SPA (bearer token). The Environment tab has the scene knobs + the Games, boombox/TV
                 and Jukebox on/off switches listed in section 3.
css/site.css     3D page styles. css/mobile.css: lite page styles (loaded instead of site.css).
js/shop.js       DOM only: fetch /api/settings + /api/menu, render menu, cart (whole-cent math), order form,
                 status polling, contact mailto. Exports CONFIG, MENU, esc, money, open(panelId), hooks.
js/account.js    Arcade accounts (phone number = account). Pill + profile panel (points, Rep, collection,
                 "Wear on your avatar" bling buttons, redeem shop). Account.lang(), Account.phone, refresh().
js/truck.js      three.js truck geometry only. Exports BL BW BH FLOOR WX0 WX1 WY0 WY1 bx0, buildTruck().
                 The cook is a people.js avatar: his head is re-parented to a neck pivot (the merged head mesh
                 has its vertices at y~1.6, so rotating the mesh itself would swing it in an arc). scene.js's
                 loop drives userData.headPivot / userData.arms.
js/scene.js      ~1450 lines, entry point. Renderer, camera, lite detection (detectLite), crowd + booths,
                 stage/band, picnic tables + seated eaters, walking avatar (arrow keys / thumb pad), click
                 raycasts, layout mode, and the animation loop (R.setAnimationLoop near the bottom) that ticks
                 every system below. Also wires: themes → themefx, waterpark, life, stuff, quests, rep.
js/people.js     Realistic people on a phone budget (section 6.1).
js/avatars.js    Live presence avatars of other visitors (poll /api/presence every 3 s), chat dock, gift panel,
                 bling wearing, name sprites. makeBody(hue, prof) builds a people.js avatar.
js/life.js       Ambient crowd life + player interactions + Rep hooks (section 6.2).
js/stuff.js      Litter / lost items / decor with distance LOD, pick-up/deliver (section 6.4).
js/quests.js     Six pun vendors, flash sales, flash dances, ~37 pun quests (section 6.5).
js/themes.js     Theme palettes + holiday calendar (section 6.3). js/themefx.js applies a theme to the lot.
js/waterpark.js  West-side water park, per-section culling, "closed for repairs" placeholder (section 6.6).
js/gfx.js        ComfyUI photo textures: tagged materials get gfx/*.jpg (section 6.9).
gfx/             Built textures (JPEG): <name>.jpg desktop, <name>.m.jpg phone (half size), <name>.n.jpg normal map.
tools/gfx_gen.py Renders the textures on the owner's ComfyUI and builds gfx/ (section 7, T11). Raw renders go
                 to tools/gfx_raw/ (gitignored, never served). Dev tool: needs Pillow + numpy, not the server.
js/rep.js        Rep score helpers (points/level/title/add) (section 6.7).
js/arcade.js     Midway props + six minigames + HIGH SCORES board. js/pacman.js js/uno.js js/chess.js js/cards.js
                 js/hotdog.js js/jukebox.js js/gps.js: self-contained features (games, contest, music, geocaching).
bling/           43 collectible sprites (256px WebP) + bling/catalog.json (id, label, theme, slot, cost).
                 server.py loads the catalog at import into SHOP_ITEMS; avatars.js fetches it at runtime.
tests/smoke.sh   Offline test suite (section 4). menu.json: seed menu copied into data/ on first run.
data/            RUNTIME ONLY, gitignored: menu.json settings.json orders.json accounts.json gifts.json …
ROADMAP.md       Known bugs + needed features. .claude/launch.json: a local preview-server config, ignore.
```

## 3. Settings, env vars, data

- Public settings reach the browser as `CONFIG` (js/shop.js) — only the keys in `PUBLIC_SETTINGS` in
  server.py. Adding a public setting = add a default in `DEFAULT_SETTINGS`, add the key to `PUBLIC_SETTINGS`,
  add a control in admin.html (`<input data-s="key">` or `<input type="checkbox" data-s="key">`).
- The admin **Games** card (now inside the Environment tab): `waterparkOn` (false → "closed for repairs"
  sign), `waterparkClosedMsg` (custom sign line), `ambientLifeOn` (crowd life + litter + quests off when
  false), `questsOn`, plus bounded multipliers `crowdAmount` (static dressing), `actorsAmount` (ambient AI
  cast), `interactAmount` (greeting rate), `clutterAmount` (litter spawns) — all clamped 0–3 server-side.
- The admin **Environment** tab holds the scene knobs: the four crowd multipliers + `sceneRandomness`
  (scatter/pose jitter), `sceneSmokePuffs` (stage fog, 0 = off), `scenePipeSmokers` (% of crowd with a pipe),
  `scenePipePuffs` (puffs per smoker), `sceneFallMult` / `sceneFloatMult` (theme particles/lanterns),
  meter overrides `sceneCrowdRange` / `sceneLifeRange` / `sceneClutterNear` / `sceneClutterMid` (0 = auto),
  `sceneShadows` ("", off, 1024, 2048, 4096), `scenePixelRatio` (0 = auto), `sceneAntialias` and
  `sceneTextures` (ComfyUI photo textures on/off, default on — section 6.9).
  Draw-distance + graphics rows apply after a reload of the 3D page.
  Older: `midwayOn`, `hotdogOn`, `triviaBotOn`, `gamePacmanOn`, `gameUnoOn`, `gameChessOn`, `geocacheOn`.
- Env vars: `PORT`, `FOODTRUCK_DATA` (data dir; tests point it at a temp dir), `FOODTRUCK_NO_PREWARM=1`
  (skip the startup thumbnail pass), `FOODTRUCK_MOBILE_HOSTS` (comma list of Host headers that get the lite
  page at `/`; default `mfood.signaturediversified.com`). SMS/Twilio/NotifyHub vars exist too — do not touch.
- Money: all cart math is whole cents and identical in server.py (`tax_c = (sub_c*rate_micro + 500_000)//1_000_000`)
  and js/shop.js (`taxCents`). Change both or neither.
- Security invariants: `static_allowed()` is the only thing between the internet and `data/`; every
  `/api/admin/*` route stays behind `self.authed()`; every JSON POST body is checked with
  `isinstance(data, dict)`; every user/JSON value goes through `esc()` before `innerHTML`; never build
  inline `onclick="…"` strings with data; phone inputs stay `font-size:16px` (iOS zoom).

## 4. Checks to run (always, before you say you are done)

```bash
python3 -m py_compile server.py                 # server syntax
for f in js/*.js; do node --check "$f" || echo "BAD $f"; done   # module syntax (Node 24 is installed)
bash tests/smoke.sh                             # full offline suite, ~15 s, must end with SMOKE PASS
```
`tests/smoke.sh` starts the server on a spare port with a throw-away data dir and checks: routes, the static
whitelist (`/data/...` → 404, `/server.py` → 404), lite-page Host routing, the SMS block parity, the photo
downsizer, bling catalog, the new Rep/gift endpoints, theme dates, cart math, and bad-body rejection.
When you add a route, add a `want /path CODE` line (or a curl check) to the suite.

## 5. Running and probing locally (no browser needed for most checks)

```bash
# start a dev copy on :8223 with its own data dir (never the live data/)
d=$(mktemp -d); cp data/menu.json "$d/" 2>/dev/null
echo '{"siteGateEnabled": false, "taxRate": 0.083, "payCash": true, "rewardsOn": true}' > "$d/settings.json"
PORT=8223 FOODTRUCK_DATA="$d" FOODTRUCK_NO_PREWARM=1 FOODTRUCK_MOBILE_HOSTS=localhost:8223 python3 server.py &
# probes
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8223/3d          # 3D page (index.html)
curl -s http://localhost:8223/ | grep -c 'id="mobileApp"'                    # 1 = lite page (Host must match FOODTRUCK_MOBILE_HOSTS; 127.0.0.1 → 0)
curl -s http://127.0.0.1:8223/api/menu | python3 -m json.tool | head
curl -s http://127.0.0.1:8223/api/account/shop | python3 -c "import json,sys;print(len(json.load(sys.stdin)['items']),'shop items')"
```
Fake visitors (so avatars/greetings have targets):
```bash
python3 - <<'PY'
import json, urllib.request
for i,(h,sk,cap,face) in enumerate([(40,0,'','smile'),(120,2,'cowboy','wink'),(200,4,'','grumpy'),(280,5,'beret','surprised')]):
    b=json.dumps({'id':f'fake{i}','menu':True,'name':f'Visitor{i}','profile':{'hue':h,'sk':sk,'cap':cap,'face':face}}).encode()
    urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8223/api/presence',b,{'Content-Type':'application/json'}))
PY
```
If a browser IS available (owner, or a browser tool): open `http://localhost:8223/3d`, then in the console:
```js
// debug hooks exposed by scene.js (all window.__EOL_*):
__EOL_THEME                       // active theme id ('default' = classic look)
__EOL_CROWD.list.filter(e=>e.obj.visible).length + '/' + __EOL_CROWD.list.length   // crowd bodies drawn
__EOL_LIFE.actors.map(a=>a.name+':'+a.anim)      // what every ambient actor is doing
__EOL_STUFF.items.length                          // litter / lost items
__EOL_QUESTS.vendors; __EOL_QUESTS.quests         // vendors + quest count
__EOL_WALK_START(); __EOL_WALK_PRESS('ArrowUp')   // spawn + move your avatar (…_RELEASE to stop; Escape leaves walk mode)
__EOL_VIEW(px,py,pz, tx,ty,tz)                    // park the orbit camera at p looking at t (walk mode must be off)
__EOL_GFX.enabled; __EOL_CROWD.blobs.count       // photo textures on? / contact-shadow blobs in use
// fast-forward the simulation 60 s (a hidden/background tab throttles the real animation loop):
{let t=100;for(let i=0;i<600;i++){t+=.1;__EOL_LIFE.tick(t,.1);__EOL_QUESTS.tick(t,.1);__EOL_STUFF.tick(t,.1);}}
// give the first actor a sprout and watch the hug → friends → return-gift chain:
dispatchEvent(new CustomEvent('eol:npc-gift',{detail:{npc:0,slot:'collar',cost:0}}))
```
Lite mode: scene.js `detectLite()` returns true on phones; `localStorage['eol-lite2']='0' (only explicit chip choices are stored)` or the path `/3d`
forces full mode; the chip bottom-right toggles it. Themes: `?theme=steampunk|halloween|…|classic|auto`.

## 6. Systems reference (contracts you must keep)

### 6.1 people.js — bodies
- `crowdPerson(skinHex?, {swim?})` → Group with 2 meshes (merged vertex-coloured body + face-textured head),
  ~1.4k tris. Static: do not animate its limbs. Random look (20% kids, browner skin tones in `SKINS`).
- `buildAvatar(hue, prof, footY, overrideLook?)` → articulated Group: `root.children[0]` is the body;
  `root.userData = {arms:[L,R], legs:[L,R], head, look, scale, steamSkip:true}`; each arm/leg pivot has
  `userData.sub` (elbow/knee group, rotate `.sub.rotation.x`) and `userData.rest`. Feet at y=0, head centre
  y≈1.6, height 1.72 × `look.scale`. `prof` = `{hue, sk, cap, face, skinHex?}` (the presence profile).
- `faceMat(skinHex, expr, eyeIdx)` cached painted faces; `expr` ∈ `'' smile grumpy surprised wink`.
  `skinHead(headMesh, skinHex)` swaps a head's face to another tone.
- Everything from people.js carries `userData.steamSkip = true` so themefx never recolours people.

### 6.2 life.js — ambient crowd + interactions
- `Life.init(opts)` (wired in scene.js) returns `{tick(t,dt), actors, createStaff(spec), flashDance(x,z,secs,limit),
  rush(x,z,secs,limit), moshPit(x,z,secs,limit), dancersNear(x,z,r), pop(emoji,obj,y), toast(text),
  setMood(actor,expr,secs), cheer(actor,secs), interactMenu(actor,clientX,clientY), cans(), roster()}`.
- Movement: `walk()` routes around circular obstacles from `obstacles()` (truck, tables, props, vendor booths,
  jukebox, lowrider, stage, water park) with `detour()` + `pushOut()`; circles that contain the start or the goal
  are ignored (so seats, the queue and the stage pit are reachable). A leg counts as stuck only after 1 s of
  real time without progress (frame-rate independent); `goDyn` steps time out after `s.max || 12` s.
- Actor: `{id, name, kid, staff, root, g(=root.userData), x, z, yaw, plan:[steps], step, anim, near, seat, unit,
  quest, vendor, react, mood, expr}`. Plan step kinds: `go {x,z,spd}`, `goDyn {fn,d}`, `follow {t,dist}`,
  `wait {t,anim,fx,fz}`, `sit {x,z,yaw,key,t}`, `do {fn}`. Anims: idle chat watch dance cheer wave highfive
  photo pose give hug toss play queue eat (see `pose()`; add new anims there).
- Units: solo / couple / trio / family / staff; members re-plan together when all are idle. Staff never move.
- Only actors within `RANGE` (22 m phone/lite, 48 m desktop) are visible and posed.
- Player interactions: `interact()` every ~9–18 s ÷ (1 + 0.5·RepLevel); kinds wave / highfive / photo /
  dance / follow / sprout. Event `eol:npc-gift {npc, slot, cost}` = player gave actor #npc a sprout → hug,
  friends gossip, one friend brings a sprout (`POST /api/npc-friend-gift`). Tapping a greeting actor
  (`a.react` set) = +1 Rep via `opts.onReact`. Tapping any other actor opens `interactMenu` (4 random options of
  wave / high-five (+1 Rep) / photo / dance / hug / cheer / give sprout / follow me). The serving window and the
  ambient queue are on the truck's **-z** side (rig space).
- Faces: `exprFor()` picks the expression from anim/mood; `setMood()` overrides for N seconds.

### 6.3 themes.js / themefx.js
- `THEMES[id] = {label, emoji, win:[m0,d0,m1,d1(,rule)], fog, tint, lamp, m1, m2, dark, light, wood, fab[5],
  string[], fall{}, floats{}}`; `HOLIDAYS` order = soonest-first match order. `autoTheme(date)`,
  `nextHoliday(date)`, `resolve()` (→ id or `'default'`), `stored()`, `CYCLE`. Storage key `eol-scene-theme`
  (`auto` | `classic` | id); `?theme=` writes it. Steampunk is the everyday theme.
- `FX.init(S, {skip, lite, theme})` recolours every MeshStandardMaterial in the scene except: objects in
  `skip` (everything that existed when the truck finished building — **the truck is never re-skinned**),
  anything with `userData.steamSkip`, materials with map/emissive/vertexColors/transparency. Runs at 0 s,
  1.5 s and 6 s to catch late props. Adds gas lamps + (steampunk) gears/airships or (holiday) string lights,
  bunting, falling particles, floating lanterns. Returns `{tick}`.
- Lighting and the environment map stay original in every theme (so the truck looks the same).

### 6.4 stuff.js — litter, lost items, decor
- `Stuff.init(opts)` → `{tick, items, drop(x,z), spawnLost(kind,x,z,ownerName), carrying(), crate()}`.
  Item kinds are in the `K` table (cup wrapper bottle can napkin popcorn plate | teddy duck cap shades phone
  wallet keys ball shoe | confetti leaf flyer | speck). Two instanced tiers per kind: detailed within `NEAR`
  (9 m phone / 16 m desktop), simple within `MID` (20 / 38), nothing beyond.
- Tap an item with your avatar within 4.5 m → carry it; walk to a trash can (`life.cans()`), the owner
  (`item.owner` = an actor name) or the Lost & Found crate → delivered → event `eol:stuff-delivered {kind, id}`
  → Rep (every 3rd trash +1, lost item +2). Persisted in `localStorage['eol-stuff']` for 30 min.

### 6.5 quests.js — vendors, flash sales/dances, quests
- `VENDORS[]`: id, name (pun), hue, spot [x,z], south?, sales[]. Booths are built with scene.js `buildBooth`
  and staffed with `life.createStaff`. Flash sale every 70–120 s (banner + `life.rush`), flash dance every
  150–240 s (`life.flashDance`); both get more frequent with Rep. Standing with ≥2 dancers for 6 s = +2 Rep.
- Quest rows `Q`: `[giver, title, text, goal, rep]`. giver ∈ `v:<vendorId> | stage | stagehand | lifeguard |
  kid | any`. goal grammar: `visit:<poi>` · `deliver:<poiA>><poiB>` · `tap` · `dance` · `litter:<n>` · `lost`.
  poi ∈ `v:<vendorId> | stage | window | games | park | lost | tables`. One quest at a time, 150 s timer, card
  top-right, `localStorage['eol-quests-done']`. `onTap(actor)` is called by life.js before other tap handling.

### 6.6 waterpark.js
- `Waterpark.init(S, {open, message, lite, phone, cam, player, onUse})` → `{tick, group, guards, towers, poi, bounds, zones,
  splash(x,z), closed?}`. Walking into a `zones` entry calls `onUse(name)` (+1 Rep) once per entry (22 s cooldown).
  Tapping the park (last in scene.js's click chain) splashes; Rep for taps at most every 20 s.
  Bounds `PARK = {x0:-72, x1:-36, z0:-28, z1:22, gate:{x:-36, z:-3}}`. Sections (deck, wave, river, boats,
  slides, guns, lounge) each hide beyond their own radius (phones use 60 %). `open:false` builds the
  "closed for repairs" gate + rotating pun sign instead. The whole group has `userData.steamSkip` (keeps its
  own colours). No collision yet (ROADMAP).

### 6.7 rep.js + server endpoints
- `Rep.points() level() title() add(kind, amount)`; levels `[0,5,15,35,70,120]` = Newcomer Regular Local
  Favorite Celebrity Legend. Guests keep Rep in `localStorage['eol-rep']`; signed-in visitors on the account.
- `POST /api/rep {phone, kind:'react'|'quest', amount}` → `{ok, rep, level, limited?}` (react: ≥15 s apart,
  40/day; quest: 1–5, ≥8 s apart, 60 Rep/day). `POST /api/gift-npc {phone, item, slot}` → spends a sprout,
  +3 Rep, arms a friend thank-you. `POST /api/npc-friend-gift {phone}` → `{gift|null, rep}` (≤3/day, never a
  profit). All three answer 401 without an account (`/api/account/enter` first).
- Presence profile accepted by `POST /api/presence`: `{hue, sk, cap∈CAPS, face∈FACES, bling:[catalog ids,
  one per slot, ≤6], sprouts:[{slot,item,from}]}`. Bling ownership is NOT verified server-side yet (ROADMAP).
- Shop: `GET /api/account/shop` lists SHOP_ITEMS = sprouts + the 43 catalog items (`bling:true, slot, theme`);
  `POST /api/account/redeem {phone, item}` spends points. Wearing happens client-side via
  `Avatars.toggleBling(id)` (saved in the profile, seen by everyone through presence).

### 6.8 Lite site + photos (server.py)
- `H.page_for(path)` maps `/mobile` → mobile.html; on a `MOBILE_HOSTS` host `/ /index.html /order /checkout
  /sms-optin /menu` → mobile.html; `/admin` → admin.html; `/order /checkout /sms-optin /menu /3d` → index.html.
  GET and HEAD share it.
- Photos: `make_thumb(src)` writes `<stem>.t192.jpg` next to each `img/menu` photo (ImageMagick via
  subprocess, optional; coder + magic-byte checked; never runs inside a public request); `public_image(url)`
  rewrites `/api/menu` image URLs to the thumbnail when it exists; `prewarm_thumbs()` at startup;
  `shrink_image(path, 512)` for uploaded logos.

### 6.9 gfx.js — ComfyUI photo textures
- `Gfx.init({R, small, enabled})` → `{apply(root), enabled}`; scene.js calls `apply(S)` after everything is built
  (and again at 1.5 s). `small` (phones/lite) loads `gfx/<name>.m.jpg` and skips normal maps; desktop loads
  `<name>.jpg` + `<name>.n.jpg`. `enabled` = `CONFIG.sceneTextures !== false`.
- A builder opts a material in by tagging `material.userData`: `gfx:'<name>'` (grass wood canvas stone sand water
  backdrop signboard deck food-<vendorId> car-paint car-wheel car-tire car-grille car-seat), optional `gfxRepeat:[x,y]`, `gfxTint:true` (neutral fabric: keeps
  material.color as the tint — themefx may recolour it), `gfxShade:0..1` (darker natural texture),
  `gfxNoNormal:true`, `gfxMacro:texture` + `gfxMacroRepeat` (ground only: blends the old canvas over the photo
  so 4 m tiles don't show), `gfxSign:fn(img)` (booth signs repaint their canvas on the board image).
  Untagged materials — and the truck — are never touched. Every material gets its own texture object
  (cheap: three.js shares the GPU image), so animating `material.map.offset` (the lazy river) is safe.
- Where tags live today: ground + buildTable + buildBooth (+ sign) + buildStage backdrop + the lowrider's paint,
  wheels, tyres, grille and upholstery in scene.js; water, deck, rims, walls, beach, umbrellas in waterpark.js;
  vendor sandwich boards in quests.js.
- The '64 lowrider (`buildLowriderImpala`) is one extruded side profile (`carBodyShape`) plus a painted cabin
  (`carCabinShape`) with inset glass; `extrudeAcross(shape,width,bevel)` maps shape x -> +z (front) and extrudes
  across the car's width. The hub sits at y=.34, so **the tyre's outer radius must stay .34** or the wheels sink
  into the lawn. The car group carries `userData.steamSkip` so holiday palettes never repaint the candy purple,
  and `userData.switches/banks/switchLeds` (tap targets) must survive any rebuild — scene.js's click handler
  walks ancestors to find the car, so nesting is fine.
- Contact shadows: scene.js draws one soft blob per crowd body (`CROWD_BLOBS`, shown/hidden with the body)
  and per AI actor (`ACTOR_BLOBS`, updated each frame) outside the sun's shadow box (|x|,|z| > 13 m).

## 7. Pick a task (scoped recipes — do one, verify, report)

Each recipe lists files, steps and how to prove it works. Prefer these over inventing new features.

**T1. (done)** Actor collision with tables/booths/props exists (life.js `obstacles()`); if you touch it, keep goals
inside obstacle circles reachable and re-run the 120 fps fast-forward (section 5) — no actor may stay in one step.

**T2. Server-side ownership check for worn bling** — `js/avatars.js` heartbeat already sends `profile`;
add `phone: Account.phone` to that POST body; in `server.py` `/api/presence`, when `phone` is a 10-digit
account, keep only bling ids present in that account's `prizes`; without a phone keep none. Add a smoke
check: presence with `bling:['bling-crown']` and no phone → the next `/api/presence` GET for another id shows
`profile.bling == []`. Watch out: `accounts.json` is read under `ACCOUNTS_LOCK`.

**T3. Heads that turn** — `js/people.js` `buildAvatar()`: put the head mesh (and hair/hat buckets) in a
`headPivot` Group at y 1.52 and expose it as `userData.headPivot`; `js/life.js` `pose()`: during wave /
highfive / photo / give / hug / chat set `headPivot.rotation.y` toward the player (`a.face` yaw difference,
clamp ±0.8). Bump `people.js?v=` in life.js, stuff.js, waterpark.js, avatars.js, scene.js, then scene.js in
index.html. Verify with `node --check` + smoke + the console fast-forward (no errors).

**T4. Phone performance defaults** — pixel ratio, antialias and shadows are already admin knobs (`scenePixelRatio`,
`sceneAntialias`, `sceneShadows`, scene.js top) and life.js shrinks its cast on phones. Only add *phone defaults for
when a knob is unset*. Careful: `const IS_PHONE` is declared below `const R=` — move it above before using it there
(using a `const` before its line is a runtime crash that `node --check` cannot see). Expose `window.__EOL_R = R` to
read `__EOL_R.info.render.calls`. Biggest known cost: the crowd uses 31-mesh `buildPerformer` bodies (commit 779f65b,
deliberate); `People.crowdPerson()` is 2 meshes — ask the owner before switching back.

**T5. Eyeball + tune the other holiday palettes** — needs a browser. For each id in `themes.js HOLIDAYS`
open `/3d?theme=<id>`, screenshot, and adjust that theme's `fog`, `tint`, `fab`, `string`, `fall` so text
and the truck stay readable. Keep `steampunk` and `halloween` as they are (reviewed).

**T6. More / better quests** — `js/quests.js Q`. Keep the row shape and goal grammar; every pun must be
clean; add ≥5 rows; make sure each goal's poi exists. Verify: smoke + console
`__EOL_QUESTS.quests` increased, and fast-forward 300 s shows a quest card with no console errors.

**T7. Admin theme override** — add `sceneTheme` (default `''`) to `DEFAULT_SETTINGS` + `PUBLIC_SETTINGS`
and a `<select data-s="sceneTheme">` in admin.html (options: blank=auto, classic, steampunk, each holiday id);
in `js/scene.js` resolve the theme so a visitor's stored/`?theme=` choice wins and the admin value is the default:
`const st = Themes.stored(); SCENE_THEME = (st === 'auto' && CONFIG.sceneTheme) ? CONFIG.sceneTheme : Themes.resolve();`. Smoke: `/api/settings` contains `sceneTheme`.

**T8. Water-park collision for the player** — `js/scene.js walkCollide()`: add box push-outs for the wave
pool (`WP`), bumper pond (`BP`, circle), lazy river ring (keep the player out of the ring between `LR.r0`
and `LR.r1`) and slide towers; numbers are in `js/waterpark.js`. Export them from waterpark.js
(`export const LAYOUT = {...}`) instead of duplicating. Keep every `zones` entry reachable after the push-outs
(widen zones that sit over water) or the water-park Rep stops working.

**T9. Theme-date unit test for every holiday** — `tests/smoke.sh` already checks 12 dates; extend to
include the Easter/Thanksgiving edge days (the day before the window, first day, last day, day after).

**T10. Sounds (no assets)** — a tiny `js/sfx.js` using WebAudio oscillators for splash / trash / hug /
flash-sale bell; trigger from life.js `pop()` kinds and quests.js; respect `localStorage['eol-chat-quiet']`.

**T11b. 3D model generation (works, with a caveat)** — `tools/model_gen.py`:
`refs` renders reference photos, `model <ref.png>` runs TRELLIS 2 image->3D on ComfyUI (~10 min) and writes a GLB
to `tools/model_raw/`, `pack <glb> <name> --len L [--yaw D]` turns it into `models/<name>.{json,bin}` (quantised,
~0.5 MB) which `js/model.js` loads. `info <glb>` prints the bbox.

ComfyUI's int8 models (`trellis_2`, `pixal3d`) could not run on this RX 6800: `torch._int_mm` goes to hipBLASLt,
which ships no gfx1030 kernels (it targets CDNA2/3 and RDNA3+ only), so every int8 model died at its first
sampler step. No torch build fixes that. The fix is a ComfyUI custom node,
**`/home/dad/aaservers/ComfyUI/custom_nodes/int8_fallback_gfx1030/`**: comfy_kitchen prefers `torch.int8_mm` when
it exists, so the node defines one — an exact int8 matmul built from fp32 (rocBLAS) GEMMs, chunked 1024-deep so
partial sums stay inside fp32's exact-integer range. It installs itself only when `torch._int_mm` actually fails,
so it is a no-op on healthy GPUs. Delete the directory to undo. Verified bit-exact against a CPU int32 reference.

Caveat on the generated car: TRELLIS bakes the reference photo's lighting into the mesh colour, so its
specular highlights become white blotches and the automatic paint/tyre/chrome/glass split in `pack` is rough.
`sceneGenCar` therefore defaults to **off** (the hand-built shell ships). To finish it, regenerate from a
flat-lit reference (`refs f` makes one) and re-pack.

**T11. New / better ComfyUI texture** — `tools/gfx_gen.py` (`TEX` table: name → prompt, width, height, kind:
`seamless` | `seamx` (planks: left/right wrap only) | `tint` (neutral fabric) | `photo`). Add or edit a row, then
`python3 tools/gfx_gen.py gen <name>` (ComfyUI at http://127.0.0.1:8888 wakes on demand, ~20–70 s per image;
`--redo` re-renders) and `python3 tools/gfx_gen.py build <name>`. Look at `gfx/<name>.jpg` before using it.
Tag the material (section 6.9) and bump `gfx.js`'s `V` constant when you re-render an existing name.

## 8. Definition of done (copy into your final message)

- [ ] `python3 -m py_compile server.py` ok, every `node --check js/*.js` ok, `bash tests/smoke.sh` → SMOKE PASS
- [ ] every edited JS module's `?v=` bumped in all importers; `scene.js?v=` bumped in index.html
- [ ] no secrets read or printed; `data/`, `lib/`, `tex/`, `img/`, `media/` untouched
- [ ] new routes have smoke checks; new settings are in `DEFAULT_SETTINGS` + `PUBLIC_SETTINGS` + admin.html
- [ ] ROADMAP.md updated (bug fixed → remove it; new gap → add it)
- [ ] served file changed -> committed, pushed and `pm2 restart foodtruck-site` done (or say why not)
