# El Otro Lado food-truck site — rules for AI assistants (aider)

Repo: `/home/dad/www/foodtruck`. Live at https://food.signaturediversified.com (pm2 app
`foodtruck-site`, Python server on 127.0.0.1:8095 behind a Cloudflare tunnel).
Read `ARCHITECTURE.md` for what each file does. You only edit files in this repo.

## Hard rules

1. Edit only inside this repo. Never touch `data/` (runtime JSON: orders, settings, admin
   password hash), `lib/` (vendored three.js), `tex/`, `img/`, or anything outside the repo.
2. Never run `sudo`, `pm2`, `systemctl`, `docker`, `rm -rf`, or anything that restarts the
   site. After your edits the human runs `pm2 restart foodtruck-site` themselves. Every
   reply where you changed `server.py`, `admin.html`, `index.html`, `css/*`, or `js/*` MUST
   end with a one-line reminder: "Restart needed: pm2 restart foodtruck-site". Skip the
   reminder only for edits confined to `.md` files, `.aider.conf.yml`, or `tests/`.
3. No secrets in code or in chat. Passwords, API tokens and keys live only in `data/` or the
   environment. Never print or hard-code them. Never weaken `/api/admin/*` auth.
4. Never use placeholders (`your_value_here`, `<PORT>`, `path/to/file`). Use the real value
   from the code or ask.
5. Small, targeted SEARCH/REPLACE edits. Do not rewrite a whole file for a one-line change.
   Keep existing comments and the existing compact code style of each file.
6. Files on disk never contain markdown fences (```); fences are for chat only.
7. No new dependencies. Server: Python 3 standard library only. Browser: vanilla ES modules +
   the vendored three.js r160 in `lib/` (no npm, no bundler, no CDN scripts).

## Security invariants (do not break)

- `server.py` `static_allowed()` is the only thing between the internet and `data/`.
  Any new static folder must be added to `PUBLIC_DIRS`; any new root file to `PUBLIC_FILES`.
  Decisions are made on the DECODED real path, never on the raw URL string.
- Every `/api/admin/*` route goes through the bearer-token check. Login is rate-limited
  (8 failures → 15 min lockout). Orders are rate-limited (6 per IP per 10 min).
- All JSON POST bodies are checked with `isinstance(data, dict)` before use.
- `/api/settings` (public) returns ONLY the keys in `PUBLIC_SETTINGS`. Internal settings
  (ollamaUrl, comfyUrl, imageEngine, …) must never leak to the public site.
- In HTML/JS, every value that came from a user or from JSON goes through `esc()` before
  being put in `innerHTML`. Never build an inline `onclick="..."` string that contains data;
  use `data-*` attributes + `addEventListener` (see admin.html delete buttons).

## Money / tax

- All cart math is in whole cents, identical in `server.py` (`tax_c = (sub_c*rate_micro +
  500_000)//1_000_000`) and `js/shop.js` (`taxCents`). Change both or neither.
- Tax rate is a decimal in settings (`0.083` = 8.3%, Mesa AZ). Prices in `menu.json` are
  dollars with two decimals.

## Front end (`index.html`, `css/site.css`, `js/*.js`)

- `js/shop.js` = DOM only (menu, cart, order form, contact). `js/truck.js` = three.js geometry
  only (no DOM, no camera). `js/scene.js` = renderer/camera/lights/loop and wires the two.
  Keep that separation; do not import `shop.js` into `truck.js`.
- Truck dimensions and the service-window rectangle (`WX0 WX1 WY0 WY1`) are exported from
  `truck.js`; everything that lines up with the window uses those constants.
- Mobile first: the site must work in portrait on a phone (see the `@media(max-width:640px)`
  block; inputs stay `font-size:16px` to stop iOS zoom). The 3D camera already handles
  portrait via `fitDist()`.
- Textures are painted onto `<canvas>` from the photos in `tex/` at build time; do not add
  image files that must be fetched at runtime unless they go in `img/` or `tex/`.

## Admin (`admin.html`)

- Single page, bearer token in `sessionStorage`, polls `/api/admin/orders` every 5 s with
  ONE interval (`_ordInterval`); clear it on logout.
- AI photo generation is optional and off by default; it talks to local Ollama + ComfyUI on
  the same GPU. Never make the public site depend on it.

## Checking your work

- Python: `python3 -m py_compile server.py` (aider's auto-lint already does this).
- JS: `node --check js/<file>.js` (the repo has `package.json` with `"type":"module"`).
- `/test` runs `tests/smoke.sh`: starts the server on a spare port, checks the public
  routes answer 200, the protected ones 404/401, and that cart math matches.
- After the human restarts pm2, verify at https://food.signaturediversified.com/ and
  /admin.html on a phone-sized window too.
- `start_aider.sh` also checks for you on exit: it diffs the commits made this session (and
  any uncommitted changes) and prints a loud "RESTART NEEDED" reminder with the list of
  changed files if anything changed, or says no restart is needed if nothing did. That is a
  backstop, not a substitute for rule 2 above — say it in chat too.
