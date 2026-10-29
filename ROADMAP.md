# Roadmap, needed features and known bugs

Status as of 2026-10-27. Everything below was built in one long session and only checked in a desktop
browser pane plus the offline smoke test (`tests/smoke.sh`). **Nothing has been profiled on a real iPhone 12.**
Restart needed after pulling: `pm2 restart foodtruck-site`.

## What exists (the backbone)

| Area | Files | Notes |
|---|---|---|
| Lite phone site | `mobile.html`, `css/mobile.css`, `server.py` (`page_for`, `MOBILE_HOSTS`) | `mfood.signaturediversified.com` (tunnel + DNS done); `/3d` = full 3D site on any host |
| Photo downsizer | `server.py` (`make_thumb`, `public_image`, `shrink_image`) | ImageMagick optional; 192 px thumbs, background conversion, magic-byte check |
| People | `js/people.js` | shared-geometry bodies, painted faces, kids, swimwear, crowd = 2 draw calls each |
| Ambient life | `js/life.js` | solos/couples/trios/families: eat, queue, trash, games, stage, greet player, 2-way sprout chain |
| Themes | `js/themes.js`, `js/themefx.js` | steampunk default + 11 holidays by date, `?theme=`, chip bottom-right; truck never re-skinned |
| Bling / collectibles | `bling/*.webp`, `bling/catalog.json`, `avatars.js`, `account.js` | 43 ComfyUI-generated sprites (10 steampunk + 3 per holiday), wear from the account panel |
| Rep | `js/rep.js`, `server.py` (`/api/rep`, `/api/gift-npc`, `/api/npc-friend-gift`) | levels 0-5; more Rep = more crowd greetings |
| Clutter | `js/stuff.js` | trash / lost items / decor, near+mid LOD, local persistence 30 min |
| Vendors + quests | `js/quests.js` | 6 pun vendors (with food-photo sandwich boards), flash sales, flash dances, ~37 pun quests |
| Truck cook | `js/truck.js` (`buildTruck`) | people.js body with painted face, articulated arms on the counter, neck-pivot head turn, branded cap and tiled apron; replaced the cylinder-and-sphere bust |
| '64 lowrider | `js/scene.js` (`buildLowriderImpala`) | extruded side-profile body + painted cabin with inset glass, clear-coat candy paint, ComfyUI wire-wheel/tyre/grille/upholstery/metalflake maps; hydraulics, ON-SWITCHES and tap-to-hop unchanged |
| Photo textures | `tools/gfx_gen.py`, `gfx/`, `js/gfx.js` | 14 ComfyUI renders (grass, wood, canvas, stone, sand, water, LED wall, sign board, 6 vendor dishes) → tileable JPEG + phone size + normal maps; admin `sceneTextures`; contact-shadow blobs in scene.js |
| Water park | `js/waterpark.js` | wave pool, lazy river, bumper boats, slides, cannons; per-section culling; admin switch -> "closed for repairs" |
| Admin switches | `admin.html` Environment tab (Games card) | `waterparkOn`, `waterparkClosedMsg`, `ambientLifeOn`, `questsOn` |

## Fixed in the 2026-10-27 evening bug check (six-lens review + runtime checks)

Themes never re-skinned anything (themefx skipped the Scene root's subtree); AI walks were frame-rate dependent
(actors abandoned walks and teleported into seats at ≥60 fps) and goDyn steps never timed out (frozen greeters);
seat reservations leaked; the ambient queue formed behind the truck (window is on -z); vendor booths were never
obstacles and goals inside obstacle circles were unreachable; "Follow me" ended on the next frame; the sprout gift
chain did nothing without an avatar out; water-park taps stole taps from people/tables/menu and paid Rep per tap;
walkCollide's truck push-out never moved the avatar; Safari/Firefox desktops were forced into lite mode (and the
auto value was saved — key renamed to `eol-lite2`); fall/float multipliers of 0 could not turn effects off;
`?theme=constructor` crashed the page; avatars added a PointLight each (shader recompiles) and were never disposed;
the 3D loop kept running under the full-screen phone menu; PMREM env maps leaked; truck.js loaded twice.
Server: accounts.json read-modify-writes now hold `ACCOUNTS_LOCK` (RLock) for the whole handler; `/api/account/prize`
can no longer mint shop collectibles/sprouts; presence sprouts are rebuilt from a whitelist; `/api/admin/restore`
checks auth before reading 90 MB; quest Rep is no longer dropped by greeting spacing; gift-npc Rep capped at 10/day;
OverflowError on infinite numbers; big static dirs (lib bling gfx media img tex) are cacheable again.
Smoke now also checks: one `?v=` per module, gfx assets + private raw dir, account/presence hardening.

## Known bugs / rough edges

0. **ComfyUI 3D generation: fixed, but the generated colour is not usable yet.** int8 models could not run on
   the RX 6800 (hipBLASLt has no gfx1030 kernels, so `torch._int_mm` failed); the custom node
   `ComfyUI/custom_nodes/int8_fallback_gfx1030/` routes int8 matmuls through exact fp32 GEMMs and TRELLIS 2 now
   runs end to end (~10 min/model). A generated lowrider is in `models/impala.*` and loads via `js/model.js`.
   **Remaining:** TRELLIS bakes the reference photo's highlights into the mesh colour, so the paint/tyre/chrome/
   glass split that `tools/model_gen.py pack` derives is speckled, and `sceneGenCar` defaults to off. Fix by
   regenerating from a flat-lit reference (`python3 tools/model_gen.py refs f`, then `model impala-f1.png`) and
   re-packing. **That regeneration is blocked:** three attempts on the flat-lit reference crashed the ComfyUI
   backend outright (Python faulthandler dump inside the KSampler, ~20 GB peak, no kernel OOM — a GPU/driver
   fault, not RAM). The same pipeline on `impala-a0.png` completed fine, so the int8 fallback works but is not
   reliable under sustained load on this ROCm build; shrinking its row block (8192 -> 2048) did not help.
   Hunyuan3D-2 (`hunyuan3d-dit-v2_fp16.safetensors`, fp16, no int8 path at all) is installed in
   `~/ai-stacks/shareddata/comfyui/models/checkpoints/` and **does run reliably** — 135 s, no crash, 29,714
   tris — so it is the way to generate geometry on this GPU. But it is geometry only: no vertex colour, so
   `pack` has nothing to split chrome from paint, and its mesh fuses the wheels into the body. Side by side
   in the lot the TRELLIS body is clearly better (wheels, glass and real proportions); the Hunyuan one reads
   as a smooth blob, so it was not kept. **Next:** either texture a Hunyuan mesh (its own paint/UV pass) or
   get a flat-lit TRELLIS run to finish; `sceneGenCar` stays off and the hand-built shell ships.

1. **No real-device performance data.** Budgets (crowd range, section radii, pixel ratio, 2048 shadow map) are estimates. Needs Safari Web Inspector on an iPhone 12; watch draw calls (life + stuff + park + vendors) and memory.
2. The crowd uses 31-mesh `buildPerformer` bodies again (commit 779f65b, deliberate): ~2.7k meshes / ~830k triangles when all are in range — the biggest phone cost; `People.crowdPerson()` is 2 meshes. Static props (tables, booths) are hundreds of unmerged meshes that all cast into the sun shadow map. Lite mode still does not lower pixel ratio / antialiasing / lights on phones; `eol-lite=0` (3D page) on an iPhone 12 is the heavy path.
3. Hidden/background browser panes throttle `requestAnimationFrame`; the sim was verified by manually ticking `__EOL_LIFE.tick`, not by watching real time.
4. Actors avoid the truck (full circumradius, no more corner clipping), picnic tables, arcade props, vendor booths, the jukebox, the Impala lowrider, the main stage and the water park (its real bounds, not a stray circle at the origin). Seats still ignore the player's own avatar; slide/pool interiors remain walkable.
5. Sit/eat/play/hug are approximate joint poses; heads do not turn (head mesh has no pivot); kids' bodies clip slightly when seated.
6. Band performers, seated eaters and the 200 instanced audience still use the old low-realism bodies. (The truck
   cook is now a people.js body with a neck pivot, branded cap and apron.)
7. Live avatars: `makeBody` uses the shared rig but each avatar gets own materials (~15 meshes). 14 avatars + 27 actors + park bathers can be heavy together; no global cap yet.
8. Admin: media/logo upload re-renders settings and drops unsaved edits; "Save environment" posts every Settings field too (an invalid hidden field aborts it). Bling "worn" list is cosmetic and **not ownership-checked** by the server (anyone can claim to wear any catalog id via the presence profile).
9. Rep for guests is local only (`eol-rep`); easy to edit, resets with the browser.
10. Water park: visual QA only from code review; water transparency sorting, slide riders (plain capsules) and the closed-sign placeholder were not eyeballed. Players can walk through slides/pools (no collision). `walk.x` limit was widened to -76.
11. Holiday palettes: only Halloween and steampunk were seen on screen. Others are untested; colour contrast (e.g. Christmas haze, New Year dark fog) may need tuning.
12. `themefx` restyles materials 3 times (0 s, 1.5 s, 6 s) to catch late-built props; anything built later (e.g. games opened on demand) keeps original colours.
13. Quests: `deliver` is proximity only (no item shown); `lost` quests spawn the item at a random lawn spot; no check that the target spot is reachable; quest text/puns need a human read for taste.
14. Stuff: Lost & Found crate position is a guess near the serving window; LOD distances (9/20 m phone, 16/38 m desktop) are not tuned; tapping uses an instanced raycast that can miss tiny items.
15. Tapping an actor/item uses capture-phase click handlers on the canvas; they pre-empt the scene's own tap logic when they hit.
16. `/api/npc-friend-gift` and `/api/rep` have no automated tests; smoke only checks that they refuse bad input.
17. ComfyUI art: some sprites are large (up to 1 MB source); web copies are 256 px WebP (~15 KB each). The raw 1024 px PNGs live only in the session scratchpad.
18. Intentionally **not built**: any nudity/"flashing" content (the lot has kids and a family-facing site). Flash sales, flash dances and camera-flash photobombs exist instead.

## Needed features (next)

- Real-device profiling pass + a global actor/avatar budget (auto-lower counts by FPS). Partly addressed: Admin → Environment has manual crowd/cast/interaction/clutter multipliers + shadow/pixel-ratio/antialias budget rows.
- A per-phone "performance tier" (`pixelRatio`, shadow map, actor count) instead of only lite on/off.
- Collision / steering for actors (tables, booths, water park), seat reservation visible to the player.
- Player-visible inventory for carried items (hand sprite) and quest item pick-ups.
- Server-side ownership check + max-worn rules for bling; seasonal shop filter (show this season's items first is done, hide others optional).
- Per-vendor menus / real promos linked to flash sales (currently fun only, +1 Rep).
- Quest log history, daily streaks, leaderboards for Rep; admin editor for quests/vendors/pun text.
- Water park: collision, swim animation for the player, working slide ride, sounds.
- Sounds: splash, trash, hug, flash-sale bell.
- Admin: theme override (force a holiday for everyone). Done in this round: clutter amount + actor count + interaction rate (`crowdAmount`/`actorsAmount`/`interactAmount`/`clutterAmount` in Environment tab).
- Tests: headless render test for each theme; unit tests for `themes.autoTheme` across a year.

### Universal AI / shared simulation (new; phased)

Goal: every visitor's browser shows the **same** ambient AI crowd, the same actions on
live visitor avatars, the same AI-assistant activity, and the same AI-generated wearables.
Today each client runs its own life.js simulation and its own assistant, so two visitors
standing next to each other see different crowd behaviour.

- **Phase 1 — Wearables universal (in progress).** AI-generated 3D props are activated
  through `bling/catalog.json` + `models/wear/*` and redeemed via `/api/account/shop`, so
  every visitor sees and can wear the same items. Completed by `tools/wear_gen.py catalog`.
  *Status: first 8 items (fedora, shades, oxfords, cowboy boots, backpack, bowtie, cane,
  top hat) generated this session; commit + restart pending.*
- **Phase 2 — Deterministic ambient crowd (done).** `Math.random()` replaced with a seeded PRNG (mulberry32) in all 6 modules; `/api/time` endpoint added; `t` driven by shared clock; seed passed to all init functions; seats/queues use deterministic selection (first free seat sorted by key, queue by actor id). *Remaining: late-joiner replay (pure init of seed+t0) — needs state to be a function of t or expensive replay. Full byte-for-byte sync requires replay or stateless simulation.*
- **Phase 3 — Live avatar action sync (done).** Server accepts and broadcasts `action` in presence profile (rate-limited 3 s); client `setAction(type)` sends it; poll applies received actions to avatars with pose + bubble; tick plays action pose; `setAction` wired into life.js interactMenu so every player interaction broadcasts to other visitors.
- **Phase 4 — Shared AI assistant.** Today `sendToAssistant()` is private per visitor.
  Make assistant replies broadcast as a system chat line (or a dedicated `/api/assistant`
  shared thread) so everyone sees the same Q&A; tool calls that mutate orders stay
  per-account. Probably gated by a setting (`sharedAssistantOn`, default off).
- **Phase 5 — Ownership + safety.** Server-side bling ownership (T2) becomes more
  important once wearables are universal and valuable; add max-worn (8) + seasonal filter.

Recommended order: finish Phase 1, then Phase 2 (biggest visible payoff), then Phase 3.

### 3D wearables (backbone shipped; the rest is this to-do)
Backbone: `js/wear.js` (sockets -> shared-geometry props), `tools/wear_gen.py` (FLUX ref -> Hunyuan3D mv-turbo -> `models/wear/`),
`bling/catalog.json` rows with `model:true`, `slot` = a socket name, `mat` = a `wear.js` MATS key; `BLING_SLOTS` widened in server.py;
worn cap raised 6 -> 8. Pilot facts: ~50 s/item warm, 1500 tris reads the same as 6000, props carry NO colour/UVs (one `mat` each).
- [ ] Generate the rest of the catalog (design pass produced ~98 rows; saved under the session scratchpad). Re-scope to single-material
      silhouettes; drop items that duplicate the free Look picker (ball/cowboy/beret, afro/bun/long/short) or live bling (sombrero, pocket watch).
- [ ] Hair + facial hair: UNTESTED whether generated solids bury the painted face (critics say yes). Pilot one hair/beard/moustache; else
      add procedural styles to people.js (`HAIRS`, `g.beard`). Needs `userData.part` stamps to suppress the default hair/hat/shoe.
- [ ] Clothes: NOT generated meshes (can't fit an articulated avatar). Procedural garment geometry in `rig()` + ComfyUI fabric tiles via gfx_gen.py;
      other visitors need a rebuild path in avatars.js `poll()` (it only diffs bling today).
- [ ] Missing sockets: shoulderL/R, earL/R, nose, wrists. Foot socket is at the shoe centre (y -.428), sole is -.472: use `dy:-.044` or move it.
- [ ] account.js UI grouping by kind (cascade: account.js -> shop.js -> 10 modules + index.html/mobile.html `?v=`), pricing entry rung (60-90),
      pun labels, fix emoji collisions, bling-golden-goggles slot hat -> glasses.
- [ ] Ownership of worn bling is still not verified server-side (T2) — more valuable items make it matter more.
- [ ] Sprouts: ~1/3 size when clipped on, clip anywhere on the body, a dozen new festival sprout types (owner request).
- [ ] Draw calls: workflow `draw-call-survey` lists what animates per prop; then `People.mergeStatic()` the truck rig (467 meshes), water park (189),
      stage (118), arcade/jukebox. Current ~974 render calls (shadows on), was ~1,200+.

## Popular feature ideas (backlog, not yet scheduled)

Collected from community feedback + common festival-site patterns. Ordered roughly by
effort vs. payoff. Each is a candidate for a future commit; none are started.

### Low effort, high delight
- **Photo mode** — a "📸" button that hides the UI, freezes the orbit camera on your avatar and
  saves a PNG (canvas.toDataURL) with a watermark + current theme. Shareable link optional.
- **Emote wheel** — 8 quick emotes (wave, dance, cheer, sit, point, laugh, cry, heart) triggered
  by a radial menu; plays the anim for 2 s then returns to idle.
- **Achievement badges** — "First order", "10 Rep", "Found a cache", "Rode every slide", "Met 5 visitors".
  Stored on the account (`/api/account/badges`), shown in the profile panel and above the avatar.
- **Daily login streak** — +1 Rep/day for opening the site; streak counter in the account panel.
- **Pet companions** — a small dog/cat that follows your avatar (1 extra draw call, People-style body).
- **Weather** — rain/snow/fog overlays driven by a `sceneWeather` setting; theme particles already exist.
- **Night mode toggle** — force the dark-fog holiday look on demand (admin or visitor).

### Medium effort
- **Leaderboards** — Rep top-10 (server, daily + all-time) and per-game high scores (already on the
  HIGH SCORES board; make it global across visitors).
- **Custom avatar poses** — pick a pose from the emote wheel and hold it; others see it via presence.
- **Group photo** — invite nearby avatars to a "say cheese" pose; saves a shared screenshot.
- **Replay / ghost** — record your walk path for 30 s and replay it as a ghost avatar for friends.
- **Vehicle customization** — paint the truck / lowrider (admin-only first, then per-visitor).
- **Seasonal events** — auto-swap themes + spawn limited-time vendors/quests on holidays (already
  partially: themes by date).
- **Voice reactions** — short WebAudio stings on hug/splash/trash (T10 in AGENTS.md).
- **Mini-game tournaments** — scheduled 5-min rounds with a live scoreboard on the HIGH SCORES board.

### Larger bets
- **Mobile AR** — view the truck in AR via WebXR (model-viewer style); reuses the GLB pipeline.
- **Party mode** — create a private room code; only friends with the code see each other's avatars.
- **Live events** — owner broadcasts a "flash sale" or "flash dance" from admin; everyone sees it.
- **User-generated quests** — visitors submit pun quests; admin approves; reward Rep.
- **Accessibility pass** — keyboard-only navigation, screen-reader labels, reduced-motion mode
  (respect `prefers-reduced-motion`), high-contrast theme.
- **Offline PWA** — service worker caches the shell + menu so the lite page works offline.
- **Analytics dashboard** — admin tab showing orders/hour, popular items, visitor counts, Rep gained.
