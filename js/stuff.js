// stuff.js — festival litter, lost items and micro-clutter, LOD'd by distance and semi-persistent.
// Every item kind is an instanced pair: a detailed mesh (only items within NEAR of the camera) and a
// simple one (only within MID); farther items are not drawn at all. Tiny "specks" (bottle caps, straws,
// confetti dots) only exist in the near tier, so detail grows as you walk up to it and costs nothing from afar.
//  - trash (cups, wrappers, cans, napkins…): tap it while your avatar is close, carry it to a trash can → Rep
//  - lost items (teddy, cap, phone, keys…): each belongs to a crowd member (or the Lost & Found box by the
//    truck) — return it for Rep
//  - decor (confetti, leaves, flyers): just there, like a real festival lawn
// Items are remembered in this browser for ~30 minutes (localStorage), picked-up ones stay picked up.
import * as THREE from 'three';
import {mergeParts} from './people.js?v=4';

const rnd = (a, b) => a + Math.random() * (b - a), pick = a => a[Math.floor(Math.random() * a.length)];
const KEY = 'eol-stuff', TTL = 30 * 60 * 1000;
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1);
const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
const cyl = (r0, r1, h, seg = 8) => new THREE.CylinderGeometry(r0, r1, h, seg), box = (w, h, d) => new THREE.BoxGeometry(w, h, d), sph = (r, w = 8, h = 6) => new THREE.SphereGeometry(r, w, h);
const hemi = r => new THREE.SphereGeometry(r, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);

// kind → {t: 'trash'|'lost'|'decor'|'speck', e: emoji, name, w: spawn weight, hi(): parts, lo(): parts}   parts = [{g, m, col}]
const K = {
  cup: {t: 'trash', e: '🥤', name: 'cup', w: 14, hi: () => [{g: cyl(.046, .034, .12), m: M(0, .06, 0), col: 0xf2e8d8}, {g: cyl(.047, .045, .03), m: M(0, .09, 0), col: 0xd02a2a}, {g: cyl(.05, .05, .012), m: M(0, .125, 0), col: 0xffffff}, {g: cyl(.005, .005, .09), m: M(.01, .17, 0, 0, 0, .25), col: 0x3aa0ff}], lo: () => [{g: cyl(.046, .034, .12), m: M(0, .06, 0), col: 0xe8dcc8}]},
  wrapper: {t: 'trash', e: '🧻', name: 'wrapper', w: 14, hi: () => [{g: box(.12, .012, .08), m: M(0, .01, 0, .1, .3, .1), col: 0xf2c14e}, {g: box(.08, .02, .06), m: M(.03, .02, .02, .4, 1, .3), col: 0xe8a020}, {g: box(.07, .018, .05), m: M(-.04, .018, -.02, .2, .6, .5), col: 0xd89010}], lo: () => [{g: box(.12, .02, .08), m: M(0, .01, 0, .1, .3, .1), col: 0xe8a020}]},
  bottle: {t: 'trash', e: '🍾', name: 'bottle', w: 8, hi: () => [{g: cyl(.03, .03, .15), m: M(0, .03, 0, 0, 0, Math.PI / 2), col: 0x3a8a4a}, {g: cyl(.012, .028, .06), m: M(.1, .03, 0, 0, 0, Math.PI / 2), col: 0x3a8a4a}, {g: cyl(.014, .014, .014), m: M(.14, .03, 0, 0, 0, Math.PI / 2), col: 0xd0d0d0}], lo: () => [{g: cyl(.03, .03, .2), m: M(.03, .03, 0, 0, 0, Math.PI / 2), col: 0x3a8a4a}]},
  can: {t: 'trash', e: '🥫', name: 'can', w: 8, hi: () => [{g: cyl(.033, .033, .11), m: M(0, .033, 0, 0, 0, Math.PI / 2), col: pick([0xd02a2a, 0x2a6ad0, 0xc8c8c8])}, {g: cyl(.028, .028, .012), m: M(.06, .033, 0, 0, 0, Math.PI / 2), col: 0xdddddd}], lo: () => [{g: cyl(.033, .033, .11), m: M(0, .033, 0, 0, 0, Math.PI / 2), col: 0xcc4444}]},
  napkin: {t: 'trash', e: '🧻', name: 'napkin', w: 8, hi: () => [{g: box(.1, .004, .1), m: M(0, .004, 0, 0, .4, 0), col: 0xffffff}, {g: box(.07, .006, .07), m: M(.02, .008, .01, .1, 1, .1), col: 0xf0ede6}], lo: () => [{g: box(.1, .006, .1), m: M(0, .004, 0, 0, .4, 0), col: 0xf4f4f4}]},
  popcorn: {t: 'trash', e: '🍿', name: 'popcorn box', w: 6, hi: () => [{g: cyl(.05, .035, .1, 4), m: M(0, .04, 0, 0, .8, 1.3), col: 0xd02a2a}, ...[0, 1, 2, 3, 4, 5].map(i => ({g: sph(.014, 5, 4), m: M(.08 + Math.cos(i) * .04, .01, Math.sin(i) * .05), col: 0xfff1c0}))], lo: () => [{g: cyl(.05, .035, .1, 4), m: M(0, .04, 0, 0, .8, 1.3), col: 0xd02a2a}]},
  plate: {t: 'trash', e: '🍽️', name: 'plate', w: 6, hi: () => [{g: cyl(.1, .085, .01, 12), m: M(0, .006, 0), col: 0xfafafa}, {g: sph(.04, 6, 4), m: M(.01, .02, 0, 0, 0, 0, 1.4, .5, 1), col: 0xc8802a}, {g: sph(.02, 5, 4), m: M(-.04, .02, .02), col: 0x4aa04a}], lo: () => [{g: cyl(.1, .085, .012, 8), m: M(0, .006, 0), col: 0xf4f4f4}]},
  teddy: {t: 'lost', e: '🧸', name: 'teddy bear', w: 3, hi: () => [{g: sph(.07), m: M(0, .08, 0, 0, 0, 0, 1, 1.15, .9), col: 0xa8723a}, {g: sph(.05), m: M(0, .18, .01), col: 0xb8823a}, {g: sph(.02, 6, 4), m: M(-.04, .23, 0), col: 0x8a5a2a}, {g: sph(.02, 6, 4), m: M(.04, .23, 0), col: 0x8a5a2a}, {g: sph(.025, 6, 4), m: M(0, .17, .05), col: 0xe8c898}, {g: sph(.035, 6, 4), m: M(-.08, .1, .03), col: 0xa8723a}, {g: sph(.035, 6, 4), m: M(.08, .1, .03), col: 0xa8723a}, {g: sph(.04, 6, 4), m: M(-.04, .03, .05), col: 0xa8723a}, {g: sph(.04, 6, 4), m: M(.04, .03, .05), col: 0xa8723a}], lo: () => [{g: sph(.07), m: M(0, .08, 0, 0, 0, 0, 1, 1.15, .9), col: 0xa8723a}, {g: sph(.05), m: M(0, .18, 0), col: 0xb8823a}]},
  duck: {t: 'lost', e: '🦆', name: 'plush duck', w: 2, hi: () => [{g: sph(.06), m: M(0, .06, 0, 0, 0, 0, 1, .9, 1.2), col: 0xffd23a}, {g: sph(.045), m: M(0, .13, .05), col: 0xffd23a}, {g: box(.04, .012, .03), m: M(0, .125, .1), col: 0xff8a1a}], lo: () => [{g: sph(.06), m: M(0, .06, 0, 0, 0, 0, 1, .9, 1.2), col: 0xffd23a}, {g: sph(.045), m: M(0, .13, .05), col: 0xffd23a}]},
  cap: {t: 'lost', e: '🧢', name: 'baseball cap', w: 3, hi: () => { const c = pick([0x2a5ad0, 0xd02a2a, 0x2aa04a]); return [{g: hemi(.09), m: M(0, 0, 0), col: c}, {g: cyl(.09, .09, .008, 10), m: M(.02, .005, .07, 0, 0, 0, 1, 1, .8), col: c}, {g: sph(.012, 5, 4), m: M(0, .09, 0), col: 0xffffff}]; }, lo: () => [{g: hemi(.09), m: M(0, 0, 0), col: 0x2a5ad0}]},
  shades: {t: 'lost', e: '🕶️', name: 'sunglasses', w: 3, hi: () => [{g: cyl(.032, .032, .006, 10), m: M(-.04, .02, 0, 1.4, 0, 0), col: 0x14141a}, {g: cyl(.032, .032, .006, 10), m: M(.04, .02, 0, 1.4, 0, 0), col: 0x14141a}, {g: box(.03, .004, .006), m: M(0, .03, 0), col: 0x14141a}, {g: box(.004, .004, .09), m: M(-.075, .03, -.04), col: 0x14141a}, {g: box(.004, .004, .09), m: M(.075, .03, -.04), col: 0x14141a}], lo: () => [{g: box(.15, .01, .045), m: M(0, .02, 0), col: 0x14141a}]},
  phone: {t: 'lost', e: '📱', name: 'phone', w: 2, hi: () => [{g: box(.04, .008, .08), m: M(0, .006, 0, 0, .5, 0), col: 0x22262e}, {g: box(.034, .002, .068), m: M(0, .011, 0, 0, .5, 0), col: 0x4a90d9}], lo: () => [{g: box(.04, .01, .08), m: M(0, .006, 0, 0, .5, 0), col: 0x22262e}]},
  wallet: {t: 'lost', e: '👛', name: 'wallet', w: 2, hi: () => [{g: box(.08, .018, .055), m: M(0, .01, 0, 0, .4, 0), col: 0x6a3a1a}, {g: box(.06, .004, .02), m: M(0, .02, 0, 0, .4, 0), col: 0x8a5a2a}], lo: () => [{g: box(.08, .02, .055), m: M(0, .01, 0, 0, .4, 0), col: 0x6a3a1a}]},
  keys: {t: 'lost', e: '🔑', name: 'keys', w: 2, hi: () => [{g: new THREE.TorusGeometry(.022, .004, 5, 10), m: M(0, .006, 0, Math.PI / 2, 0, 0), col: 0xc8c8c8}, ...[0, 1, 2].map(i => ({g: box(.01, .004, .05), m: M(Math.cos(i - 1) * .02, .006, .05 + .02, 0, i - 1, 0), col: 0xd8c870}))], lo: () => [{g: box(.04, .006, .07), m: M(0, .006, .03), col: 0xc8c8c8}]},
  ball: {t: 'lost', e: '⚽', name: 'toy ball', w: 2, hi: () => [{g: sph(.055, 10, 8), m: M(0, .055, 0), col: pick([0xff5a3a, 0x3a8aff, 0xffd23a])}, {g: new THREE.TorusGeometry(.055, .006, 5, 14), m: M(0, .055, 0), col: 0xffffff}], lo: () => [{g: sph(.055, 7, 5), m: M(0, .055, 0), col: 0xff5a3a}]},
  shoe: {t: 'lost', e: '👟', name: 'little shoe', w: 2, hi: () => [{g: sph(.04, 8, 6), m: M(0, .035, 0, 0, 0, 0, 1, .8, 2.2), col: pick([0xff5a7a, 0x3ad8ff, 0xffffff])}, {g: box(.06, .01, .17), m: M(0, .006, .005), col: 0xf4f4f4}], lo: () => [{g: sph(.04, 6, 4), m: M(0, .035, 0, 0, 0, 0, 1, .8, 2.2), col: 0xff5a7a}]},
  confetti: {t: 'decor', name: 'confetti', w: 10, hi: () => [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({g: box(.025, .002, .012), m: M(rnd(-.2, .2), .002, rnd(-.2, .2), 0, rnd(0, 3), 0), col: pick([0xe83a73, 0xf2c14e, 0x4fc3d9, 0x6aff7a, 0xb44dff])})), lo: () => [{g: box(.22, .002, .22), m: M(0, .002, 0), col: 0xf2c14e}]},
  leaf: {t: 'decor', name: 'leaf', w: 6, hi: () => [{g: sph(.05, 6, 4), m: M(0, .005, 0, 0, rnd(0, 3), 0, 1, .06, 1.8), col: pick([0xb8602a, 0xd8a02a, 0x7a8a2a])}, {g: box(.004, .004, .07), m: M(0, .01, 0), col: 0x6a4a1a}], lo: () => [{g: sph(.05, 5, 3), m: M(0, .005, 0, 0, 0, 0, 1, .06, 1.8), col: 0xb8802a}]},
  flyer: {t: 'decor', name: 'flyer', w: 5, hi: () => [{g: box(.11, .002, .15), m: M(0, .004, 0, .05, rnd(0, 3), .04), col: pick([0xfff4c0, 0xffffff, 0xf8c8d8])}], lo: () => [{g: box(.11, .003, .15), m: M(0, .004, 0, 0, 0, 0), col: 0xfff4c0}]},
  speck: {t: 'speck', name: 'speck', w: 0, hi: () => [{g: cyl(.012, .012, .004, 6), m: M(0, .003, 0), col: 0xffffff}], lo: () => []},
};

export function init(o) {
  const {S, cam, rig, truckBox, player, canvas, lite, phone: isPhone, rep, getLife} = o, small = lite || isPhone;
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const CL = Math.max(0, Math.min(3, num(o.clutterMult, 1)));   // 🥤 clutter multiplier (Admin → crowd settings)
  const NEAR = Math.max(2, num(o.near, 0) || (small ? 9 : 16));          // Admin → Environment overrides (0 = auto)
  const MID = Math.max(NEAR + 2, num(o.mid, 0) || (small ? 20 : 38)), CAP = 260;
  const mat = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .75, metalness: .03});
  const kinds = Object.keys(K), pools = {};
  for (const k of kinds) {
    const mk = parts => { if (!parts.length) return null; const g = mergeParts(parts, 'color'), im = new THREE.InstancedMesh(g, mat, k === 'speck' ? 400 : CAP); im.count = 0; im.frustumCulled = false; im.receiveShadow = true; im.userData.steamSkip = true; S.add(im); return im; };
    pools[k] = {hi: mk(K[k].hi()), lo: K[k].lo().length ? mk(K[k].lo()) : null, slots: {hi: [], lo: []}};
  }
  const items = [];   // {id, k, x, z, ry, ts, owner(name), gone}
  let uid = 1, carry = null, nextSave = 0;

  // ---------- spawn / persistence ----------
  const AREAS = [{x0: -30, x1: 44, z0: -5, z1: 30, w: 6}, {x0: -8, x1: 24, z0: -62, z1: -52, w: 2}, {x0: -42, x1: -34, z0: -8, z1: 6, w: 1}];
  const inTruck = (x, z) => { const l = rig.worldToLocal(new THREE.Vector3(x, 0, z)); return l.x > truckBox.x0 && l.x < truckBox.x1 && l.z > truckBox.z0 && l.z < truckBox.z1; };
  const weights = kinds.filter(k => K[k].w).flatMap(k => Array(K[k].w).fill(k));
  function spot() { for (let i = 0; i < 12; i++) { const a = pick(AREAS.flatMap(A => Array(A.w).fill(A))), x = rnd(a.x0, a.x1), z = rnd(a.z0, a.z1); if (!inTruck(x, z)) return {x, z}; } return {x: 10, z: 12}; }
  function add(k, x, z, owner, id) { const it = {id: id || uid++, k, x, z, ry: rnd(0, 6.28), ts: Date.now(), owner: owner || null, gone: false}; items.push(it); return it; }
  const ownerName = () => { const L = getLife && getLife(); const a = L && L.actors.filter(q => !q.staff && !q.kid).sort(() => Math.random() - .5)[0]; return a ? a.name : null; };
  function populate() {
    const nTrash = Math.round((small ? 34 : 80) * CL), nDecor = Math.round((small ? 14 : 34) * CL);
    for (let i = 0; i < nTrash + nDecor; i++) { const k = pick(weights); if (K[k].t === 'lost') continue; const p = spot(); add(k, p.x, p.z); }
    topUpLost();
  }
  function topUpLost() {
    let have = items.filter(i => !i.gone && K[i.k].t === 'lost').length;
    while (have < (small ? 4 : 7)) { const k = pick(kinds.filter(q => K[q].t === 'lost')), p = spot(); add(k, p.x, p.z, ownerName()); have++; }
  }
  try {
    const sv = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (sv && Array.isArray(sv.items) && Date.now() - sv.saved < TTL) { for (const r of sv.items) if (K[r.k] && Number.isFinite(r.x) && Number.isFinite(r.z) && Date.now() - r.ts < TTL) { const it = add(r.k, r.x, r.z, r.owner, uid++); it.ry = r.ry || 0; it.ts = r.ts; } uid = items.length + 1; }
  } catch (e) {}
  if (items.length < 20) populate();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({saved: Date.now(), items: items.filter(i => !i.gone).map(i => ({k: i.k, x: +i.x.toFixed(2), z: +i.z.toFixed(2), ry: +i.ry.toFixed(2), ts: i.ts, owner: i.owner}))})); } catch (e) {} };

  // specks: the micro-clutter shown only when you're close (a fixed scatter, drawn within NEAR)
  const specks = []; for (let i = 0; i < (small ? 120 : 320); i++) { const p = spot(); specks.push({x: p.x, z: p.z, ry: rnd(0, 6.28), c: pick([0xd0d0d0, 0xd02a2a, 0xf2c14e, 0x4fc3d9, 0x8a6a3a, 0xffffff])}); }
  const col = new THREE.Color();

  // ---------- LOD pass (every .35 s) ----------
  const M4 = new THREE.Matrix4(), cp = new THREE.Vector3();
  function lod() {
    cam.getWorldPosition(cp);
    for (const k of kinds) { const P = pools[k]; P.slots.hi.length = 0; P.slots.lo.length = 0; }
    for (const it of items) {
      if (it.gone) continue;
      const d = Math.hypot(it.x - cp.x, it.z - cp.z), P = pools[it.k];
      const tier = d < (it.t === 'hi' ? NEAR + 2 : NEAR) ? 'hi' : d < (it.t ? MID + 4 : MID) ? 'lo' : null;
      it.t = tier; if (!tier) continue;
      const im = P[tier] || P.hi; if (!im) continue;
      const list = P.slots[P[tier] ? tier : 'hi'];
      if (list.length >= CAP) continue;
      im.setMatrixAt(list.length, M4.compose(_p.set(it.x, .015, it.z), _q.setFromEuler(_e.set(it.rx || 0, it.ry, it.rz || 0)), _s.set(1, 1, 1))); list.push(it);
    }
    for (const k of kinds) { if (k === 'speck') continue; const P = pools[k]; for (const t of ['hi', 'lo']) { const im = P[t]; if (!im) continue; im.count = P.slots[t].length; im.instanceMatrix.needsUpdate = true; im.visible = im.count > 0; } }
    const sp = pools.speck.hi; let n = 0;
    for (const s of specks) { if (Math.hypot(s.x - cp.x, s.z - cp.z) > NEAR) continue; sp.setMatrixAt(n, M4.compose(_p.set(s.x, .01, s.z), _q.setFromEuler(_e.set(0, s.ry, 0)), _s.set(1, 1, 1))); sp.setColorAt(n, col.setHex(s.c)); n++; if (n >= 400) break; }
    sp.count = n; sp.instanceMatrix.needsUpdate = true; if (sp.instanceColor) sp.instanceColor.needsUpdate = true; sp.visible = n > 0;
  }

  // ---------- carrying + dropping ----------
  const chip = document.createElement('button');
  chip.style.cssText = 'position:fixed;left:12px;top:176px;z-index:60;display:none;max-width:70vw;text-align:left;font:600 12.5px Inter,system-ui,sans-serif;color:#f6e7c8;background:#221833e8;border:1px solid rgba(242,193,78,.5);border-radius:12px;padding:8px 12px;cursor:pointer';
  document.body.appendChild(chip);
  const toast = t => { const L = getLife && getLife(); if (L) L.toast(t); };
  const setChip = () => { if (!carry) { chip.style.display = 'none'; return; } const K0 = K[carry.k]; chip.style.display = 'block'; chip.textContent = K0.t === 'lost' ? `${K0.e} Carrying ${K0.name}${carry.owner ? ' — return it to ' + carry.owner : ' — take it to the Lost & Found'} (tap to put down)` : `${K0.e} Carrying a ${K0.name} — find a trash can (tap to put down)`; };
  chip.onclick = () => { if (!carry) return; const p = player(); if (p) { carry.x = p.x + rnd(-.6, .6); carry.z = p.z + rnd(-.6, .6); carry.gone = false; carry.ts = Date.now(); } carry = null; setChip(); save(); };
  let tidy = 0;
  const done = () => { const i = items.indexOf(carry); if (i >= 0) items.splice(i, 1); const d = {kind: K[carry.k].t, id: carry.id}; carry = null; setChip(); dispatchEvent(new CustomEvent('eol:stuff-delivered', {detail: d})); };   // delivered: the item is gone for good
  const reward = why => {   // every 3rd piece of trash = +1 Rep, a returned lost item = +2
    let amt = 2; if (why !== 'lost') { if (++tidy < 3) return; tidy = 0; amt = 1; }
    rep.add('quest', amt).then(() => toast(`⭐ +${amt} Rep — ${why === 'lost' ? 'returned with thanks!' : 'tidy festival, happy visitors!'}  (${rep.title()}, ${rep.points()})`));
  };

  // tap an item (capture first so crowd/scene taps don't also fire); pick up when your avatar is close
  {
    const ray = new THREE.Raycaster(), m = new THREE.Vector2(); let sx = 0, sy = 0, st = 0;
    canvas.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; st = performance.now(); }, true);
    canvas.addEventListener('click', e => {
      if (!e.isTrusted || Math.hypot(e.clientX - sx, e.clientY - sy) > 8 || performance.now() - st > 450) return;
      m.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(m, cam); ray.far = 40;
      const meshes = [], map = new Map();
      for (const k of kinds) { if (K[k].t === 'decor' || K[k].t === 'speck') continue; for (const t of ['hi', 'lo']) { const im = pools[k][t]; if (im && im.count) { meshes.push(im); map.set(im, pools[k].slots[t]); } } }
      const hit = ray.intersectObjects(meshes, false)[0]; if (!hit || hit.instanceId == null) return;
      const it = map.get(hit.object)[hit.instanceId]; if (!it) return;
      e.stopImmediatePropagation(); e.preventDefault();
      const p = player(); if (!p) { toast('🚶 Open the menu or press an arrow key to get your avatar, then walk over to pick things up.'); return; }
      if (Math.hypot(p.x - it.x, p.z - it.z) > 4.5) { toast('🚶 Walk your avatar closer to the ' + K[it.k].name + ' first.'); return; }
      if (carry) { toast('🙌 Your hands are full — put down or deliver what you carry first.'); return; }
      it.gone = true; carry = it; setChip(); save();
      const L = getLife && getLife(); if (L) { L.pop(K[it.k].e, p.obj, 2.1); const ow = it.owner && L.actors.find(a => a.name === it.owner); if (ow) L.pop('❗', ow.root, 2.2); }
    }, true);
  }
  const KC = () => { const L = getLife && getLife(); return L && L.cans ? L.cans() : []; };
  const BOX = new THREE.Vector3();   // Lost & Found crate by the serving window (rig-local → world each time)
  const crate = new THREE.Group(); {
    const b = new THREE.Mesh(new THREE.BoxGeometry(.9, .6, .6), new THREE.MeshStandardMaterial({color: 0x8a6a3a, roughness: .8})); b.position.y = .3; crate.add(b);
    const c = document.createElement('canvas'); c.width = 256; c.height = 96; const g = c.getContext('2d'); g.fillStyle = '#fff8ec'; g.fillRect(0, 0, 256, 96); g.fillStyle = '#2b2420'; g.font = '700 30px Inter,sans-serif'; g.textAlign = 'center'; g.fillText('LOST & FOUND', 128, 44); g.font = '600 18px Inter,sans-serif'; g.fillText("Finders keepers? Nope — losers weepers!", 128, 78);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const s = new THREE.Mesh(new THREE.PlaneGeometry(.9, .34), new THREE.MeshBasicMaterial({map: t})); s.position.set(0, .78, .31); crate.add(s);
    crate.position.set(o.crate ? o.crate.x : -5, 0, o.crate ? o.crate.z : 4.5); rig.add(crate);
  }
  function deliver() {
    if (!carry) return; const p = player(); if (!p) return; const L = getLife && getLife(); const kd = K[carry.k];
    if (kd.t === 'trash') {
      for (const c of KC()) if (Math.hypot(p.x - c.x, p.z - c.z) < 2.2) { done(); if (L) L.pop('🗑️', p.obj, 2.1); reward('trash'); save(); return; }
    } else {
      const ow = carry.owner && L && L.actors.find(a => a.name === carry.owner);
      if (ow && Math.hypot(p.x - ow.x, p.z - ow.z) < 2.6) { if (L) { L.pop('❤️', ow.root, 2.1); L.setMood(ow, 'smile', 6); L.cheer(ow, 2.5); } toast(`💛 ${ow.name}: "My ${kd.name}! You're the best!"`); done(); reward('lost'); topUpLost(); save(); return; }
      crate.getWorldPosition(BOX);
      if (Math.hypot(p.x - BOX.x, p.z - BOX.z) < 2.4) { done(); if (L) L.pop('📦', p.obj, 2.1); reward('lost'); topUpLost(); save(); }
    }
  }
  let acc = 0, dropT = rnd(12, 24);
  return {
    // a crowd member leaves litter / drops something at (x, z)
    drop(x, z) { if (items.length < 400 && !inTruck(x, z)) { add(pick(['cup', 'wrapper', 'napkin', 'plate', 'popcorn', 'can', 'bottle']), x, z); } },
    spawnLost(kind, x, z, owner) { return add(K[kind] ? kind : 'teddy', x, z, owner); },
    tick(t, dt) {
      acc += dt; if (acc > .35) { acc = 0; lod(); deliver(); }
      dropT -= dt; if (CL > 0 && dropT <= 0) { dropT = rnd(14, 30) / CL; const p = spot(); add(pick(weights.filter(k => K[k].t === 'trash')), p.x, p.z); if (items.filter(i => !i.gone && K[i.k].t === 'trash').length > (small ? 60 : 130)) { const old = items.find(i => !i.gone && K[i.k].t === 'trash'); if (old) old.gone = true; } }
      if ((nextSave -= dt) <= 0) { nextSave = 20; for (let i = items.length - 1; i >= 0; i--) if (items[i].gone && items[i] !== carry) items.splice(i, 1); save(); }   // prune picked-up/expired items
    },
    items, carrying: () => carry, crate: () => crate,
  };
}
