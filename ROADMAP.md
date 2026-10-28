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

0. **ComfyUI cannot generate 3D models on this machine** (found 2026-10-28). `tools/model_gen.py` implements the
   full TRELLIS 2 image->3D pipeline and ComfyUI accepts the graph, but the sampler dies with
   `HIPBLAS_STATUS_INVALID_VALUE`: all three installed 3D models are int8-quantised and this torch build has no
   gfx1030 hipBLASLt kernels (`TensileLibrary_lazy_gfx1030.dat` missing), so `torch._int_mm` fails outright on the
   RX 6800. `TORCH_BLAS_PREFER_HIPBLASLT=0` does not change it. Fix is on the ComfyUI side: a torch/ROCm build with
   gfx1030 int8 kernels, or non-quantised (bf16/fp16) 3D weights such as Hunyuan3D-2. Image generation is fine.
   Until then the lowrider is hand-built geometry wearing ComfyUI photo maps, not a generated mesh.

1. **No real-device performance data.** Budgets (crowd range, section radii, pixel ratio, 2048 shadow map) are estimates. Needs Safari Web Inspector on an iPhone 12; watch draw calls (life + stuff + park + vendors) and memory.
2. The crowd uses 31-mesh `buildPerformer` bodies again (commit 779f65b, deliberate): ~2.7k meshes / ~830k triangles when all are in range — the biggest phone cost; `People.crowdPerson()` is 2 meshes. Static props (tables, booths) are hundreds of unmerged meshes that all cast into the sun shadow map. Lite mode still does not lower pixel ratio / antialiasing / lights on phones; `eol-lite=0` (3D page) on an iPhone 12 is the heavy path.
3. Hidden/background browser panes throttle `requestAnimationFrame`; the sim was verified by manually ticking `__EOL_LIFE.tick`, not by watching real time.
4. Actors avoid the truck (full circumradius, no more corner clipping), picnic tables, arcade props, vendor booths, the jukebox, the Impala lowrider, the main stage and the water park (its real bounds, not a stray circle at the origin). Seats still ignore the player's own avatar; slide/pool interiors remain walkable.
5. Sit/eat/play/hug are approximate joint poses; heads do not turn (head mesh has no pivot); kids' bodies clip slightly when seated.
6. Band performers, seated eaters, the truck worker and the 200 instanced audience still use the old low-realism bodies.
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
