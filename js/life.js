// life.js — ambient festival life on a phone budget. A small cast (≈16 desktop / ≈8 phone) of articulated
// people live their own day: watch the band, queue at the window, sit and eat at the picnic tables, toss
// their trash, send the kids off to the games and back to the table — wandering as solos, couples,
// friend trios and families. Now and then a unit walks over to YOU (or another live avatar) to wave,
// high-five, snap a photo, dance, tag along, or clip on a sprout. Give one of THEM a sprout and they hug
// you, tell their friends, and a friend comes back with a sprout of their own.
// Cost model: plans are a handful of numbers (no per-frame allocation); limbs are only posed while the
// actor is within CROWD range of the camera, everyone else just advances along their path.
import * as THREE from 'three';
import * as People from './people.js?v=12';
import * as Wear from './wear.js?v=4';
let _rng = Math.random;   // seeded PRNG (set in init); shared clock drives determinism
function makeRng(seed) { let a = (seed || 1) >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const rnd = (a, b) => a + _rng() * (b - a), pick = a => a[Math.floor(_rng() * a.length)];
const NAMES = ['Rosa', 'Mateo', 'Luz', 'Diego', 'Camila', 'Santi', 'Abby', 'Jun', 'Priya', 'Omar', 'Lena', 'Tomás', 'Maya', 'Eli', 'Nora', 'Hugo', 'Ana', 'Kai', 'Isla', 'Ravi'];
const V = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3();
const dist2 = (x0, z0, x1, z1) => (x1 - x0) ** 2 + (z1 - z0) ** 2;
const yawTo = (x0, z0, x1, z1) => Math.atan2(x1 - x0, z1 - z0);
const lerpYaw = (a, b, k) => { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * Math.min(1, k); };

export function init(o) {
  const {S, cam, rig, tables, eaters, win, stage, truckBox, props, jukebox, lowriders, parkBounds, player, liveList, attachSprout, lite, phone: isPhone, canvas, extraObstacles, theme, menu, seed} = o;
  _rng = makeRng(seed || 1);
  // Halloween outfits for the AI crowd: fetch catalog, filter halloween wearables, apply to all actors (and staff) when theme is halloween
  let halloweenWear = [];
  if (theme === 'halloween') {
    fetch('/bling/catalog.json').then(r => r.ok ? r.json() : null).then(j => {
      if (!j || !j.items) return;
      halloweenWear = j.items.filter(it => it.model && it.theme === 'halloween');
      if (!halloweenWear.length) return;
      const applyOne = (a) => {
        const n = 1 + (_rng() < .35 ? 1 : 0);
        const rows = [];
        for (let i = 0; i < n; i++) rows.push(halloweenWear[Math.floor(_rng() * halloweenWear.length)]);
        const uniq = [...new Map(rows.map(r => [r.id, r])).values()];
        Wear.apply(a.root, uniq).catch(() => {});
      };
      for (const a of actors) applyOne(a);
    }).catch(() => {});
  }
  // ---------- food from the menu: actors carry a item away from the window ----------
  const FOOD_EMOJI = {'Street Taco':'🌮','3 Street Tacos':'🌮','Burrito':'🌯','Bean & Cheese Burrito':'🌯','Quesadilla':'🧀','Loaded Fries':'🍟','Chips & Salsa':'🫔','Chips & Guacamole':'🥑','Esquite':'🌽','Churros':'🍩','Mexican Coke':'🥤','Jarritos':'🥤','Bottled Water':'💧'};
  const FOOD_ITEMS = [];
  try { for (const c of (menu && menu.categories) || []) for (const it of (c.items || [])) FOOD_ITEMS.push(it.name); } catch (e) {}
  const pickFood = () => FOOD_ITEMS.length ? FOOD_ITEMS[Math.floor(_rng() * FOOD_ITEMS.length)] : 'Taco';
  const foodEmoji = (name) => FOOD_EMOJI[name] || '🌮';
  const attachFood = (a, emoji) => {
    if (a._food) return;
    let t = emojiTex.get(emoji);
    if (!t) { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.font = '44px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(emoji, 32, 36); t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; emojiTex.set(emoji, t); }
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({map: t, transparent: true, depthTest: false}));
    sp.scale.set(.32, .32, 1); const hand = (a.g.hands && a.g.hands[1]) || a.root.children[0]; hand.add(sp); sp.position.set(0, .02, .06); a._food = sp; a._foodEmoji = emoji;
  };
  const removeFood = (a) => { if (a._food) { a._food.parent && a._food.parent.remove(a._food); a._food = null; a._foodEmoji = null; } };

  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const CM = Math.max(0, Math.min(3, num(o.castMult, 1)));      // 🎪 ambient cast multiplier (Admin → crowd settings)
  const IM = Math.max(0, Math.min(3, num(o.interactMult, 1)));  // 👋 player-greeting frequency multiplier
  const repLv = () => Math.max(0, Math.min(5, o.repLevel ? o.repLevel() : 0));
  const RANGE = Math.max(8, num(o.range, 0) || (lite || isPhone ? 22 : 48));   // Admin → Environment can widen/narrow the alive radius
  const actors = [], units = [], taken = new Map(), pops = [];
  let seatCount = 0;

  // ---------- trash cans on the outer side of a few tables ----------
  const cans = [];
  {
    const body = new THREE.CylinderGeometry(.26, .21, .72, 10), lid = new THREE.CylinderGeometry(.28, .28, .06, 10);
    const bm = new THREE.MeshStandardMaterial({color: 0x3a3f44, roughness: .55, metalness: .5}), lm = new THREE.MeshStandardMaterial({color: 0x23262a, roughness: .5, metalness: .5});
    const ring = tables.filter(t => !t.children.some(c => eaters.includes(c)));
    for (const t of [ring[1], ring[5], ring[9]].filter(Boolean)) {
      const g = new THREE.Group(), b = new THREE.Mesh(body, bm), l = new THREE.Mesh(lid, lm); b.position.y = .36; l.position.y = .75; g.add(b, l);
      const len = Math.hypot(t.position.x + 2.9, t.position.z) || 1;
      g.position.set(t.position.x + (t.position.x + 2.9) / len * 2.1, 0, t.position.z + t.position.z / len * 2.1);   // out past the table, away from the truck
      b.castShadow = true; rig.add(g); cans.push(g);
    }
  }
  const worldOf = (obj, x = 0, y = 0, z = 0) => obj.localToWorld(V.set(x, y, z)).clone();

  // ---------- points of interest (always world x,z) ----------
  const poi = {
    pit: () => ({x: rnd(-6, 22), z: rnd(-60.6, -54)}),
    queue: k => { const lx = win.x1 - .45 - (k % 4) * .62, w = worldOf(rig, lx, 0, -(win.z + 1.5)), f = worldOf(rig, lx, 0, -win.z); return {x: w.x, z: w.z, fx: f.x, fz: f.z}; },   // the serving window is on the truck's -z side
    wander: () => ({x: rnd(-20, 24), z: rnd(5, 17)}),
    game: () => {
      const ps = props().map(q => q && (typeof q.getWorldPosition === 'function' ? q : (q.group || q.obj || q.root))).filter(q => q && typeof q.getWorldPosition === 'function'); if (!ps.length) return poi.wander();
      const p = pick(ps), w = p.getWorldPosition(V2).clone(), a = rnd(0, 6.28);
      return {x: w.x + Math.cos(a) * 1.8, z: w.z + Math.sin(a) * 1.8, fx: w.x, fz: w.z};
    },
    can: () => { const c = pick(cans); if (!c) return null; const w = worldOf(c), a = rnd(0, 6.28); return {x: w.x + Math.cos(a) * .85, z: w.z + Math.sin(a) * .85, fx: w.x, fz: w.z}; },
  };
  function freeSeat() {   // a bench slot at a table without the pre-seated eaters, world pos + facing (deterministic: first free seat sorted by key)
    const free = [];
    tables.forEach((t, ti) => {
      if (t.children.some(c => eaters.includes(c))) return;
      for (const sx of [-.42, .42]) for (const sz of [-.74, .74]) { const key = ti + ':' + sx + ':' + sz; if (!taken.has(key)) free.push({t, ti, sx, sz, key}); }
    });
    if (!free.length) return null;
    free.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    const f = free[0], w = worldOf(f.t, f.sx, 0, f.sz + Math.sign(f.sz) * .06), c = worldOf(f.t);
    return {key: f.key, x: w.x, z: w.z, yaw: yawTo(w.x, w.z, c.x, c.z)};
  }

  // ---------- cast ----------
  function makeActor(kid, unit) {
    let look = People.randomLook();
    while (!kid && look.kid) look = People.randomLook();   // randomLook makes ~20% kids itself: adults must not inherit the kid head rig
    if (kid) Object.assign(look, {kid: true, scale: .62 + _rng() * .1, beard: false, vest: 0, hat: null, sleeve: 'short', dress: _rng() < .4, hair: pick(['short', 'long', 'bun'])});
    else look.scale = .95 + _rng() * .1;
    const root = People.buildAvatar(Math.floor(_rng() * 360), {}, 0, look);
    root.visible = false; S.add(root);
    const p = poi.wander();
    const a = {id: actors.length, root, g: root.userData, kid, name: pick(NAMES), unit, x: p.x, z: p.z, yaw: rnd(0, 6.28), plan: [], step: null, t: 0, anim: 'idle', ph: rnd(0, 6.28), gait: 0, moving: false, seat: null, near: false, spd: kid ? 1.7 : 1.25, locked: false};
    root.position.set(a.x, 0, a.z); root.rotation.y = a.yaw;
    actors.push(a); return a;
  }
  function createStaff(sp) {   // {x, z, yaw, name, look?} — stands at a post; vendors.js sets .anim / moods
    const a = makeActor(false, null); a.staff = true; a.locked = true; a.name = sp.name || a.name; a.x = sp.x; a.z = sp.z; a.yaw = sp.yaw || 0; a.anim = 'chat';
    const u = {kind: 'staff', members: [a], interact: true, busy: 0}; a.unit = u; units.push(u);
    a.root.position.set(a.x, 0, a.z); a.root.rotation.y = a.yaw;
    if (theme === 'halloween' && halloweenWear.length) { const rows = [halloweenWear[Math.floor(_rng() * halloweenWear.length)]]; Wear.apply(a.root, rows).catch(() => {}); }
    return a;
  }
  function makeUnit(kind, n, hasKid) {
    const u = {kind, members: [], interact: false, busy: 0};
    for (let i = 0; i < n; i++) u.members.push(makeActor(hasKid && i === n - 1, u));
    units.push(u); return u;
  }
  const U = n => Math.round(n * CM);   // scale the ambient cast; 0 = none of that unit kind
  const solos = U(lite || isPhone ? 2 : 5);
  for (let i = 0; i < solos; i++) makeUnit('solo', 1, false);
  if (U(1)) makeUnit('solo', 1, true); if (!(lite || isPhone) && U(1)) makeUnit('solo', 1, true);
  if (U(1)) makeUnit('couple', 2, false); if (!(lite || isPhone)) { if (U(1)) makeUnit('couple', 2, false); if (U(1)) makeUnit('trio', 3, false); }
  if (U(1)) makeUnit('family', 2, true);
  // spread the opening scene: some already seated mid-meal, some at the show


  // ---------- plans ----------
  const go = (p, spd) => ({k: 'go', x: p.x, z: p.z, spd, fx: p.fx, fz: p.fz});
  const wait = (t, anim, p) => ({k: 'wait', t, anim, fx: p && p.fx, fz: p && p.fz, fy: p && p.fy});
  const off = (p, i, n) => ({x: p.x + (i - (n - 1) / 2) * .85, z: p.z + (i % 2 ? .2 : -.2), fx: p.fx, fz: p.fz});
  const seatStep = (a) => { const s = freeSeat(); if (!s) return null; if (a.seatKey) taken.delete(a.seatKey); taken.set(s.key, a); a.seatKey = s.key; return [go(s), {k: 'sit', x: s.x, z: s.z, yaw: s.yaw, key: s.key, t: rnd(28, 55)}]; };
  const trashSteps = () => { const c = poi.can(); return c ? [go(c), wait(1.5, 'toss', c)] : []; };

  function soloPlan(a) {
    const r = _rng(), P = [];
    if (a.kid) {
      const g = poi.game(); P.push(go(g), wait(rnd(14, 32), 'play', g));
      if (r < .6) { const s = seatStep(a); if (s) P.push(...s, ...trashSteps()); }
    } else if (r < .32) { const p = poi.pit(); P.push(go(p), wait(rnd(25, 60), 'watch', {fx: 8, fz: -70}));
      if (_rng() < .5) P.push(...orderEat(a)); }
    else if (r < .6) P.push(...orderEat(a));
    else if (r < .75) { const g = poi.game(); P.push(go(g), wait(rnd(10, 22), 'play', g)); }
    else { const w = poi.wander(); P.push(go(w), wait(rnd(3, 9), 'idle')); }
    return P;
  }
  function orderEat(a) {
    const food = pickFood(), emoji = foodEmoji(food);
    const q = poi.queue(Math.floor(_rng() * 4)), P = [go(q), wait(rnd(6, 10), 'queue', q)];
    P.push({k: 'do', fn: () => attachFood(a, emoji) });   // pick up food at the window
    const s = seatStep(a);
    if (s) {   // s = [go(seat), sit]; carry food during the walk, drop it when sitting
      P.push(s[0]);
      P.push({k: 'do', fn: () => removeFood(a) });
      P.push(s[1]);
      P.push(...trashSteps());
    } else {
      P.push({k: 'do', fn: () => removeFood(a) });
    }
    return P;
  }
  function groupPlans(u) {   // one plan per member, same shape so they move and finish together
    const n = u.members.length, r = _rng(), plans = u.members.map(() => []);
    const all = (fn) => u.members.forEach((m, i) => plans[i].push(...[].concat(fn(m, i))));
    if (r < .3) { const w = poi.wander(), w2 = poi.wander(); all((m, i) => [go(off(w, i, n)), wait(rnd(3, 6), 'chat'), go(off(w2, i, n)), wait(rnd(2, 5), 'chat')]); }
    else if (r < .5) { const p = poi.pit(); all((m, i) => [go(off(p, i, n)), wait(rnd(25, 55), 'watch', {fx: 8, fz: -70})]); }
    else if (r < .66) { const w = poi.wander(), d = rnd(9, 16); all((m, i) => [go(off(w, i, n)), wait(d, 'dance')]); }
    else if (r < .78) {
      const q = poi.queue(u.members[0].id % 4);
      u.members.forEach((m, i) => { const food = pickFood(), emoji = foodEmoji(food); plans[i].push(go(off(q, i, n)), wait(rnd(6, 9), 'chat')); plans[i].push({k: 'do', fn: () => attachFood(m, emoji) }); const s = seatStep(m); if (s) { plans[i].push(s[0]); plans[i].push({k: 'do', fn: () => removeFood(m) }); plans[i].push(s[1]); plans[i].push(...trashSteps()); } else { plans[i].push({k: 'do', fn: () => removeFood(m) }); } });
    } else if (r < .9) { const w = poi.wander(); all((m, i) => [go(off(w, i, n)), wait(5, i === 0 ? 'photo' : 'pose'), wait(2, 'cheer')]); }
    else { const g = poi.game(); u.members.forEach((m, i) => { plans[i].push(go(off(g, i, n)), wait(rnd(12, 24), m.kid ? 'play' : 'chat', g)); const s = m.kid ? seatStep(m) : null; if (s) plans[i].push(...s, ...trashSteps()); }); }
    return plans;
  }
  function replan(u, sitNow) {
    u.interact = false;
    if (u.kind === 'solo') { const a = u.members[0]; a.plan = soloPlan(a); if (sitNow && !a.kid) { const s = seatStep(a); if (s) { const [g0, sit] = s; a.x = g0.x; a.z = g0.z; a.root.position.set(a.x, 0, a.z); a.plan = [sit]; } } }
    else groupPlans(u).forEach((p, i) => u.members[i].plan = p);
    u.members.forEach(m => { m.step = null; });
  }

  // ---------- faces: the painted head swaps to the expression that fits what the actor is doing ----------
  const EXPR = {watch: 'smile', dance: 'smile', cheer: 'smile', wave: 'smile', highfive: 'smile', photo: 'smile', pose: 'wink', give: 'wink', hug: 'smile', eat: 'smile'};
  function setMood(a, e, secs) { a.mood = {e, until: performance.now() + secs * 1000, next: a.mood && a.mood.next}; }
  function exprFor(a, t) {
    const now = performance.now();
    if (a.mood) { if (now < a.mood.until) return a.mood.e; a.mood = null; }
    if (a.anim === 'queue') return a.t > 4 ? 'grumpy' : '';
    if (a.anim === 'play') return Math.sin(t * 6 + a.ph) > .7 ? 'surprised' : 'smile';
    if (a.moving) return a.kid ? 'smile' : '';
    return EXPR[a.anim] || '';
  }
  function setFace(a, e) {
    if (a.expr === e) return; a.expr = e;
    const L = a.g.look; a.g.head.material = People.faceMat(L.skin, e, L.eye);
  }

  // ---------- reactions with the player ----------
  const toast = (text) => {
    const d = document.createElement('div'); d.textContent = text;
    d.style.cssText = 'position:fixed;left:50%;top:84px;transform:translateX(-50%);z-index:70;background:#221833;color:#f6e7c8;border:1px solid rgba(255,255,255,.3);border-radius:14px;padding:9px 16px;font:600 13px Inter,system-ui,sans-serif;pointer-events:none;transition:opacity .5s;max-width:80vw;text-align:center';
    document.body.appendChild(d); setTimeout(() => { d.style.opacity = '0'; }, 3200); setTimeout(() => d.remove(), 3800);
  };
  const emojiTex = new Map();
  function pop(emoji, obj, y = 1.9) {
    let t = emojiTex.get(emoji);
    if (!t) { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.font = '44px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(emoji, 32, 36); t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; emojiTex.set(emoji, t); }
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({map: t, transparent: true, depthTest: false}));
    sp.renderOrder = 998; sp.scale.set(.5, .5, 1); sp.position.set(0, y, 0); obj.add(sp); pops.push({sp, life: 1.8, obj});
  }
  const live = () => liveList().filter(v => v.group);
  const target = () => { const p = player(); const lv = live(); const pool = [...lv]; if (p) pool.push({group: p.obj, self: true, name: 'you'}); return pick(pool); };
  const gx = g => g.getWorldPosition(V2).x, gz = g => g.getWorldPosition(V2).z;

  let lastHint = 0;
  function interact() {
    const p = player(); if (!p) return;
    const lv = repLv(), px = p.x, pz = p.z, R2 = (40 + lv * 9) ** 2;
    const elig = units.filter(u => !u.interact && u.members.every(m => !m.locked && !m.seat && dist2(m.x, m.z, px, pz) < R2));
    if (!elig.length) return;
    const u = pick(elig), n = u.members.length, kid = u.members.some(m => m.kid);
    const kinds = u.kind === 'solo' ? (kid ? ['highfive', 'follow', 'wave'] : ['wave', 'sprout']) : kid ? ['highfive', 'sprout', 'photo', 'dance'] : ['sprout', 'photo', 'dance', 'wave'];
    for (let i = 0; i < lv; i++) kinds.push('sprout', 'photo');   // the more Rep you have, the more generous the crowd gets
    const kind = pick(kinds);
    const now = performance.now(); u.members.forEach(m => { m.react = now + 14000; });
    if (now - lastHint > 25000) { lastHint = now; toast('👋 ' + u.members[0].name + ' is coming over — tap them for Rep!'); }
    const at = (i, d) => { const a = (i / n) * 3.2 - 1.6 + rnd(-.2, .2); return {x: px + Math.sin(a) * d, z: pz + Math.cos(a) * d, fx: px, fz: pz}; };
    u.interact = true; u.members.forEach(m => m.step = null);
    u.members.forEach((m, i) => {
      const lead = i === 0, P = [];
      if (kind === 'wave') P.push(go(at(i, 3.5)), wait(2.6, lead ? 'wave' : 'chat', {fx: px, fz: pz}));
      else if (kind === 'highfive') P.push(go(at(i, 1.1), m.kid ? 2.2 : 1.6), wait(1.6, 'highfive', {fx: px, fz: pz}), {k: 'do', fn: () => pop('✋', p.obj)}, wait(1.6, 'cheer'));
      else if (kind === 'photo') P.push(go(at(i, 1.9)), wait(4, lead ? 'photo' : 'pose', {fx: px, fz: pz}), {k: 'do', fn: () => { if (lead) pop('📸', p.obj); }}, wait(1.5, 'cheer'));
      else if (kind === 'dance') P.push(go(at(i, 2.8)), wait(rnd(9, 14), 'dance', {fx: px, fz: pz}));
      else if (kind === 'follow') P.push({k: 'follow', t: rnd(14, 22), dist: 1.5}, wait(2, 'wave', {fx: px, fz: pz}));
      else if (kind === 'sprout') {
        const tg = lead ? target() : null; if (lead) u.tg = tg || {group: p.obj, self: true};
        const tx = () => ({x: gx(u.tg.group), z: gz(u.tg.group)});
        P.push({k: 'goDyn', fn: tx, d: 1.2 + i * .5}, wait(1.8, lead ? 'give' : 'chat', null),
          {k: 'do', fn: () => { if (lead) { attachSprout(u.tg.group, pick(['collar', 'chest', 'chestL', 'chestR', 'shoulderL', 'shoulderR', 'hat', 'waist', 'hip', 'back', 'handL', 'handR', 'thighL', 'thighR', 'kneeL', 'kneeR']), 120000); pop('🌱', u.tg.group); if (u.tg.self) toast('🌱 ' + m.name + ' clipped a sprout on you!'); } else pop('👏', m.root); }}, wait(1.6, 'cheer'));
      }
      m.plan = P;
    });
  }

  // player gave one of us a sprout: hug → tell friends → a friend returns the favour
  function playerGave(id, slot, cost) {
    const a = actors[id], pl = player(); if (!a || a.staff) return;
    const p = pl || {obj: a.root, get x() { return a.x; }, get z() { return a.z; }};   // no avatar out: hug in place, friends still bring a sprout
    const u = a.unit; u.interact = true;
    const friends = u.members.filter(m => m !== a); if (friends.length === 0) friends.push(...actors.filter(m => m !== a && !m.kid).sort((m, n) => dist2(m.x, m.z, a.x, a.z) - dist2(n.x, n.z, a.x, a.z)).slice(0, 2));
    a.step = null; a.locked = false; if (a.seat) release(a);
    setMood(a, 'surprised', 1.4); a.mood.until += 0;
    a.plan = [{k: 'goDyn', fn: () => ({x: p.x, z: p.z}), d: .75, spd: 2.1}, {k: 'do', fn: () => setMood(a, 'smile', 6)}, wait(2.6, 'hug', null), {k: 'do', fn: () => { pop('❤️', a.root); if (pl) pop('❤️', p.obj); }}, wait(1.2, 'cheer')];
    friends.forEach((f, i) => {
      if (f.seat) release(f); f.step = null; f.unit.interact = true;
      setMood(f, 'surprised', 2.2);
      f.plan = [{k: 'goDyn', fn: () => ({x: a.x, z: a.z}), d: 1, spd: 1.9}, {k: 'do', fn: () => setMood(f, 'smile', 4)}, wait(2.4, 'chat', null), {k: 'do', fn: () => pop('💬', f.root)}];
      if (i === 0) f.plan.push({k: 'goDyn', fn: () => ({x: p.x, z: p.z}), d: 1.1, spd: 1.9}, wait(1.8, 'give', null), {k: 'do', fn: async () => {
        if (pl) { attachSprout(p.obj, pick(['collar', 'chest', 'shoulderL']), 120000); pop('🌱', p.obj); } else pop('🌱', f.root, 2.1);
        try { const j = await (await fetch('/api/npc-friend-gift', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({phone: o.acctPhone(), given: cost})})).json();
          toast(j && j.gift ? '🌱 ' + f.name + ' brought you a ' + j.gift + '!' : '🌱 ' + f.name + ' says thanks for being kind!'); if (j && j.gift) o.refresh(); } catch (e) {}
      }}, wait(1.5, 'cheer'));
    });
  }
  addEventListener('eol:npc-gift', e => { const d = e.detail || {}; playerGave(d.npc, d.slot, d.cost); });

  // ---------- movement + step machine ----------
  function release(a) { if (a.seatKey) taken.delete(a.seatKey); const was = a.seat; a.seatKey = null; a.seat = null; a.root.position.y = 0; if (was && _rng() < .22 && o.onLitter) o.onLitter(a.x + rnd(-.6, .6), a.z + rnd(-.6, .6)); }   // some people just leave it on the grass
  const segHitsBox = (x0, z0, x1, z1, B) => {   // segment vs the truck box (rig-local coords)
    let t0 = 0, t1 = 1; const dx = x1 - x0, dz = z1 - z0;
    for (const [p, q, lo, hi] of [[x0, dx, B.x0 + .08, B.x1 - .08], [z0, dz, B.z0 + .08, B.z1 - .08]]) {   // slightly inset: grazing the edge is fine
      if (Math.abs(q) < 1e-6) { if (p < lo || p > hi) return false; continue; }
      let a = (lo - p) / q, b = (hi - p) / q; if (a > b) [a, b] = [b, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return false;
    }
    return true;
  };
  function detour(a, tx, tz) {   // route around any obstacle (truck, tables, props, booths, water park) instead of clipping through
    const s = rig.worldToLocal(V.set(a.x, 0, a.z)).clone(), e = rig.worldToLocal(V2.set(tx, 0, tz)).clone();
    const obs = obstacles();
    // truck is now a circumradius circle (see obstacles()), so corners are covered; fall through to the generic circle detour
    // circular obstacles
    for (const o of obs) {
      if (o === null) continue;
      const ow = rig.worldToLocal(V3.set(o.x, 0, o.z));
      const ox = ow.x, oz = ow.z, r = o.r + 0.4;
      if (Math.hypot(s.x - ox, s.z - oz) < r || Math.hypot(e.x - ox, e.z - oz) < r) continue;
      const dx = e.x - s.x, dz = e.z - s.z;
      const fx = s.x - ox, fz = s.z - oz;
      const aa = dx * dx + dz * dz;
      const bb = 2 * (fx * dx + fz * dz);
      const cc = fx * fx + fz * fz - r * r;
      const disc = bb * bb - 4 * aa * cc;
      if (disc >= 0 && aa > 1e-6) {
        const t1 = (-bb - Math.sqrt(disc)) / (2 * aa);
        const t2 = (-bb + Math.sqrt(disc)) / (2 * aa);
        if ((t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1)) {
          const mid = Math.max(0, Math.min(1, t1 >= 0 ? t1 : t2));
          const px = s.x + dx * mid, pz = s.z + dz * mid;
          const ang = Math.atan2(pz - oz, px - ox);
          // try both sides, pick the one with shorter total path to target
          let bestWp = null, bestD = Infinity;
          for (const sign of [1, -1]) {
            const wx = ox + Math.cos(ang + sign * Math.PI / 2) * (r + 0.5);
            const wz = oz + Math.sin(ang + sign * Math.PI / 2) * (r + 0.5);
            // check if waypoint itself is inside another obstacle
            let blocked = false;
            for (const o2 of obs) {
              if (o2 === o) continue;
              const ow2 = rig.worldToLocal(V3.set(o2.x, 0, o2.z));
              if (Math.hypot(wx - ow2.x, wz - ow2.z) < o2.r + 0.3) { blocked = true; break; }
            }
            if (blocked) continue;
            const d = Math.hypot(wx - s.x, wz - s.z) + Math.hypot(e.x - wx, e.z - wz);
            if (d < bestD) { bestD = d; bestWp = {wx, wz}; }
          }
          if (bestWp) {
            const w = rig.localToWorld(V.set(bestWp.wx, 0, bestWp.wz));
            return [w.x, w.z];
          }
        }
      }
    }
    return [tx, tz];
  }
  function obstacles() {
    const out = [];
    const tb = o.truckBox; if (tb) { const cx = (tb.x0+tb.x1)/2, cz = (tb.z0+tb.z1)/2; const w = rig.localToWorld(new THREE.Vector3(cx,0,cz)); out.push({x:w.x, z:w.z, r: Math.hypot((tb.x1-tb.x0)/2,(tb.z1-tb.z0)/2)+0.3}); }   // circumradius so the whole truck (cab + box) is covered
    for (const t of (o.tables||[])) { if (t && t.parent) { V.set(0,0,0); t.getWorldPosition(V); out.push({x:V.x,z:V.z,r:.95}); } }
    const ps = (o.props ? (o.props() || []) : []); for (const p of (Array.isArray(ps) ? ps : [])) { if (p && p.parent) { V.set(0,0,0); p.getWorldPosition(V); out.push({x:V.x,z:V.z,r:1.1}); } }
    const vs = o.vendors ? (o.vendors() || []) : []; for (const v of (Array.isArray(vs) ? vs : Object.values(vs))) { const sp = v && (v.spot || (v.V && v.V.spot)); if (sp) out.push({x:sp[0],z:sp[1],r:1.6}); }
    if (o.jukebox && o.jukebox.parent) { V.set(0,0,0); o.jukebox.getWorldPosition(V); out.push({x:V.x,z:V.z,r:(o.jukebox.userData&&o.jukebox.userData.obstacleR)||1.2}); }
    const lrs = Array.isArray(o.lowriders) ? o.lowriders : (typeof o.lowriders === 'function' ? (o.lowriders()||[]) : []);
    for (const lr of lrs) { if (lr && lr.parent) { V.set(0,0,0); lr.getWorldPosition(V); out.push({x:V.x,z:V.z,r:(lr.userData&&lr.userData.obstacleR)||3.2}); } }
    if (o.stage && o.stage.parent) { V.set(0,0,0); o.stage.getWorldPosition(V); out.push({x:V.x,z:V.z,r:(o.stage.userData&&o.stage.userData.obstacleR)||18}); }
    const wp = o.waterpark ? o.waterpark() : null;
    if (wp) {
      const b = wp.bounds || wp.parkBounds || null;
      if (b && Number.isFinite(b.x0)) { out.push({x:(b.x0+b.x1)/2, z:(b.z0+b.z1)/2, r: Math.hypot((b.x1-b.x0)/2,(b.z1-b.z0)/2)+2}); }
      else if (wp.group) { out.push({x:-54, z:-3, r:31}); }
    }
    const extras = typeof o.extraObstacles === 'function' ? (o.extraObstacles()||[]) : (o.extraObstacles||[]);
    for (const e of (Array.isArray(extras)?extras:[])) {
      if (e && typeof e.getWorldPosition === 'function') { if (e.parent) { V.set(0,0,0); e.getWorldPosition(V); out.push({x:V.x,z:V.z,r:(e.userData&&e.userData.obstacleR)||1.4}); } }
      else if (e && Number.isFinite(e.x) && Number.isFinite(e.z)) { out.push({x:e.x,z:e.z,r:e.r||1.4}); }
    }
    return out;
  }
  function pushOut(a, tx, tz) {
    for (const o of obstacles()) {
      if (tx != null && Math.hypot(tx - o.x, tz - o.z) < o.r + .3) continue;
      const dx = a.x - o.x, dz = a.z - o.z, dd = Math.hypot(dx, dz);
      if (dd < o.r && dd > 1e-4) { a.x = o.x + dx/dd*o.r; a.z = o.z + dz/dd*o.r; }
    }
  }
  function walk(a, tx, tz, spd, dt) {
    // cache the detour waypoint so it doesn't jump every frame (which caused jitter + false stuck detection)
    const _key = tx.toFixed(1) + ',' + tz.toFixed(1);
    if (a._detourKey !== _key || !a._detourWp || (a._detourFrames || 0) > 12) {
      a._detourWp = detour(a, tx, tz); a._detourKey = _key; a._detourFrames = 0;
    }
    a._detourFrames = (a._detourFrames || 0) + 1;
    const x0 = a.x, z0 = a.z, [wx, wz] = a._detourWp, dx = wx - a.x, dz = wz - a.z, d = Math.hypot(dx, dz);
    a.moving = d > .05;
    if (a.moving) { const st = Math.min(d, spd * dt); a.x += dx / d * st; a.z += dz / d * st; pushOut(a, tx, tz); const _t = Math.atan2(dx, dz); const _dd = (((( _t - a.yaw + Math.PI) % (Math.PI*2)) + Math.PI*2) % (Math.PI*2)) - Math.PI; a.yaw += Math.sign(_dd) * Math.min(Math.abs(_dd), 0.15); a.gait += st * (a.kid ? 5.2 : 4.2); }
    // actor-actor: if bumping into another actor, interact instead of clipping (with a cooldown so they don't freeze mid-walk)
    if (!a._greetCd || a._greetCd <= 0) {
      for (const o of actors) {
        if (o === a || !o.root || !o.root.visible) continue;
        const dd = Math.hypot(o.x - a.x, o.z - a.z);
        if (dd < 0.5 && dd > 1e-4 && (!o._greetCd || o._greetCd <= 0)) {
          a.moving = false; a.anim = 'chat'; a._stuck = 0; a._greetCd = 1.5;
          o._greetCd = 1.5;
          a.face = Math.atan2(o.x - a.x, o.z - a.z);
          return false;   // a bump pauses the walk; it is not an arrival
        }
      }
    }
    if (a._greetCd > 0) a._greetCd -= dt;
    const distToTarget = Math.hypot(tx - a.x, tz - a.z);
    if (a.moving && Math.hypot(a.x - x0, a.z - z0) < spd * dt * .25) a._stuck = (a._stuck || 0) + dt; else a._stuck = 0;
    if (a._stuck > 1) { a._stuck = 0; return true; }   // really blocked for 1 s (time-based, any frame rate): give up this leg
    return distToTarget < .12;
  }
  function begin(a, s) {
    if (s.k !== 'sit' && a.seat) release(a);   // any new step after an interrupted meal: stand up, free the seat
    a.t = 0; a.anim = 'idle'; a._detourKey = null; a._detourWp = null; a._detourFrames = 0; a._lastTarget = null; a._stuck = 0;
    if (s.k === 'wait') a.anim = s.anim || 'idle';
    else if (s.k === 'sit') { a.seat = s; a.x = s.x; a.z = s.z; a.yaw = s.yaw; a.anim = 'eat'; }
    else if (s.k === 'do') { try { s.fn(); } catch (e) {} }
  }
  function tick(t, dt) {
    cam.getWorldPosition(V2); const cx = V2.x, cz = V2.z;
    for (const a of actors) {
      // stuck recovery: if an actor trying to move hasn't changed position in 2 s, teleport it to the stage
      if (!a.staff && a.moving) {
        if (a._stkX === undefined) { a._stkX = a.x; a._stkZ = a.z; a._stkT = 0; }
        a._stkT += dt;
        if (Math.hypot(a.x - a._stkX, a.z - a._stkZ) > 1.0) { a._stkX = a.x; a._stkZ = a.z; a._stkT = 0; }
        if (a._stkT > 2) {
          a.x = 8 + (_rng() - .5) * 6; a.z = -58 + (_rng() - .5) * 4;
          a._stkX = a.x; a._stkZ = a.z; a._stkT = 0; a._stuck = 0;
          a._detourKey = null; a._detourWp = null; a._detourFrames = 0;
          a.plan = []; a.step = null; a.moving = false; a.idle = true; a.anim = 'idle';
        }
      } else { a._stkX = a.x; a._stkZ = a.z; a._stkT = 0; }
      // step machine
      if (a.staff) { a.moving = false; a.step = null; }
      else if (!a.step) {
        a.step = a.plan.shift() || null;
        if (a.step) begin(a, a.step);
        else {   // plan done: wait for the rest of the unit, then everyone re-plans together
          const u = a.unit; a.anim = 'chat'; a.moving = false; a.idle = true;
          if (u.members.every(m => !m.step && !m.plan.length)) replan(u);
        }
      } else {
        const s = a.step;
        if (s.k === 'go') { if (walk(a, s.x, s.z, s.spd || a.spd, dt)) { a.step = null; a.moving = false; if (s.fx != null) a.face = yawTo(a.x, a.z, s.fx, s.fz); } }
        else if (s.k === 'goDyn') {
          const tp = s.fn(), d = Math.hypot(tp.x - a.x, tp.z - a.z); a.t += dt;
          if (d > s.d + .1 && a.t < (s.max || 12)) walk(a, tp.x - (tp.x - a.x) / d * s.d, tp.z - (tp.z - a.z) / d * s.d, s.spd || a.spd * 1.15, dt); else { a.moving = false; a.face = yawTo(a.x, a.z, tp.x, tp.z); a.step = null; }
        }
        else if (s.k === 'follow') {
          const p = player(); a.t += dt; if (!p || a.t > s.t) { a.step = null; a.moving = false; }
          else { const d = Math.hypot(p.x - a.x, p.z - a.z); if (d > s.dist) walk(a, p.x - (p.x - a.x) / d * s.dist, p.z - (p.z - a.z) / d * s.dist, 2.0, dt); else { a.moving = false; a.face = yawTo(a.x, a.z, p.x, p.z); } }
        }
        else if (s.k === 'wait' || s.k === 'sit') {
          a.moving = false; a.t += dt;
          if (s.fx != null && s.k === 'wait') a.yaw = lerpYaw(a.yaw, yawTo(a.x, a.z, s.fx, s.fz), dt * 6);
          else if (s.k === 'sit') a.yaw = lerpYaw(a.yaw, s.yaw, dt * 8);
          if (a.t >= (s.t || 1)) { if (s.k === 'sit') release(a); a.step = null; }
        }
        else a.step = null;   // 'do' handled in begin
        if (a.step === null && a.face != null && !a.moving) { const _d = ((((a.face - a.yaw + Math.PI) % (Math.PI*2)) + Math.PI*2) % (Math.PI*2)) - Math.PI; a.yaw += Math.sign(_d) * Math.min(Math.abs(_d), 0.12); if (Math.abs(_d) < 0.13) a.face = null; }
      }
      a.root.position.x = a.x; a.root.position.z = a.z; a.root.rotation.y = a.yaw;
      // if animated walking but not actually moving, stop and interact instead of sliding
      if (a.moving) {
        const dx = a.x - (a._lx || a.x), dz = a.z - (a._lz || a.z);
        if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) a._stuckWalk = (a._stuckWalk || 0) + 1;
        else a._stuckWalk = 0;
        a._lx = a.x; a._lz = a.z;
        if ((a._stuckWalk || 0) > 15) { a.moving = false; a.anim = 'chat'; a._stuckWalk = 0; if (a.step) { a.step = null; } }
      } else { a._stuckWalk = 0; }
      // cull + pose
      const d2 = dist2(a.x, a.z, cx, cz), lim = (a.near ? RANGE + 3 : RANGE) ** 2;
      a.near = d2 < lim; if (a.root.visible !== a.near) a.root.visible = a.near;
      if (a.near) { pose(a, t, dt); setFace(a, exprFor(a, t)); }
    }
    for (let i = pops.length - 1; i >= 0; i--) {
      const q = pops[i]; q.life -= dt; q.sp.position.y += dt * .5; q.sp.material.opacity = Math.min(1, q.life * 1.5); q.sp.scale.setScalar(.5 + (1.8 - q.life) * .12);
      if (q.life <= 0) { q.obj.remove(q.sp); q.sp.material.dispose(); pops.splice(i, 1); }
    }
    nextAct -= dt; if (IM > 0 && nextAct <= 0) { const lv = repLv(); nextAct = rnd(9, 18) / (1 + lv * .5) / IM; for (let k = 0; k < Math.ceil((1 + (lv >= 3) + (lv >= 5)) * IM); k++) interact(); }
    nextMosh -= dt; if (nextMosh <= 0) { nextMosh = rnd(90, 180); moshPit(8 + rnd(-4,4), -62 + rnd(-3,3), 8, 10); }
    // units whose interaction plan finished return to normal life (handled by the empty-plan replan above)
  }
  let nextAct = rnd(6, 12), nextMosh = rnd(60, 120);

  // ---------- pose ----------
  function pose(a, t, dt) {
    const g = a.g, A = g.arms, L = g.legs, r = a.root, s = g.scale || 1, ph = a.ph;
    for (let i = 0; i < 2; i++) { A[i].rotation.set(0, 0, 0); A[i].userData.sub.rotation.x = -.28; L[i].rotation.set(0, 0, 0); L[i].userData.sub.rotation.x = .05; }
    r.position.y = 0; r.rotation.z = 0;
    if (a.moving) {
      const sw = Math.sin(a.gait), k = a.kid ? .8 : .6;
      A[0].rotation.x = sw * k; A[1].rotation.x = -sw * k; L[0].rotation.x = -sw * .55; L[1].rotation.x = sw * .55;
      L[0].userData.sub.rotation.x = .05 + Math.max(0, sw) * .8; L[1].userData.sub.rotation.x = .05 + Math.max(0, -sw) * .8;
      r.position.y = Math.abs(sw) * .025 * s; return;
    }
    const an = a.anim, el = (i, v) => { A[i].userData.sub.rotation.x = v; };
    if (a.seat) {   // seated: hips on the bench, thighs forward, shins down, hands on the table / eating
      r.position.y = .475 - .9 * s;
      L[0].rotation.x = L[1].rotation.x = -1.5; L[0].userData.sub.rotation.x = L[1].userData.sub.rotation.x = 1.55;
      A[0].rotation.x = -.75; el(0, -.5); A[1].rotation.x = -.8;
      if (an === 'eat') { const c = (Math.sin(t * 2.1 + ph) + 1) / 2; el(1, -.7 - c * 1.0); A[1].rotation.x = -.9 - c * .5; }
      else el(1, -.5);
      return;
    }
    const sway = Math.sin(t * 1.3 + ph);
    r.position.y = sway * .006;
    A[0].rotation.z = -.05 + sway * .02; A[1].rotation.z = .05 - sway * .02;
    if (an === 'watch') {   // hands up to clap every few seconds
      const c = (t + ph * 3) % 7 < 2.2 ? Math.abs(Math.sin(t * 9)) : 0;
      A[0].rotation.x = A[1].rotation.x = -c * 1.2; el(0, -.28 - c * 1.1); el(1, -.28 - c * 1.1); A[0].rotation.z = -c * .2; A[1].rotation.z = c * .2;
    } else if (an === 'dance') {
      const b = Math.sin(t * 5.5 + ph), c = Math.sin(t * 5.5 + ph + 1.6);
      r.position.y = Math.abs(b) * .08 * s; r.rotation.z = b * .07;
      A[0].rotation.z = -2.3 + c * .45; A[1].rotation.z = 2.3 - c * .45; A[0].rotation.x = A[1].rotation.x = -.2;
      L[0].rotation.x = b * .35; L[1].rotation.x = -b * .35; L[0].userData.sub.rotation.x = .05 + Math.max(0, b) * .6; L[1].userData.sub.rotation.x = .05 + Math.max(0, -b) * .6;
    } else if (an === 'cheer') {
      const b = Math.abs(Math.sin(t * 7 + ph)); r.position.y = b * .09 * s; A[0].rotation.z = -2.7; A[1].rotation.z = 2.7;
    } else if (an === 'wave') { A[1].rotation.z = 2.6 + Math.sin(t * 8) * .25; el(1, -.28 - 0.2); }
    else if (an === 'highfive') { A[1].rotation.x = -2.4; A[1].rotation.z = .2; el(1, -.1); }
    else if (an === 'photo') { A[1].rotation.x = -1.6; el(1, -1.5); A[0].rotation.x = -1.2; el(0, -1.4); }
    else if (an === 'pose') { A[1].rotation.z = 2.5; el(1, -.5 + Math.sin(t * 3 + ph) * .1); }
    else if (an === 'give') { A[1].rotation.x = -1.35; el(1, -.15); A[0].rotation.x = -.2; }
    else if (an === 'hug') { A[0].rotation.x = A[1].rotation.x = -1.35; A[0].rotation.z = .5; A[1].rotation.z = -.5; el(0, -.9); el(1, -.9); r.position.y = sway * .01; }
    else if (an === 'toss') { const u = Math.min(1, a.t / 1.2), sw2 = Math.sin(u * Math.PI); A[1].rotation.x = -.4 - sw2 * 1.4 + (u > .5 ? (u - .5) * 1.6 : 0); el(1, -.5 + sw2 * .4); }
    else if (an === 'play') { const q = Math.sin(t * 6 + ph); A[0].rotation.x = -.9 + q * .25; A[1].rotation.x = -.9 - q * .25; el(0, -.5); el(1, -.5); r.rotation.z = q * .02; }
    else if (an === 'queue') { A[0].rotation.x = -.15 + Math.sin(t * 1.1 + ph) * .05; }
    else if (an === 'chat') { const q = Math.sin(t * 2.4 + ph); if (q > .3) { A[1].rotation.x = -.5 - q * .4; el(1, -.9); } }
  }

  // ---------- interaction menu shown when tapping an AI actor ----------
  function showInteractMenu(a, cx, cy) {
    // remove any existing menu
    document.querySelectorAll('.eol-interact-menu').forEach(m => m.remove());
    const opts = [
      {label: '👋 Wave', fn: () => { setMood(a, 'smile', 3); a.anim = 'wave'; pop('👋', a.root, 2.0); if (window.Avatars && window.Avatars.setAction) window.Avatars.setAction('wave'); } },
      {label: '✋ High-five', fn: () => { setMood(a, 'smile', 3); a.anim = 'highfive'; pop('✋', a.root, 2.0); if (o.onReact) o.onReact(a.name); if (window.Avatars && window.Avatars.setAction) window.Avatars.setAction('highfive'); } },
      {label: '📸 Photo', fn: () => { a.anim = 'photo'; pop('📸', a.root, 2.0); if (window.Avatars && window.Avatars.setAction) window.Avatars.setAction('photo'); } },
      {label: '💃 Dance', fn: () => { a.anim = 'dance'; a.idle = false; setMood(a, 'smile', 4); if (window.Avatars && window.Avatars.setAction) window.Avatars.setAction('dance'); } },
      {label: '🤗 Hug', fn: () => { a.anim = 'hug'; setMood(a, 'smile', 4); pop('🤗', a.root, 2.0); if (window.Avatars && window.Avatars.setAction) window.Avatars.setAction('hug'); } },
      {label: '👏 Cheer', fn: () => { cheer(a, 3); pop('👏', a.root, 2.0); if (window.Avatars && window.Avatars.setAction) window.Avatars.setAction('wave'); } },
      {label: '🌱 Give sprout', fn: () => { dispatchEvent(new CustomEvent('eol:npc-gift', {detail: {npc: a.id, slot: pick(['collar', 'chest', 'chestL', 'chestR', 'shoulderL', 'shoulderR', 'hat', 'waist', 'hip', 'back', 'handL', 'handR']), cost: 0}})); if (window.Avatars && window.Avatars.setAction) window.Avatars.setAction('give'); } },
      {label: '🚶 Follow me', fn: () => { if (a.staff) { pop('🙅', a.root, 2.0); return; } if (a.seat) release(a); a.plan = [{k: 'follow', t: 20, dist: 2.2}, wait(2, 'wave')]; a.step = null; a.idle = false; setMood(a, 'smile', 4); if (window.Avatars && window.Avatars.setAction) window.Avatars.setAction('wave'); } },   // t = seconds to tag along (0 used to end it on the next frame)
      {label: '🪢 Jump rope', fn: () => { a.anim = 'play'; a.idle = false; setMood(a, 'smile', 5); pop('🪢', a.root, 2.0); if (window.Avatars && window.Avatars.setAction) window.Avatars.setAction('dance'); } },
      {label: '💃 Salsa', fn: () => { a.anim = 'dance'; a.idle = false; setMood(a, 'smile', 5); pop('💃', a.root, 2.0); if (window.Avatars && window.Avatars.setAction) window.Avatars.setAction('dance'); } },
      {label: '🕺 Breakdance', fn: () => { a.anim = 'dance'; a.idle = false; setMood(a, 'smile', 6); pop('🕺', a.root, 2.0); if (window.Avatars && window.Avatars.setAction) window.Avatars.setAction('dance'); } },
      {label: '🎤 Sing', fn: () => { a.anim = 'chat'; a.idle = false; setMood(a, 'smile', 4); pop('🎤', a.root, 2.0); if (window.Avatars && window.Avatars.setAction) window.Avatars.setAction('wave'); } },
      {label: '🤸 Cartwheel', fn: () => { a.anim = 'play'; a.idle = false; setMood(a, 'smile', 4); pop('🤸', a.root, 2.0); if (window.Avatars && window.Avatars.setAction) window.Avatars.setAction('dance'); } },
    ];
    // pick 4 random, dedup by label
    const shuffled = opts.slice().sort(() => _rng() - .5).slice(0, 4);
    const menu = document.createElement('div');
    menu.className = 'eol-interact-menu';
    menu.style.cssText = 'position:fixed;left:' + Math.max(8, Math.min(innerWidth - 180, cx - 60)) + 'px;top:' + Math.max(8, Math.min(innerHeight - 160, cy - 20)) + 'px;z-index:9999;background:rgba(20,16,40,.95);border:1px solid rgba(255,255,255,.25);border-radius:12px;padding:6px;box-shadow:0 8px 24px rgba(0,0,0,.5);min-width:150px;';
    const title = document.createElement('div');
    title.textContent = '💬 ' + (a.name || 'Friend');
    title.style.cssText = 'color:#f2c14e;font:700 13px Inter,system-ui,sans-serif;padding:4px 8px 6px;border-bottom:1px solid rgba(255,255,255,.12);margin-bottom:4px;';
    menu.appendChild(title);
    for (const o2 of shuffled) {
      const btn = document.createElement('button');
      btn.textContent = o2.label;
      btn.style.cssText = 'display:block;width:100%;text-align:left;background:transparent;border:0;color:#fff;font:600 14px Inter,system-ui,sans-serif;padding:7px 10px;border-radius:8px;cursor:pointer;';
      btn.onmouseenter = () => { btn.style.background = 'rgba(255,255,255,.12)'; };
      btn.onmouseleave = () => { btn.style.background = 'transparent'; };
      btn.onclick = (ev) => { ev.stopPropagation(); menu.remove(); try { o2.fn(); } catch (e) {} };
      menu.appendChild(btn);
    }
    const close = document.createElement('button');
    close.textContent = '✕';
    close.style.cssText = 'position:absolute;top:4px;right:6px;background:transparent;border:0;color:rgba(255,255,255,.6);font:600 12px Inter;cursor:pointer;';
    close.onclick = (ev) => { ev.stopPropagation(); menu.remove(); };
    menu.appendChild(close);
    menu.style.position = 'fixed';
    document.body.appendChild(menu);
    // auto-close after 6 s
    setTimeout(() => { if (menu.parentNode) menu.remove(); }, 6000);
    // close on outside click
    const outside = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', outside, true); } };
    setTimeout(() => document.addEventListener('click', outside, true), 50);
  }

  // ---------- tap an actor → gift panel (capture so the scene's own tap handling doesn't also fire) ----------
  {
    let sx = 0, sy = 0, st = 0; const ray = new THREE.Raycaster(), m = new THREE.Vector2();
    canvas.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; st = performance.now(); }, true);
    canvas.addEventListener('click', e => {
      if (!e.isTrusted || Math.hypot(e.clientX - sx, e.clientY - sy) > 8 || performance.now() - st > 450) return;
      m.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(m, cam);
      const roots = actors.filter(a => a.near).map(a => a.root), hit = ray.intersectObjects(roots, true)[0];
      if (!hit || hit.distance > 14) return;
      let o2 = hit.object; while (o2 && !roots.includes(o2)) o2 = o2.parent;
      const a = actors.find(q => q.root === o2); if (!a) return;
      e.stopImmediatePropagation(); e.preventDefault();
      if (a.quest && o.onQuestTap && o.onQuestTap(a)) return;
      if (a.react && performance.now() < a.react) { a.react = 0; setMood(a, 'wink', 3); pop('⭐', a.root, 2.0); if (o.onReact) o.onReact(a.name); return; }   // answered a greeting: Rep
      showInteractMenu(a, e.clientX, e.clientY);
    }, true);
  }
  units.filter(u => u.kind !== 'staff').forEach((u, i) => replan(u, i % 3 === 0));   // opening scene: some already seated mid-meal, some at the show
  // ---------- events the vendors/quests layer can fire ----------
  function flashDance(x, z, secs, limit = 99) {   // everyone idle strolls over and dances together
    let n = 0;
    for (const u of units) {
      if (u.kind === 'staff' || u.interact || n >= limit) continue;
      u.interact = true; n++;
      u.members.forEach((m, i) => { if (m.seat) release(m); m.step = null; const a = rnd(0, 6.28), r = rnd(2, 7); m.plan = [go({x: x + Math.cos(a) * r, z: z + Math.sin(a) * r}, 2), wait(secs, 'dance', {fx: x, fz: z})]; });
    }
    return n;
  }
  function rush(x, z, secs, limit = 3) {   // a flash sale draws a few hungry units to the booth
    let n = 0;
    for (const u of units.sort(() => _rng() - .5)) {
      if (u.kind === 'staff' || u.interact || n >= limit) continue;
      u.interact = true; n++;
      u.members.forEach((m, i) => { if (m.seat) release(m); m.step = null; const sp = {x: x + (i - 1) * .8 + rnd(-.4, .4), z: z + rnd(-.4, .4), fx: x, fz: z}; /* quests passes the booth's front point */ m.plan = [go(sp, 2), wait(Math.min(secs, rnd(5, 9)), 'queue', sp)]; const st = seatStep(m); if (st) m.plan.push(...st, ...trashSteps()); });
    }
    return n;
  }
  const canPositions = () => cans.map(c => worldOf(c));
  const cheer = (a, secs) => { a.step = null; a.plan.unshift(wait(secs, 'cheer')); };
  const moshPit = (x, z, secs = 8, limit = 12) => {
    let n = 0;
    for (const u of units) {
      if (u.kind === 'staff' || u.interact || n >= limit) continue;
      u.interact = true; n++;
      u.members.forEach((m, i) => {
        if (m.seat) release(m); m.step = null;
        const a = rnd(0, 6.28), r = rnd(1, 4);
        m.plan = [go({x: x + Math.cos(a) * r, z: z + Math.sin(a) * r}, 2.6), wait(secs, 'dance', {fx: x, fz: z})];
      });
    }

    return n;
  };
  const dancersNear = (x, z, r) => actors.filter(a => a.near && a.anim === 'dance' && !a.moving && dist2(a.x, a.z, x, z) < r * r).length;
  return {tick, cans: canPositions, cheer, interactMenu: showInteractMenu, createStaff, flashDance, rush, moshPit, dancersNear, pop, toast, setMood, actors, roster: () => actors.filter(a => a.near).sort((m, n) => dist2(m.x, m.z, cam.position.x, cam.position.z) - dist2(n.x, n.z, cam.position.x, cam.position.z)).slice(0, 8).map(a => ({id: 'npc:' + a.id, name: a.name + ' (festival-goer)'}))};
}
