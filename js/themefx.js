// themefx.js — applies a theme from themes.js to the lot: every material except the truck's (and the people,
// ground and sky) is remapped to the theme palette, then a few cheap instanced extras are added — gas lamps
// everywhere, plus either turning gears + airships (steampunk) or string lights, bunting, falling
// confetti/leaves/snow and floating lanterns/balloons (holidays). No textures, no lights, ~10 draw calls.
// Truck exclusion: scene.js hands in every object that existed when the truck finished building (`skip`);
// those objects - and any material they use - are never touched.
import * as THREE from 'three';

const hsl = {h: 0, s: 0, l: 0};
const DONE = new WeakSet(), PROTECT = new WeakSet();
const PEWTER = [0x8a847a, .45, .6], GUN = [0x4a4642, .5, .7];
let PAL = null;
const bucket = (h) => (h < .04 || h >= .93) ? 0 : h < .19 ? 1 : h < .45 ? 2 : h < .72 ? 3 : 4;

function classify(m) {
  m.color.getHSL(hsl, THREE.SRGBColorSpace);
  const {h, s, l} = hsl;
  if (m.metalness > .35) return l < .3 ? PAL.dark : (l > .55 && s < .2) ? PAL.m1 : PAL.m2;
  if (l < .2) return PAL.dark;
  if (s < .14) return l > .8 ? PAL.light : l > .5 ? PEWTER : GUN;
  if (h >= .04 && h <= .13 && s < .65 && l < .55) return PAL.wood;
  if (l > .72) return PAL.light;
  const k = bucket(h);
  return [PAL.fab[k], k === 1 ? PAL.m1[1] : .75, k === 1 ? PAL.m1[2] * .7 : .05];
}
function restyle(m) {
  if (!m || DONE.has(m) || PROTECT.has(m)) return;
  DONE.add(m);
  if (!(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) || m.map || m.emissiveMap || m.alphaMap || m.vertexColors) return;
  if (m.emissive && m.emissive.getHex() !== 0 && m.emissiveIntensity > 0) return;   // lit bulbs / screens stay lit
  if (m.transparent && m.opacity < .9) return;
  const [hex, rough, metal] = classify(m);
  m.color.setHex(hex).multiplyScalar(.88 + hsl.l * .32);   // keep some of the original light/dark variation
  m.roughness = rough; m.metalness = metal;
  if (metal > .4) m.envMapIntensity = 1.15;
}
export function restyleScene(root, skip) {
  const walk = o => {
    if (skip.has(o) || (o.userData && o.userData.steamSkip)) return;
    if ((o.isMesh || o.isInstancedMesh) && !(o.isInstancedMesh && o.instanceColor)) {
      if (Array.isArray(o.material)) o.material.forEach(restyle); else restyle(o.material);
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
}

// ---------- gears ----------
function gearGeo(teeth, depth) {
  const sh = new THREE.Shape(), n = teeth * 4;
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, r = (i % 4 === 1 || i % 4 === 2) ? 1 : .84;
    i ? sh.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sh.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  sh.closePath();
  const hole = new THREE.Path(); hole.absarc(0, 0, .16, 0, Math.PI * 2, true); sh.holes.push(hole);
  for (let k = 0; k < 5; k++) {   // spoke windows
    const a = k / 5 * Math.PI * 2 + .3, w = new THREE.Path(); w.absarc(Math.cos(a) * .5, Math.sin(a) * .5, .17, 0, Math.PI * 2, true); sh.holes.push(w);
  }
  const g = new THREE.ExtrudeGeometry(sh, {depth, bevelEnabled: false, curveSegments: 8});
  g.translate(0, 0, -depth / 2);
  return g;
}
function airship(env, brass, wood, copper) {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), env); hull.scale.set(7, 2.4, 2.4); g.add(hull);
  for (const x of [-3.6, 0, 3.6]) {
    const r = 2.4 * Math.sqrt(1 - (x / 7) ** 2) + .04, ring = new THREE.Mesh(new THREE.TorusGeometry(r, .09, 6, 20), brass);
    ring.rotation.y = Math.PI / 2; ring.position.x = x; g.add(ring);
  }
  const gon = new THREE.Mesh(new THREE.BoxGeometry(3, .8, 1.1), wood); gon.position.y = -3.1; g.add(gon);
  for (const x of [-1, 1]) { const rod = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, 1, 5), brass); rod.position.set(x, -2.35, 0); g.add(rod); }
  for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.5, .08), copper); fin.position.set(-6, Math.sin(a) * 1.3, Math.cos(a) * 1.3); fin.rotation.x = a; g.add(fin);
  }
  const prop = new THREE.Mesh(new THREE.BoxGeometry(.1, 1.6, .16), brass); prop.position.set(-7, 0, 0); g.add(prop);
  g.userData.prop = prop;
  return g;
}
function softDot() {   // round soft sprite for falling particles
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d'), r = g.createRadialGradient(16, 16, 1, 16, 16, 15); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.6, 'rgba(255,255,255,.85)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function init(S, o) {
  const {skip, lite, theme: T} = o;
  const FM = Math.max(0, Math.min(3, Number(o.fallMult) || 1)), FT = Math.max(0, Math.min(3, Number(o.floatMult) || 1));   // Admin → Environment multipliers
  PAL = T;
  skip.forEach(ob => { if (ob.isMesh) (Array.isArray(ob.material) ? ob.material : [ob.material]).forEach(m => m && PROTECT.add(m)); });
  const run = () => restyleScene(S, skip);
  run(); setTimeout(run, 1500); setTimeout(run, 6000);   // props mount over the first seconds (arcade, tables, cars)

  const own = m => (DONE.add(m), m);
  const m1M = own(new THREE.MeshStandardMaterial({color: T.m1[0], roughness: T.m1[1], metalness: T.m1[2]})),
    m2M = own(new THREE.MeshStandardMaterial({color: T.m2[0], roughness: T.m2[1], metalness: T.m2[2]})),
    darkM = own(new THREE.MeshStandardMaterial({color: T.dark[0], roughness: T.dark[1], metalness: T.dark[2]})),
    woodM = own(new THREE.MeshStandardMaterial({color: T.wood[0], roughness: T.wood[1], metalness: T.wood[2]})),
    bulbM = own(new THREE.MeshStandardMaterial({color: 0x2a1a08, emissive: T.lamp, emissiveIntensity: 1.4, roughness: .3})),
    envM = own(new THREE.MeshStandardMaterial({color: 0xd8c8a0, roughness: .8}));
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), Sc = new THREE.Vector3(), E = new THREE.Euler(), C = new THREE.Color();
  const ticks = [];

  // gas lamps (iron post + hood + glowing bulb) - emissive only, no light cost
  const lampSpots = [[-14, 10], [-7, 10], [0, 10], [7, 10], [14, 10], [-24, 4], [26, 4], [-16, -62], [32, -62]];
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(.045, .07, 3.2, 8), darkM, lampSpots.length),
    hoods = new THREE.InstancedMesh(new THREE.ConeGeometry(.3, .26, 8), m1M, lampSpots.length),
    bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(.17, 8, 6), bulbM, lampSpots.length);
  lampSpots.forEach((p, i) => {
    posts.setMatrixAt(i, M4.compose(P.set(p[0], 1.6, p[1]), Q.identity(), Sc.set(1, 1, 1)));
    hoods.setMatrixAt(i, M4.compose(P.set(p[0], 3.5, p[1]), Q.identity(), Sc.set(1, 1, 1)));
    bulbs.setMatrixAt(i, M4.compose(P.set(p[0], 3.25, p[1]), Q.identity(), Sc.set(1, 1, 1)));
  });
  posts.castShadow = true; S.add(posts, hoods, bulbs);

  if (T.decor === 'steam') {
    // gears: big pair framing the stage + small meshing pairs on totems; neighbours spin opposite ways. Airships drift in the haze.
    const gears = [], geo = gearGeo(14, .22);
    const defs = [[-10.5, 3.2, -63.2, 2.6, 1], [-6.2, 1.6, -63.2, 1.4, -1], [26.5, 3.2, -63.2, 2.6, -1], [22.2, 1.6, -63.2, 1.4, 1],
      [-13, 2.3, -57, 1.1, 1], [-11.1, 1.4, -57, .7, -1], [29, 2.3, -57, 1.1, -1], [27.1, 1.4, -57, .7, 1]];
    const gm = new THREE.InstancedMesh(geo, m1M, defs.length); gm.castShadow = true; S.add(gm);
    const setGear = (i, d, a) => gm.setMatrixAt(i, M4.compose(P.set(d[0], d[1], d[2]), Q.setFromEuler(E.set(0, 0, a)), Sc.set(d[3], d[3], 1)));
    defs.forEach((d, i) => { setGear(i, d, i * .4); gears.push(d); });
    gm.instanceMatrix.needsUpdate = true;
    const shaft = new THREE.InstancedMesh(new THREE.CylinderGeometry(.06, .06, 1, 6), darkM, 4);
    [[-8.4, 2.4], [24.4, 2.4], [-12, 1.8], [28, 1.8]].forEach((p, i) => shaft.setMatrixAt(i, M4.compose(P.set(p[0], p[1] / 2, -63), Q.identity(), Sc.set(1, p[1], 1))));
    S.add(shaft);
    const ships = [], mk = (x, y, z, sp, dir, sc) => { const s = airship(envM, m1M, woodM, m2M); s.scale.setScalar(sc); s.position.set(x, y, z); s.rotation.y = dir > 0 ? Math.PI : 0; S.add(s); ships.push({s, x0: x, sp, dir, y}); };
    mk(-90, 46, -130, 1.4, 1, 1.2); mk(70, 62, -150, 1.0, -1, 1.6);
    ticks.push((t) => {
      for (const sh of ships) {
        sh.s.position.x = ((sh.x0 + sh.dir * sh.sp * t + 160) % 320 + 320) % 320 - 160;
        sh.s.position.y = sh.y + Math.sin(t * .3 + sh.x0) * 1.2;
        sh.s.userData.prop.rotation.x = t * 14;
      }
      if (!lite) { for (let i = 0; i < gears.length; i++) setGear(i, gears[i], t * .35 * gears[i][4] / Math.max(.5, gears[i][3]) + i * .4); gm.instanceMatrix.needsUpdate = true; }
    });
  } else {
    // string lights + bunting sagging between the lamp row at z=10, flags + bulbs in the theme colours
    const cols = T.string, bl = [], fl = [], row = lampSpots.slice(0, 5);
    for (let s = 0; s < row.length - 1; s++) {
      const [x0, z0] = row[s], [x1, z1] = row[s + 1];
      for (let k = 1; k < 12; k++) { const u = k / 12, y = 3.1 - Math.sin(u * Math.PI) * .55; bl.push([x0 + (x1 - x0) * u, y, z0 + (z1 - z0) * u]); }
      for (let k = 0; k < 6; k++) { const u = (k + .5) / 6, y = 3.0 - Math.sin(u * Math.PI) * .55; fl.push([x0 + (x1 - x0) * u, y - .22, z0 + (z1 - z0) * u + .05]); }
    }
    const sb = new THREE.InstancedMesh(new THREE.SphereGeometry(.07, 6, 4), new THREE.MeshBasicMaterial(), bl.length);
    bl.forEach((p, i) => { sb.setMatrixAt(i, M4.compose(P.set(...p), Q.identity(), Sc.set(1, 1, 1))); sb.setColorAt(i, C.setHex(cols[i % cols.length])); });
    const fg = new THREE.InstancedMesh(new THREE.ConeGeometry(.2, .42, 3), new THREE.MeshBasicMaterial({side: THREE.DoubleSide}), fl.length);
    fl.forEach((p, i) => { fg.setMatrixAt(i, M4.compose(P.set(...p), Q.setFromEuler(E.set(Math.PI, 0, 0)), Sc.set(1, 1, .25))); fg.setColorAt(i, C.setHex(cols[(i + 1) % cols.length])); });
    S.add(sb, fg);

    // falling confetti / leaves / snow / petals
    const F = T.fall, N = FM > 0 ? Math.round((lite ? 130 : 280) * FM) : 0, pts = N ? new Float32Array(N * 3) : null, col = N ? new Float32Array(N * 3) : null, ph = new Float32Array(N), sp = new Float32Array(N);
    let fall = null;
    if (N) for (let i = 0; i < N; i++) {
      pts.set([-40 + Math.random() * 90, Math.random() * 16, -75 + Math.random() * 105], i * 3);
      C.setHex(F.colors[i % F.colors.length]); col.set([C.r, C.g, C.b], i * 3);
      ph[i] = Math.random() * 6.28; sp[i] = .6 + Math.random() * .8;
    }
    if (N) {
      const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pts, 3)); pg.setAttribute('color', new THREE.BufferAttribute(col, 3));
      fall = new THREE.Points(pg, new THREE.PointsMaterial({size: F.size * 2.2, map: softDot(), vertexColors: true, transparent: true, depthWrite: false, opacity: .92}));
      fall.frustumCulled = false; S.add(fall);
    }
    // floating lanterns / balloons
    const FL = T.floats, NF = FT > 0 ? Math.round((lite ? 8 : 16) * FT) : 0, fm = new THREE.InstancedMesh(new THREE.SphereGeometry(FL.shape === 'lantern' ? .32 : .4, 10, 8), new THREE.MeshBasicMaterial(), Math.max(1, NF)), fs = [];
    for (let i = 0; i < NF; i++) { fs.push({x: -30 + Math.random() * 70, z: -70 + Math.random() * 90, y: 4 + Math.random() * 18, s: .4 + Math.random() * .5, p: Math.random() * 6}); fm.setColorAt(i, C.setHex(FL.colors[i % FL.colors.length])); }
    if (NF) { fm.frustumCulled = false; S.add(fm); }
    ticks.push((t, dt) => {
      if (fall) {
        const a = pg.attributes.position.array;
        for (let i = 0; i < N; i++) {
          a[i * 3 + 1] -= F.speed * sp[i] * dt; a[i * 3] += Math.sin(t * .9 + ph[i]) * F.sway * dt * .5;
          if (a[i * 3 + 1] < 0) { a[i * 3 + 1] = 14 + Math.random() * 3; a[i * 3] = -40 + Math.random() * 90; a[i * 3 + 2] = -75 + Math.random() * 105; }
        }
        pg.attributes.position.needsUpdate = true;
      }
      if (NF) for (let i = 0; i < NF; i++) {
        const f = fs[i]; f.y += f.s * dt * .6; if (f.y > 30) f.y = 3;
        fm.setMatrixAt(i, M4.compose(P.set(f.x + Math.sin(t * .4 + f.p) * 1.2, f.y, f.z), Q.identity(), Sc.set(1, FL.shape === 'lantern' ? 1.25 : 1.1, 1)));
      }
      if (NF) fm.instanceMatrix.needsUpdate = true;
    });
  }
  return {tick(t, dt) { for (const f of ticks) f(t, dt); }};
}
