# Architecture (keep this short — it is loaded into every aider turn)

```
server.py        Python 3 stdlib HTTP server, port 8095. Static files + JSON API + AI photo jobs.
index.html       Public page shell: header/nav, menu+cart panel, Find Us, Contact. No inline JS/CSS.
css/site.css     All public styles incl. the phone @media block.
js/shop.js       DOM: fetch /api/settings + /api/menu, render menu, cart (whole-cent math), order
                 form → POST /api/order, status polling, contact mailto. Exports CONFIG, MENU,
                 esc, money, open(panelId), hooks.goWindow.
js/truck.js      three.js geometry only: 1990 GMC step van, painted canvas textures from tex/,
                 kitchen, worker, customer, props, 3D menu board. Exports dims (BL BW BH FLOOR
                 CL CH bx0, WX0 WX1 WY0 WY1) and buildTruck(scene,{img,done,MENU,money}) →
                 {board, click[], worker, cust}.
js/scene.js      Renderer, camera (portrait-aware fitDist), sky dome, Arizona sun + shadows,
                 asphalt lot, trees, raycast clicks on the board/worker/sign → open('menu'),
                 "Walk Around" auto-rotate, animation loop. Entry point (<script type=module>).
mobile.html      Lite phone ordering page (no three.js); served at / on the m. host (MOBILE_HOSTS) and at /mobile. css/mobile.css.
js/people.js     Shared-geometry people: crowdPerson() (2 draw calls), buildAvatar() (swinging limbs, elbows/knees), kids, swimwear.
js/life.js       Ambient crowd life + greetings/2-way sprout chain. js/stuff.js litter/lost items (LOD). js/quests.js vendors+quests.
js/themes.js     Steampunk + holiday themes by date. js/themefx.js re-skins everything except the truck; lamps/gears/confetti.
js/waterpark.js  West-side water park (per-section culling; closed placeholder). js/rep.js Rep score.
bling/           ComfyUI collectible sprites + catalog.json (shared by server.py shop and avatars.js).
ROADMAP.md       Features still needed + known bugs (read this first when continuing).
admin.html       Admin SPA (Orders / Menu / Settings tabs). Bearer token from /api/admin/login.
menu.json        Seed menu (copied to data/menu.json on first run).
data/            RUNTIME, not in git: menu.json settings.json orders.json admin.json.
lib/             Vendored three.js r160 (module + addons). tex/ img/ = photos/textures.
tests/smoke.sh   Offline smoke test used by aider's /test.
```

## HTTP API (server.py)

Public
- `GET /api/menu` → menu.json with hidden items/categories removed
- `GET /api/settings` → only PUBLIC_SETTINGS keys
- `POST /api/order {name, phone, notes, items:[{id, qty, protein}]}` → `{id, number, total}`
  (server recomputes prices from the menu; rate-limited 6/IP/10 min)
- `GET /api/order/<id>` → `{id, status}`

Admin (header `Authorization: Bearer <token>`)
- `POST /api/admin/login {password}` → `{token}`; `POST /api/admin/logout`
- `GET|POST /api/admin/menu`, `GET|POST /api/admin/settings`
- `GET /api/admin/orders` (last 300); `POST /api/admin/order {id, status|paid}`
- `POST /api/admin/password {password}`
- `POST /api/admin/genimage {item}` → `{job}`; `GET /api/admin/genjob/<id>` → `{status,image,prompt,error}`
- `GET /api/admin/comfy-checkpoints`, `GET /api/admin/imagegen-health`

Static: `/` → index.html, `/admin` → admin.html. `static_allowed()` whitelists
PUBLIC_FILES at the root and PUBLIC_DIRS (`lib tex img js css`); everything else is 404,
including directory listings and `.py` files.

## Order lifecycle
`new` → `cooking` → `ready` → `done` (or `cancelled`); `paid` is a separate flag.
Customers pay at the window (Square/cash); the site takes no payments.

## AI menu photos (admin only, optional)
Ollama (`gemma4:12b`) writes a prompt from the listing → ComfyUI FLUX.2 klein 4B renders it
on the shared RX 6800. `comfy_free()` / `ollama_keep_alive()` juggle VRAM between them.
