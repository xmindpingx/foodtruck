// waterpark.js — "Sir Splash-a-Lot Water Park" on the west side of the lot (x -72…-36, z -28…22).
// A wave pool, a lazy river with tubes, bumper boats, two tube slides, water cannons and a squirt fight,
// with swimsuited bathers, loungers and a pun-sign entrance. Phone budget: everything is primitives or
// merged people (2 draw calls each); the whole park is hidden until the camera is within range, and water
// animation (wave vertices, droplets, boats, riders) only runs while it is visible.
import * as THREE from 'three';
import * as People from './people.js?v=4';

const rnd = (a, b) => a + Math.random() * (b - a), pick = a => a[Math.floor(Math.random() * a.length)];
const CX = -53;   // park centre line
export const PARK = {x0: -72, x1: -36, z0: -28, z1: 22, gate: {x: -36, z: -3}};

function tileTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#efe3c8'; g.fillRect(0, 0, 128, 128); g.strokeStyle = 'rgba(120,100,70,.28)'; g.lineWidth = 2;
  for (let i = 0; i <= 128; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function waterTex() {   // soft caustic ripples
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#7fd8ee'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 46; i++) { const x = Math.random() * 128, y = Math.random() * 128, r = 5 + Math.random() * 14; g.strokeStyle = `rgba(255,255,255,${.1 + Math.random() * .18})`; g.lineWidth = 1.4; g.beginPath(); g.ellipse(x, y, r, r * .5, Math.random() * 3, 0, 6.3); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function signTex(text, sub) {
  const c = document.createElement('canvas'); c.width = 768; c.height = 220; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 220); gr.addColorStop(0, '#1fb8d8'); gr.addColorStop(1, '#0a6fa8'); g.fillStyle = gr; g.fillRect(0, 0, 768, 220);
  g.strokeStyle = '#fff'; g.lineWidth = 10; g.strokeRect(8, 8, 752, 204);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = '800 62px Inter, sans-serif'; g.fillText(text, 384, 108);
  g.fillStyle = '#ffe27a'; g.font = '700 34px Inter, sans-serif'; g.fillText(sub, 384, 170);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const PUNS = ['CLOSED FOR REPAIRS|The lazy river got lazy and quit.', 'CLOSED FOR REPAIRS|Wave pool is taking a break. It just wasn\'t feeling the vibe.', 'CLOSED FOR REPAIRS|We\'re draining our resources. Back soon!',
  'CLOSED FOR REPAIRS|The slides hit a rough patch. Total downturn.', 'CLOSED FOR REPAIRS|Bumper boats are in dry dock. Long story. Boat-ful.', 'CLOSED FOR REPAIRS|Please be patient — we\'re in over our heads.',
  'CLOSED FOR REPAIRS|Water you waiting for? Not this. It\'s closed.', 'CLOSED FOR REPAIRS|Reopening soon. Please don\'t make a splash about it.', 'CLOSED FOR REPAIRS|Our plumber is on a pipe dream. Back shortly.', 'CLOSED FOR REPAIRS|Gone fishin\'. Sea you later!'];

// "closed for repairs": a fenced gate, caution tape, cones, tarped slides and a sign that cycles water puns (or the admin's own line)
function closedPark(S, o) {
  const {cam, lite, phone: isPhone, message} = o, G = new THREE.Group(); G.userData.steamSkip = true; S.add(G);
  const std = (c, r = .7, m = 0, e) => new THREE.MeshStandardMaterial({color: c, roughness: r, metalness: m, ...e});
  const add = (m, x, y, z) => { m.position.set(x, y, z); G.add(m); return m; };
  const gz = PARK.gate.z;
  add(new THREE.Mesh(new THREE.BoxGeometry(.3, 1.1, 40), std(0xf4efe2)), PARK.x1, .55, gz - 21); add(new THREE.Mesh(new THREE.BoxGeometry(.3, 1.1, 40), std(0xf4efe2)), PARK.x1, .55, gz + 21);
  const gate = add(new THREE.Mesh(new THREE.BoxGeometry(.2, 1.6, 6.2), std(0xffd23a, .5, 0, {})), PARK.x1 + .1, .9, gz);   // closed gate, hazard-yellow
  for (let i = 0; i < 6; i++) add(new THREE.Mesh(new THREE.BoxGeometry(.24, .22, 1), std(i % 2 ? 0x1c1816 : 0xffd23a, .6)), PARK.x1 + .12, .35 + (i >> 1) * .5, gz - 2.3 + i * 0 + (i % 2) * 0);
  for (let i = 0; i < 8; i++) { const c = add(new THREE.Mesh(new THREE.ConeGeometry(.28, .7, 10), std(0xff7a1a, .6)), PARK.x1 + 1.6, .35, gz - 5 + i * 1.4); add(new THREE.Mesh(new THREE.CylinderGeometry(.285, .285, .1, 10), std(0xffffff, .6)), PARK.x1 + 1.6, .42, gz - 5 + i * 1.4); }
  for (const [x, z, s] of [[-66, 12, 1.6], [-45, -20, 1.9]]) { const t = add(new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), std(0x3a6fbf, .9)), x, .6, z); t.scale.set(s * 1.6, s * .6, s); }   // tarped-over "slides"
  const mound = add(new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), std(0x9a7a4a, .95)), -52, .3, -19); mound.scale.set(8, .6, 5);
  add(new THREE.Mesh(new THREE.BoxGeometry(.9, 1.1, .08), std(0xffd23a, .5)), PARK.x1 + 2.8, .6, gz + 2.2).rotation.set(0, 1.1, 0);   // wet-floor A-frame
  const cv = document.createElement('canvas'); cv.width = 768; cv.height = 360; const g = cv.getContext('2d'), tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  let n = Math.floor(Math.random() * PUNS.length);
  const paint = () => {
    const [h, sub] = (message ? 'CLOSED FOR REPAIRS|' + message : PUNS[n % PUNS.length]).split('|');
    g.fillStyle = '#ffd23a'; g.fillRect(0, 0, 768, 360); g.fillStyle = '#1c1816'; for (let i = -2; i < 12; i++) { g.beginPath(); g.moveTo(i * 80, 0); g.lineTo(i * 80 + 40, 0); g.lineTo(i * 80 - 40, 60); g.lineTo(i * 80 - 80, 60); g.fill(); g.beginPath(); g.moveTo(i * 80, 360); g.lineTo(i * 80 + 40, 360); g.lineTo(i * 80 - 40, 300); g.lineTo(i * 80 - 80, 300); g.fill(); }
    g.fillStyle = '#1c1816'; g.textAlign = 'center'; g.font = '800 54px Inter, sans-serif'; g.fillText('🚧 ' + h + ' 🚧', 384, 130);
    g.font = '700 30px Inter, sans-serif'; const words = sub.split(' '); let line = '', y = 200; for (const wd of words) { if (g.measureText(line + wd).width > 660) { g.fillText(line, 384, y); y += 42; line = ''; } line += wd + ' '; } g.fillText(line, 384, y);
    g.font = '600 24px Inter, sans-serif'; g.fillText('Sir Splash-a-Lot Water Park', 384, 335); tex.needsUpdate = true;
  };
  paint();
  const sign = add(new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.6), new THREE.MeshBasicMaterial({map: tex, side: THREE.DoubleSide})), PARK.x1 + .3, 3.6, gz); sign.rotation.y = Math.PI / 2;
  for (const dz of [-2.8, 2.8]) add(new THREE.Mesh(new THREE.CylinderGeometry(.1, .12, 3.6, 8), std(0x7a5a38, .9)), PARK.x1 + .3, 1.8, gz + dz);
  G.visible = false; const RANGE = (lite || isPhone) ? 45 : 85, v = new THREE.Vector3(); let nextPun = 7;
  return {closed: true, group: G, guards: [], towers: [], poi: {}, bounds: PARK, zones: [], splash: () => {}, tick(t, dt) {
    cam.getWorldPosition(v); G.visible = Math.hypot(v.x - PARK.x1, v.z - gz) < RANGE; if (!G.visible) return;
    if (!message && (nextPun -= dt) < 0) { nextPun = 7; n++; paint(); }
  }};
}

export function init(S, o) {
  if (o.open === false) return closedPark(S, o);
  const {lite, phone: isPhone, cam, player, onUse} = o, small = lite || isPhone;
  const G = new THREE.Group(); G.userData.steamSkip = true; S.add(G);   // keeps its own bright colours under any theme
  // each part of the park hides on its own when the camera is far from it (phones use ~60% of these radii)
  const sec = {}; let cur = G;
  const mkSec = (name, x, z, r) => { const g = new THREE.Group(); G.add(g); sec[name] = {g, x, z, r: small ? r * .6 : r, on: false}; cur = g; return g; };
  mkSec('deck', -53, -3, 120);
  const std = (color, rough = .6, metal = 0, extra) => new THREE.MeshStandardMaterial({color, roughness: rough, metalness: metal, ...extra});
  const waterM = new THREE.MeshStandardMaterial({map: waterTex(), color: 0xbfeaf5, transparent: true, opacity: .86, roughness: .12, metalness: .1});
  waterM.map.repeat.set(6, 6);
  const add = (m, x, y, z, parent = cur) => { m.position.set(x, y, z); parent.add(m); return m; };
  const W = (x0, x1) => (x0 + x1) / 2;

  // ---------- deck, walls, gate ----------
  const dt = tileTex(); dt.repeat.set(10, 14);
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(PARK.x1 - PARK.x0, PARK.z1 - PARK.z0), std(0xffffff, .85, 0, {map: dt}));
  deck.rotation.x = -Math.PI / 2; deck.receiveShadow = true; add(deck, W(PARK.x0, PARK.x1), .03, W(PARK.z0, PARK.z1));
  const wallM = std(0xf4efe2, .8), trimM = std(0x2fb8d8, .5);
  for (const [w, d, x, z] of [[PARK.x1 - PARK.x0, .3, W(PARK.x0, PARK.x1), PARK.z0], [PARK.x1 - PARK.x0, .3, W(PARK.x0, PARK.x1), PARK.z1], [.3, PARK.z1 - PARK.z0, PARK.x0, W(PARK.z0, PARK.z1)]]) {
    add(new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, d), wallM), x, .55, z); add(new THREE.Mesh(new THREE.BoxGeometry(w + .05, .12, d + .1), trimM), x, 1.15, z);
  }
  for (const [z0, z1] of [[PARK.z0, PARK.gate.z - 3], [PARK.gate.z + 3, PARK.z1]]) {   // east wall with a gate gap
    const L = z1 - z0; add(new THREE.Mesh(new THREE.BoxGeometry(.3, 1.1, L), wallM), PARK.x1, .55, (z0 + z1) / 2); add(new THREE.Mesh(new THREE.BoxGeometry(.4, .12, L), trimM), PARK.x1, 1.15, (z0 + z1) / 2);
  }
  for (const dz of [-3, 3]) add(new THREE.Mesh(new THREE.CylinderGeometry(.22, .26, 4.2, 10), std(0xf4efe2, .6)), PARK.x1, 2.1, PARK.gate.z + dz);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 1.8), new THREE.MeshBasicMaterial({map: signTex('SIR SPLASH-A-LOT', "Water Park · don't be koi, jump in!"), side: THREE.DoubleSide}));
  sign.rotation.y = Math.PI / 2; add(sign, PARK.x1, 4.9, PARK.gate.z);
  add(new THREE.Mesh(new THREE.BoxGeometry(.3, .3, 6.6), trimM), PARK.x1, 3.95, PARK.gate.z);

  // ---------- wave pool ----------
  mkSec('wave', -53, -19, 95);
  const WP = {x: CX, z: -19, w: 18, d: 12};
  const rim = (x, z, w, d) => { const r = new THREE.Mesh(new THREE.BoxGeometry(w + .8, .16, d + .8), std(0xdfe8ee, .5)); add(r, x, .08, z); const bed = new THREE.Mesh(new THREE.BoxGeometry(w, .1, d), std(0x1f9ac0, .8)); add(bed, x, .06, z); };
  rim(WP.x, WP.z, WP.w, WP.d);
  const wg = new THREE.PlaneGeometry(WP.w, WP.d, small ? 18 : 36, small ? 12 : 24); wg.rotateX(-Math.PI / 2);
  const wave = new THREE.Mesh(wg, waterM); add(wave, WP.x, .4, WP.z);
  const wpos = wg.attributes.position, wbase = Float32Array.from(wpos.array);
  add(new THREE.Mesh(new THREE.BoxGeometry(.9, 1.4, WP.d), std(0x2f6f8f, .5, .3)), WP.x - WP.w / 2 - .2, .7, WP.z);   // the wave machine
  const beach = new THREE.Mesh(new THREE.BoxGeometry(2.2, .3, WP.d + .8), std(0xe8d6a8, .95)); beach.rotation.z = .12; add(beach, WP.x + WP.w / 2 + 1, .2, WP.z);
  const waveH = (x, t) => { const env = Math.max(0, Math.sin(t * .5)) ** 2, k = .55; return Math.sin(k * (x + WP.w / 2) * 1.0 - t * 2.6) * .16 * env + Math.sin(x * .9 + t * 1.3) * .02; };

  // ---------- lazy river ----------
  mkSec('river', -53, 9, 90);
  const LR = {x: CX, z: 9, r0: 7.4, r1: 10.6};
  {
    const N = 64, pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) { const a = i / N * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); pos.push(c * LR.r0, 0, s * LR.r0, c * LR.r1, 0, s * LR.r1); uv.push(i / N * 10, 0, i / N * 10, 1); if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const lm = waterM.clone(); lm.map = waterM.map.clone(); lm.map.needsUpdate = true; lm.map.repeat.set(1, 1);
    const riv = new THREE.Mesh(g, lm); riv.userData.flow = true; add(riv, LR.x, .4, LR.z); G.userData.river = lm;
    const bed = new THREE.Mesh(new THREE.RingGeometry(LR.r0 - .4, LR.r1 + .4, 48), std(0xdfe8ee, .5)); bed.rotation.x = -Math.PI / 2; add(bed, LR.x, .07, LR.z);
    const isl = new THREE.Mesh(new THREE.CylinderGeometry(LR.r0 - .5, LR.r0 - .3, .45, 32), std(0x6fb05a, .9)); add(isl, LR.x, .22, LR.z);   // palm island
    for (let i = 0; i < 4; i++) {
      const a = i * 1.57 + .5, px = LR.x + Math.cos(a) * 3, pz = LR.z + Math.sin(a) * 3;
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(.12, .2, 3.4, 7), std(0x7a5a38, .9)); add(tr, px, 2, pz); tr.rotation.z = (i - 1.5) * .08;
      for (let k = 0; k < 6; k++) { const lf = new THREE.Mesh(new THREE.ConeGeometry(.22, 2, 4), std(0x2f9a4a, .8)); lf.position.set(px, 3.6, pz); lf.rotation.set(1.2, k * 1.05, 0); lf.translateY(.9); cur.add(lf); }
    }
  }
  // ---------- bathers: static merged people, waist-deep (the translucent water hides the legs) ----------
  const bathers = [], mkBather = (x, z, y, ry, scale) => { const p = People.crowdPerson(undefined, {swim: true}); p.position.set(x, y, z); p.rotation.y = ry; if (scale) p.scale.multiplyScalar(scale); sec.wave.g.add(p); bathers.push(p); return p; };
  const nWave = small ? 5 : 11, waveBathers = [];
  for (let i = 0; i < nWave; i++) { const b = mkBather(WP.x + rnd(-WP.w / 2 + 2, WP.w / 2 - 1), WP.z + rnd(-WP.d / 2 + 1, WP.d / 2 - 1), -.3, rnd(0, 6.28)); b.userData.base = -.3; waveBathers.push(b); }
  // lazy-river tubes with a rider each
  const tubes = [], nT = small ? 4 : 8, tubeG = new THREE.TorusGeometry(.5, .16, 8, 16);
  for (let i = 0; i < nT; i++) {
    const g = new THREE.Group(), tm = new THREE.Mesh(tubeG, std(pick([0xff5a7a, 0xffd23a, 0x3ad8ff, 0x6aff7a, 0xff9a3a]), .4)); tm.rotation.x = Math.PI / 2; tm.position.y = .5; g.add(tm);
    const p = People.crowdPerson(undefined, {swim: true}); p.position.y = -.12; p.scale.multiplyScalar(.82); g.add(p);
    sec.river.g.add(g); tubes.push({g, a: i / nT * Math.PI * 2, rr: rnd(LR.r0 + 1.1, LR.r1 - 1.1), sp: rnd(.07, .11)});
  }
  // ---------- bumper boats ----------
  mkSec('boats', -67, -9, 70);
  const BP = {x: -67, z: -9, r: 4.6}, boats = [];
  {
    const pond = new THREE.Mesh(new THREE.CircleGeometry(BP.r, 32), waterM); pond.rotation.x = -Math.PI / 2; add(pond, BP.x, .4, BP.z);
    const rimM = new THREE.Mesh(new THREE.RingGeometry(BP.r, BP.r + .5, 32), std(0xdfe8ee, .5)); rimM.rotation.x = -Math.PI / 2; add(rimM, BP.x, .1, BP.z);
    const hull = new THREE.CylinderGeometry(.7, .55, .4, 14, 1, true), bump = new THREE.TorusGeometry(.72, .16, 8, 18);
    const nB = small ? 2 : 4;
    for (let i = 0; i < nB; i++) {
      const c = pick([0xff5a3a, 0xffd23a, 0x3a8aff, 0x3aff8a]), g = new THREE.Group();
      const h = new THREE.Mesh(hull, std(c, .5, 0, {side: THREE.DoubleSide})); h.position.y = .5; const b = new THREE.Mesh(bump, std(c, .4)); b.rotation.x = Math.PI / 2; b.position.y = .66; g.add(h, b);
      const p = People.crowdPerson(undefined, {swim: true}); p.position.y = .08; p.scale.multiplyScalar(.7); g.add(p);
      cur.add(g); const a = rnd(0, 6.28); boats.push({g, x: BP.x + Math.cos(a) * 2, z: BP.z + Math.sin(a) * 2, h: rnd(0, 6.28), sp: rnd(1, 1.6)});
    }
  }
  // ---------- tube slides ----------
  mkSec('slides', -53, 0, 85);
  const slides = [];
  function slide(pts, color, tower) {
    const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, small ? 32 : 56, .55, 10, false), std(color, .3, 0, {transparent: true, opacity: .72, side: THREE.DoubleSide})); cur.add(tube);
    for (const t of [.12, .32, .52, .72]) { const p = curve.getPoint(t); const post = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, p.y, 6), std(0xdfe8ee, .5)); post.position.set(p.x, p.y / 2, p.z); cur.add(post); }
    const top = pts[0];   // tower: platform + posts + steps
    add(new THREE.Mesh(new THREE.BoxGeometry(2.2, .18, 2.2), std(0xdfe8ee, .5)), top[0], top[1] - .7, top[2]);
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(new THREE.Mesh(new THREE.CylinderGeometry(.1, .1, top[1] - .7, 6), std(0xdfe8ee, .5)), top[0] + dx, (top[1] - .7) / 2, top[2] + dz);
    const st = new THREE.Mesh(new THREE.BoxGeometry(1.2, .12, 5), std(0xc8d4dc, .6)); st.rotation.x = tower.tilt || .5; add(st, top[0] + tower.sx, (top[1] - .7) / 2, top[2] + tower.sz);
    const end = pts[pts.length - 1], catchP = new THREE.Mesh(new THREE.CircleGeometry(2.6, 20), waterM); catchP.rotation.x = -Math.PI / 2; add(catchP, end[0], .4, end[2] + .5);
    add(new THREE.Mesh(new THREE.RingGeometry(2.6, 3.1, 20), std(0xdfe8ee, .5)), end[0], .1, end[2] + .5).rotation.x = -Math.PI / 2;
    const riders = [];
    for (let i = 0; i < (small ? 2 : 3); i++) { const r = new THREE.Group(); const b = new THREE.Mesh(new THREE.CapsuleGeometry(.16, .5, 4, 8), std(pick([0xff5a7a, 0xffd23a, 0x3ad8ff]), .6)); b.rotation.x = Math.PI / 2; const h = new THREE.Mesh(new THREE.SphereGeometry(.14, 8, 6), std(pick([0xd9a978, 0xa8714a, 0x8a5a35]), .7)); h.position.set(0, .08, .5); r.add(b, h); cur.add(r); riders.push({r, t: i / 3}); }
    slides.push({curve, riders, end});
  }
  slide([[-69, 7.6, 17], [-70.6, 6.4, 14], [-68, 5.2, 11.5], [-70.2, 3.8, 9], [-67.4, 2.3, 7], [-66.2, 1, 5], [-66.2, .55, 3.6]], 0xffd23a, {sx: 1.2, sz: -3, tilt: .5});
  slide([[-38.5, 7.2, -25], [-40.5, 6, -22], [-37.8, 4.8, -19.5], [-40, 3.5, -17], [-37.6, 2.2, -15], [-38.4, 1, -13], [-38.4, .55, -11.6]], 0xff5a7a, {sx: -1.2, sz: 3, tilt: -.5});
  const rings = [];   // splash rings
  const ringG = new THREE.RingGeometry(.3, .45, 20);
  for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false})); m.rotation.x = -Math.PI / 2; m.visible = false; G.add(m); rings.push({m, life: 0}); }
  const splash = (x, z) => { const r = rings.find(q => q.life <= 0); if (r) { r.life = 1; r.m.position.set(x, .45, z); r.m.visible = true; } };

  // ---------- water cannons + a squirt fight (instanced droplets on ballistic arcs) ----------
  mkSec('guns', -53, 0, 70);
  const cannons = [[-45, -8, WP.x + 4, WP.z + 2], [-60, -8, WP.x - 4, WP.z + 3], [-44.5, 9.5, CX + 7, 9], [-61.5, 9.5, CX - 7, 9]], gun = [];
  for (const [x, z] of cannons) { add(new THREE.Mesh(new THREE.CylinderGeometry(.22, .3, .9, 8), std(0xffd23a, .4)), x, .45, z); const b = new THREE.Mesh(new THREE.CylinderGeometry(.09, .12, .9, 8), std(0x2f6f8f, .4, .4)); b.position.set(x, 1.05, z); b.rotation.z = Math.PI / 2.8; cur.add(b); }
  const ND = small ? 10 : 14, drops = new THREE.InstancedMesh(new THREE.SphereGeometry(.07, 5, 4), new THREE.MeshBasicMaterial({color: 0xcfefff}), cannons.length * ND + 16);
  drops.frustumCulled = false; cur.add(drops);
  const M4 = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), Sc = new THREE.Vector3(1, 1, 1);
  const g0 = 9.8, th = .96;   // launch angle (rad)
  const arcs = cannons.map(([x, z, tx, tz]) => { const dx = tx - x, dz = tz - z, R = Math.hypot(dx, dz), v = Math.sqrt(R * g0 / Math.sin(2 * th)), T = 2 * v * Math.sin(th) / g0; return {x, z, dx: dx / R, dz: dz / R, v, T}; });
  // squirt fight: two bathers in the wave pool soak each other
  const fighters = waveBathers.slice(0, 2);

  // ---------- interactive zones: entering one splashes + grants Rep (cooldown per zone) ----------
  const zones = [
    {name: 'wave pool', x: WP.x, z: WP.z, r: 8, last: 0},
    {name: 'lazy river', x: LR.x, z: LR.z, r: 9, last: 0},
    {name: 'bumper boats', x: BP.x, z: BP.z, r: 5, last: 0},
    {name: 'slide splash', x: -66, z: 3.6, r: 3.2, last: 0},
    {name: 'slide splash', x: -38, z: -11.6, r: 3.2, last: 0},
  ];
  for (const [cx, cz] of cannons) zones.push({name: 'water cannon', x: cx, z: cz, r: 3, last: 0});

  // ---------- loungers + umbrellas ----------
  mkSec('lounge', -53, 8, 75);
  {
    const spots = []; for (let i = 0; i < (small ? 5 : 10); i++) spots.push([rnd(-71, -37), rnd(-6, 20)]);
    const nearRiver = (x, z) => Math.hypot(x - LR.x, z - LR.z) < LR.r1 + 1.5 || Math.hypot(x - BP.x, z - BP.z) < BP.r + 1;
    const ok = spots.filter(([x, z]) => !nearRiver(x, z) && z > -8);
    const lg = new THREE.InstancedMesh(new THREE.BoxGeometry(.8, .18, 1.9), std(0xffffff, .7), ok.length), um = new THREE.InstancedMesh(new THREE.ConeGeometry(1.5, .55, 10), new THREE.MeshStandardMaterial({color: 0xffffff, roughness: .6, side: THREE.DoubleSide}), ok.length), up = new THREE.InstancedMesh(new THREE.CylinderGeometry(.04, .04, 2.4, 6), std(0xdfe8ee, .5), ok.length);
    const C = new THREE.Color(), cols = [0xff5a7a, 0xffd23a, 0x3ad8ff, 0x6aff7a, 0xff9a3a];
    ok.forEach(([x, z], i) => { lg.setMatrixAt(i, M4.compose(P.set(x, .3, z), Q.identity(), Sc)); lg.setColorAt(i, C.setHex(pick(cols))); um.setMatrixAt(i, M4.compose(P.set(x + 1.1, 2.5, z), Q.identity(), Sc)); um.setColorAt(i, C.setHex(pick(cols))); up.setMatrixAt(i, M4.compose(P.set(x + 1.1, 1.2, z), Q.identity(), Sc)); });
    lg.castShadow = um.castShadow = true; cur.add(lg, um, up);
  }
  // lifeguard stands (staff actors are added by the scene next to them)
  const guards = [[-45, -7], [-48, 1.5], [-66, 12]];
  for (const [x, z] of guards) { add(new THREE.Mesh(new THREE.BoxGeometry(1.1, .12, 1.1), std(0xe83a3a, .5)), x, 1.9, z); for (const [dx, dz] of [[-.5, -.5], [.5, -.5], [-.5, .5], [.5, .5]]) add(new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, 1.9, 6), std(0xf4efe2, .5)), x + dx, .95, z + dz); add(new THREE.Mesh(new THREE.ConeGeometry(.9, .5, 4), std(0xf4efe2, .6)), x, 3.2, z).rotation.y = Math.PI / 4; }

  G.visible = false;
  const cx = new THREE.Vector3(); let acc = 0;
  function tick(t, dt) {
    cam.getWorldPosition(cx);
    acc += dt; if (acc > .2 || !sec.deck.on) {   // visibility is re-evaluated 5x a second (hysteresis keeps it from flickering)
      acc = 0; let any = false;
      for (const k in sec) { const s = sec[k], d = Math.hypot(cx.x - s.x, cx.z - s.z); s.on = d < (s.on ? s.r + 6 : s.r); s.g.visible = s.on; s.d = d; any = any || s.on; }
      G.visible = any;
    }
    if (!G.visible) return;
    // interactive: stepping into an attraction splashes + grants Rep (per-zone cooldown)
    if (player) { const pp = (typeof player === 'function' ? player() : player); if (pp) for (const z of zones) { if (Math.hypot(pp.x - z.x, pp.z - z.z) < z.r && (t - z.last) > 22) { z.last = t; splash(pp.x, pp.z); if (onUse) onUse(z.name); } } }
    if (sec.wave.on && sec.wave.d < (small ? 40 : 75)) {   // wave pool vertices + bobbing bathers
      const a = wpos.array;
      for (let i = 0; i < wpos.count; i++) a[i * 3 + 1] = wbase[i * 3 + 1] + waveH(wbase[i * 3], t);
      wpos.needsUpdate = true; wg.computeVertexNormals();
      for (const b of waveBathers) b.position.y = b.userData.base + waveH(b.position.x - WP.x, t) * 1.4;
    }
    if (sec.river.on) {
      G.userData.river.map.offset.x -= dt * .12;
      for (const tb of tubes) { tb.a += tb.sp * dt; tb.g.position.set(LR.x + Math.cos(tb.a) * tb.rr, .4 + Math.sin(t * 1.4 + tb.a * 3) * .03, LR.z + Math.sin(tb.a) * tb.rr); tb.g.rotation.y = -tb.a + Math.sin(t * .4 + tb.a) * .5; }
    }
    if (sec.boats.on) for (const b of boats) {   // wander, bounce off the rim and each other
      b.h += Math.sin(t * .7 + b.sp * 5) * dt * .6; b.x += Math.sin(b.h) * b.sp * dt; b.z += Math.cos(b.h) * b.sp * dt;
      const dx = b.x - BP.x, dz = b.z - BP.z, dd = Math.hypot(dx, dz); if (dd > BP.r - 1) { b.h = Math.atan2(-dx, -dz) + rnd(-.5, .5); b.x = BP.x + dx / dd * (BP.r - 1); b.z = BP.z + dz / dd * (BP.r - 1); }
      for (const o2 of boats) if (o2 !== b && Math.hypot(o2.x - b.x, o2.z - b.z) < 1.5) { b.h += 2.4; splash(b.x, b.z); }
      b.g.position.set(b.x, .4 + Math.sin(t * 2 + b.h) * .02, b.z); b.g.rotation.y = b.h; b.g.rotation.z = Math.sin(t * 1.8 + b.sp) * .05;
    }
    if (sec.slides.on) for (const sl of slides) for (const rd of sl.riders) {
      rd.t += dt * .13; if (rd.t >= 1) { rd.t = 0; splash(sl.end[0], sl.end[2] + .5); }
      sl.curve.getPoint(rd.t, P); rd.r.position.copy(P); rd.r.position.y += .25; sl.curve.getTangent(rd.t, cx); rd.r.lookAt(P.x + cx.x, P.y + .25 + cx.y, P.z + cx.z);
    }
    for (const r of rings) if (r.life > 0) { r.life -= dt * 1.2; r.m.scale.setScalar(1 + (1 - r.life) * 4); r.m.material.opacity = Math.max(0, r.life) * .8; if (r.life <= 0) r.m.visible = false; }
    if (sec.guns.on) {   // droplets
      let n = 0;
      for (let k = 0; k < arcs.length; k++) {
        const A = arcs[k];
        for (let i = 0; i < ND; i++) { const tt = ((t + i * A.T / ND) % A.T), h = A.v * Math.cos(th) * tt; drops.setMatrixAt(n++, M4.compose(P.set(A.x + A.dx * h, 1.4 + A.v * Math.sin(th) * tt - .5 * g0 * tt * tt, A.z + A.dz * h), Q.identity(), Sc)); }
      }
      if (fighters.length === 2 && sec.wave.on) for (let f = 0; f < 2; f++) {   // each soaks the other: short arcs between them
        const s0 = fighters[f].position, s1 = fighters[1 - f].position;
        for (let i = 0; i < 8; i++) { const u = ((t * .9 + i / 8) % 1); drops.setMatrixAt(n++, M4.compose(P.set(s0.x + (s1.x - s0.x) * u, s0.y + 1.2 + Math.sin(u * Math.PI) * .6 + (s1.y - s0.y) * u * .5, s0.z + (s1.z - s0.z) * u), Q.identity(), Sc)); }
      }
      drops.count = n; drops.instanceMatrix.needsUpdate = true;
    }
  }
  return {tick, group: G, guards, towers: guards.map(([x, z]) => ({x, z})), poi: {gate: {x: PARK.x1 - 2, z: PARK.gate.z}, wave: {x: WP.x + WP.w / 2 + 2, z: WP.z}, river: {x: LR.x + LR.r1 + 1.2, z: LR.z}, slideA: {x: -66, z: 2}, slideB: {x: -38, z: -10}, boats: {x: BP.x + BP.r + 1.5, z: BP.z}}, bounds: PARK, zones, splash};
}
