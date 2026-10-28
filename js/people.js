// people.js — realistic humans on a phone budget. Pure three.js geometry + canvas-painted faces, no assets.
// One shared set of unit geometries (lathe torso/limbs, ellipsoid head) is posed into "parts"; then
//  - crowdPerson(): every part merged into ONE vertex-coloured body mesh + ONE face-textured head mesh
//    (2 draw calls, ~1.4k tris, frozen matrices) — the old crowd body was 31 meshes / 9.5k tris;
//  - buildAvatar(): the same parts grouped into ~15 meshes on shoulder/hip pivots so arms and legs swing.
// Body origin is at the FEET (y=0), +z is forward, height ≈ 1.72 m × look.scale.
import * as THREE from 'three';
let _rng = Math.random;
export function setSeed(seed) { let a = (seed || 1) >>> 0; _rng = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const V2 = (a, b) => new THREE.Vector2(a, b);
const lathe = (pts, seg) => new THREE.LatheGeometry(pts.map(p => V2(p[0], p[1])), seg);
// profiles run bottom → top (increasing y) so the faces point outward
const limb = (r0, r1, len, seg = 8) => lathe([[0, -len * 1.02], [r1 * .8, -len * 1.0], [r1, -len * .93], [(r0 + r1) / 2, -len * .5], [r0, -len * .07], [r0 * .9, -len * .012], [0, .008 * len]], seg);

let G = null;
function geo() {
  if (G) return G;
  G = {
    sphere: new THREE.SphereGeometry(1, 14, 10),
    sphereLo: new THREE.SphereGeometry(1, 8, 6),
    hairCap: new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI * .5),
    beard: new THREE.SphereGeometry(1, 10, 5, 0, Math.PI, Math.PI * .55, Math.PI * .45),
    torso: lathe([[0, .9], [.15, .9], [.17, .95], [.155, 1.02], [.16, 1.12], [.18, 1.24], [.2, 1.33], [.19, 1.4], [.11, 1.45], [.058, 1.47], [0, 1.47]], 12),
    vest: lathe([[.162, 1.0], [.162, 1.02], [.172, 1.12], [.19, 1.24], [.21, 1.33], [.2, 1.39]], 12),
    skirt: lathe([[.255, .42], [.22, .6], [.17, .8], [.14, .96]], 12),
    neck: new THREE.CylinderGeometry(.052, .058, .1, 8),
    belt: new THREE.CylinderGeometry(.168, .168, .035, 12),
    upper: limb(.056, .045, .29), fore: limb(.044, .033, .26), thigh: limb(.09, .063, .43), shin: limb(.062, .042, .41),
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
    cylOpen: new THREE.CylinderGeometry(1, 1, 1, 16, 1, true),
    torus: new THREE.TorusGeometry(1, .28, 5, 10),
    cone: new THREE.ConeGeometry(1, 1, 6),
  };
  return G;
}

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const M = (px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(_v.set(px, py, pz), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));

// ---------- merge parts [{g, m, col, uv}] into one BufferGeometry (position, normal, color | uv) ----------
const _nm = new THREE.Matrix3(), _p = new THREE.Vector3(), _c = new THREE.Color();
export function mergeParts(parts, mode) {   // mode: 'color' | 'uv'
  let nv = 0, ni = 0;
  for (const p of parts) { nv += p.g.attributes.position.count; ni += p.g.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), aux = new Float32Array(nv * (mode === 'uv' ? 2 : 3)), idx = new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const p of parts) {
    const gp = p.g.attributes.position, gn = p.g.attributes.normal, gu = p.g.attributes.uv, m = p.m;
    _nm.getNormalMatrix(m);
    _c.setHex(p.col || 0xffffff);
    for (let i = 0; i < gp.count; i++) {
      _p.fromBufferAttribute(gp, i).applyMatrix4(m); pos.set([_p.x, _p.y, _p.z], (vo + i) * 3);
      _p.fromBufferAttribute(gn, i).applyMatrix3(_nm).normalize(); nor.set([_p.x, _p.y, _p.z], (vo + i) * 3);
      if (mode === 'uv') { if (p.uv) aux.set(p.uv, (vo + i) * 2); else aux.set([gu.getX(i), gu.getY(i)], (vo + i) * 2); }
      else aux.set([_c.r, _c.g, _c.b], (vo + i) * 3);
    }
    for (let i = 0; i < p.g.index.count; i++) idx[io + i] = p.g.index.getX(i) + vo;
    vo += gp.count; io += p.g.index.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute(mode === 'uv' ? 'uv' : 'color', new THREE.BufferAttribute(aux, mode === 'uv' ? 2 : 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

// Collapse a static prop into one mesh per material. Every plain mesh under `group` (not instanced, not a
// sprite, not multi-material, not one `skip(o)` keeps) has its transform baked relative to the group and is
// appended to the bucket for its material; plain untagged materials that are visually identical share a
// bucket. Materials are reused as they are, so gfx.js tags, gfxSign repaints and themefx recolours all still
// apply - only the draw-call count changes. Measured: a picnic table went 22 meshes -> 7, the lowrider
// shell 120 -> ~20. Only call it on things that never animate a sub-part (pass those parts to `skip`).
export function mergeStatic(group, skip) {
  group.updateMatrixWorld(true);
  const inv=new THREE.Matrix4().copy(group.matrixWorld).invert(),buckets=new Map(),_n=new THREE.Matrix3(),_v=new THREE.Vector3();
  const keyOf=m=>{const u=m.userData||{};if(u.gfx||m.map||m.emissiveMap||m.normalMap||m.alphaMap||m.vertexColors)return m;   // textured / tagged: identity
    return [m.type,m.color?m.color.getHex():0,m.roughness,m.metalness,m.side,m.transparent?m.opacity:1,m.emissive?m.emissive.getHex():0,m.emissiveIntensity||0].join('|');};
  group.traverse(o=>{if(!o.isMesh||o.isInstancedMesh||o.isSprite||Array.isArray(o.material)||(skip&&skip(o)))return;
    const g=o.geometry;if(!g.attributes.position||!g.attributes.normal||!g.attributes.uv)return;
    const k=keyOf(o.material);(buckets.get(k)||buckets.set(k,{mat:o.material,list:[]}).get(k)).list.push({o,m:new THREE.Matrix4().multiplyMatrices(inv,o.matrixWorld)});});
  for(const {mat,list} of buckets.values()){
    if(list.length<2)continue;
    let nv=0,ni=0;for(const {o} of list){const g=o.geometry;nv+=g.attributes.position.count;ni+=g.index?g.index.count:g.attributes.position.count;}
    const pos=new Float32Array(nv*3),nor=new Float32Array(nv*3),uv=new Float32Array(nv*2),idx=nv>65535?new Uint32Array(ni):new Uint16Array(ni);
    let vo=0,io=0,cast=false,recv=false;
    for(const {o,m} of list){const g=o.geometry,gp=g.attributes.position,gn=g.attributes.normal,gu=g.attributes.uv;_n.getNormalMatrix(m);
      for(let i=0;i<gp.count;i++){_v.fromBufferAttribute(gp,i).applyMatrix4(m);pos[(vo+i)*3]=_v.x;pos[(vo+i)*3+1]=_v.y;pos[(vo+i)*3+2]=_v.z;
        _v.fromBufferAttribute(gn,i).applyMatrix3(_n).normalize();nor[(vo+i)*3]=_v.x;nor[(vo+i)*3+1]=_v.y;nor[(vo+i)*3+2]=_v.z;
        uv[(vo+i)*2]=gu.getX(i);uv[(vo+i)*2+1]=gu.getY(i);}
      if(g.index)for(let i=0;i<g.index.count;i++)idx[io+i]=g.index.getX(i)+vo;else for(let i=0;i<gp.count;i++)idx[io+i]=i+vo;
      vo+=gp.count;io+=g.index?g.index.count:gp.count;cast=cast||o.castShadow;recv=recv||o.receiveShadow;o.parent.remove(o);}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('normal',new THREE.BufferAttribute(nor,3));
    geo.setAttribute('uv',new THREE.BufferAttribute(uv,2));geo.setIndex(new THREE.BufferAttribute(idx,1));geo.computeBoundingSphere();
    const mesh=new THREE.Mesh(geo,mat);mesh.castShadow=cast;mesh.receiveShadow=recv;mesh.userData.merged=list.length;
    const tags=new Set(list.map(x=>x.o.userData.custom));if(tags.size===1&&list[0].o.userData.custom)mesh.userData.custom=list[0].o.userData.custom;   // avatars.js recolours 'cap' meshes by this tag
    group.add(mesh);
  }
  return group;
}

// ---------- materials ----------
const MC = new Map();
export function mat(col, rough = .8, metal = 0) {
  const k = col + '|' + rough + '|' + metal;
  let m = MC.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({color: col, roughness: rough, metalness: metal}); m.userData.steamSkip = true; MC.set(k, m); }
  return m;
}
const VCOL = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .78, metalness: .04});
VCOL.userData.steamSkip = true;

// ---------- painted faces (256×128, front of the head sits at u = .25) ----------
const FACE = new Map();
const EYES = [0x3a2a1a, 0x2b4a6a, 0x4a5a2a, 0x1a1410];
export const EXPRS = ['', 'smile', 'grumpy', 'surprised', 'wink'];
function paintFace(skin, expr, eyeHex) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d'), sk = new THREE.Color(skin), css = (k, a = 1) => `rgba(${(sk.r ** .4545 * 255 * k) | 0},${(sk.g ** .4545 * 255 * k) | 0},${(sk.b ** .4545 * 255 * k) | 0},${a})`;
  g.fillStyle = css(1); g.fillRect(0, 0, 256, 128);
  let gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, css(1.06)); gr.addColorStop(.55, css(1)); gr.addColorStop(1, css(.9));
  g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
  const X = 64;
  for (const sx of [-1, 1]) {   // cheek warmth + eye sockets
    let r = g.createRadialGradient(X + sx * 24, 78, 1, X + sx * 24, 78, 15); r.addColorStop(0, 'rgba(205,95,85,.22)'); r.addColorStop(1, 'rgba(205,95,85,0)');
    g.fillStyle = r; g.fillRect(X + sx * 24 - 16, 62, 32, 32);
    r = g.createRadialGradient(X + sx * 13, 62, 1, X + sx * 13, 62, 12); r.addColorStop(0, css(.78, .35)); r.addColorStop(1, css(.78, 0));
    g.fillStyle = r; g.fillRect(X + sx * 13 - 13, 50, 26, 26);
  }
  const eye = new THREE.Color(eyeHex).getStyle(), dark = 'rgba(30,20,14,.9)';
  for (const sx of [-1, 1]) {
    const cx = X + sx * 13, cy = 61, closed = expr === 'wink' && sx > 0, big = expr === 'surprised' ? 1.25 : 1;
    if (closed) { g.strokeStyle = dark; g.lineWidth = 1.6; g.beginPath(); g.arc(cx, cy - 1, 6, .15 * Math.PI, .85 * Math.PI); g.stroke(); }
    else {
      g.fillStyle = '#f1ede6'; g.beginPath(); g.ellipse(cx, cy, 6.4, 3.7 * big, 0, 0, 7); g.fill();
      g.fillStyle = eye; g.beginPath(); g.arc(cx, cy, 2.9 * big, 0, 7); g.fill();
      g.fillStyle = '#0c0a08'; g.beginPath(); g.arc(cx, cy, 1.4, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(cx - 2, cy - 2, 1.4, 1.4);
      g.strokeStyle = dark; g.lineWidth = 1.2; g.beginPath(); g.ellipse(cx, cy, 6.6, 3.9 * big, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
    }
    g.strokeStyle = 'rgba(40,28,18,.85)'; g.lineWidth = 2; g.beginPath();   // brow: angled by mood
    const tilt = expr === 'grumpy' ? 3 : expr === 'surprised' ? -3 : 0, by = expr === 'surprised' ? 46 : 51;
    g.moveTo(cx - 7 * sx, by + tilt * -1 * (sx ? 1 : 0) + (expr === 'grumpy' ? 0 : 1.5)); g.lineTo(cx + 7 * sx, by - (expr === 'grumpy' ? 0 : 1.5) + tilt); g.stroke();
  }
  g.fillStyle = css(.7, .5); g.beginPath(); g.ellipse(X, 74, 4.2, 2.6, 0, 0, 7); g.fill();   // nose underside shadow
  g.fillStyle = css(.7, .4); g.fillRect(X - 1.2, 56, 2.4, 17);
  g.strokeStyle = 'rgba(30,18,12,.5)'; g.lineWidth = 1; g.beginPath(); g.arc(X - 3, 75, 1.2, 0, 7); g.arc(X + 3, 75, 1.2, 0, 7); g.stroke();
  const lip = css(.62, .95);   // mouth
  g.lineCap = 'round';
  if (expr === 'surprised') { g.fillStyle = 'rgba(70,20,20,.95)'; g.beginPath(); g.ellipse(X, 89, 4.2, 5.2, 0, 0, 7); g.fill(); g.strokeStyle = lip; g.lineWidth = 2; g.stroke(); }
  else if (expr === 'smile' || expr === 'wink') {
    g.fillStyle = '#f4efe6'; g.beginPath(); g.moveTo(X - 11, 85); g.quadraticCurveTo(X, 98, X + 11, 85); g.quadraticCurveTo(X, 89, X - 11, 85); g.fill();
    g.strokeStyle = lip; g.lineWidth = 2; g.beginPath(); g.moveTo(X - 12, 84); g.quadraticCurveTo(X, 97, X + 12, 84); g.stroke();
  } else if (expr === 'grumpy') { g.strokeStyle = lip; g.lineWidth = 2.2; g.beginPath(); g.moveTo(X - 9, 91); g.quadraticCurveTo(X, 84, X + 9, 91); g.stroke(); }
  else { g.strokeStyle = lip; g.lineWidth = 2.4; g.beginPath(); g.moveTo(X - 8, 88); g.lineTo(X + 8, 88); g.stroke(); g.fillStyle = css(.82, .8); g.beginPath(); g.ellipse(X, 91, 6.5, 2.1, 0, 0, Math.PI); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2;
  return t;
}
export function faceMat(skin, expr = '', eyeIdx = 0) {
  const k = skin + '|' + expr + '|' + eyeIdx;
  let m = FACE.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({map: paintFace(skin, expr, EYES[eyeIdx % EYES.length]), roughness: .6, metalness: 0}); m.userData.steamSkip = true; FACE.set(k, m); }
  return m;
}

// ---------- looks ----------
export const SKINS = [0xd9a978, 0xc78f5e, 0xc78f5e, 0xb07a4e, 0xb07a4e, 0xa8714a, 0x8a5a35, 0x8a5a35, 0x7a4a2a, 0x6b4626];
const HAIRC = [0x1a1208, 0x2b1b10, 0x4a2c16, 0x7a5028, 0xb08a4a, 0x8a8a86, 0x6a2a1a];
const HAIRS = ['short', 'long', 'bun', 'afro', 'bald', 'short'];
const SHIRTS = [0xe3d5b5, 0xd6cdb8, 0x7a2e2e, 0x2f6f6a, 0xb8893a, 0x9a4a2a, 0x3a4a6a, 0x5a3550, 0xc9b894];
const PANTS = [0x2b2926, 0x4a3322, 0x4c4a2e, 0x232a3d, 0x6b5436, 0x3a2f28];
const LEATHER = [0x5a3a22, 0x3a2a1e, 0x6b2e2e, 0x4a3a1e];
const BRASS = 0xb8893a, DARK = 0x1c1816;
const pick = a => a[Math.floor(_rng() * a.length)];
// kids: ~.62-.74 of adult height, bigger head, no beard/vest/top hat, hair or goggles only
function kidify() { return {kid: true, scale: .62 + _rng() * .12, beard: false, vest: 0, dress: _rng() < .4, hat: null, hair: pick(['short', 'long', 'bun', 'short']), sleeve: 'short'}; }
export function randomLook(skin) {
  const L = {skin: skin ?? pick(SKINS), shirt: pick(SHIRTS), pants: pick(PANTS), shoe: pick([0x1c1816, 0x3a2418, 0x2a1d14]),
    hair: pick(HAIRS), hairC: pick(HAIRC), expr: _rng() < .5 ? '' : pick(EXPRS), eye: Math.floor(_rng() * 4),
    sleeve: _rng() < .55 ? 'short' : 'long', vest: _rng() < .4 ? pick(LEATHER) : 0, dress: _rng() < .22,
    hat: pick([null, null, null, 'top', 'bowler']), goggles: _rng() < .28, beard: _rng() < .14, scale: .94 + _rng() * .12};
  if (_rng() < .2) Object.assign(L, kidify());   // ~1 in 5 of the crowd are kids
  return L;
}

// ---------- the rig: parts grouped by pivot, rest pose, feet at y=0 ----------
function rig(L) {
  const g = geo(), hc = L.hairC, out = {torso: [], head: [], hair: [], hat: [], armL: [], armR: [], legL: [], legR: []};
  const sw = L.swim, sleeveTag = sw ? {col: L.skin} : {col: L.shirt, tag: 'shirt'}, skinTag = {col: L.skin, tag: 'skin'}, pantsTag = {col: (L.dress || sw) ? L.skin : L.pants};
  // torso (+ belt, vest, skirt, neck)
  out.torso.push({g: g.torso, m: M(0, 0, 0, 0, 0, 0, 1.1, 1, .78), ...sleeveTag});
  out.torso.push({g: g.belt, m: M(0, .985, 0, 0, 0, 0, 1.1, 1, .78), col: DARK});
  if (L.vest) {
    out.torso.push({g: g.vest, m: M(0, 0, 0, 0, 0, 0, 1.1, 1, .78), col: L.vest});
    out.torso.push({g: g.box, m: M(0, 1.2, .152, 0, 0, 0, .06, .34, .01), col: 0xe3d5b5});   // dress-shirt front
  }
  if (sw) {   // water-park swimwear: trunks, or a two-piece with a hip band and small top (modest, kid-park style)
    if (sw === 'm') out.torso.push({g: g.belt, m: M(0, .86, 0, 0, 0, 0, 1.12, 6.4, .8), col: L.suit});
    else {
      out.torso.push({g: g.belt, m: M(0, .95, 0, 0, 0, 0, 1.12, 3.4, .8), col: L.suit});
      for (const sx of [-1, 1]) out.torso.push({g: g.sphereLo, m: M(sx * .07, 1.3, .1, 0, 0, 0, .085, .07, .06), col: L.suit});
      out.torso.push({g: g.cylOpen, m: M(0, 1.3, 0, 0, 0, 0, .2, .035, .155), col: L.suit});
    }
  }
  if (L.dress) out.torso.push({g: g.skirt, m: M(0, 0, 0, 0, 0, 0, 1.1, 1, .82), col: L.pants});
  out.torso.push({g: g.neck, m: M(0, 1.5, 0), ...skinTag});
  // head: ellipsoid skull + nose + ears (skin, face-textured), hair/hat/goggles separately
  out.head.push({g: g.sphere, m: M(0, 1.6, 0, 0, 0, 0, .098, .118, .108), face: true});
  out.head.push({g: g.cone, m: M(0, 1.595, .106, Math.PI / 2 + .12, 0, 0, .014, .034, .014), uv: [.7, .95]});
  for (const sx of [-1, 1]) out.head.push({g: g.sphereLo, m: M(sx * .098, 1.598, -.004, 0, 0, 0, .014, .03, .018), uv: [.7, .95]});
  if (L.hair !== 'bald') {
    const tilt = -.36;
    if (L.hair === 'afro') out.hair.push({g: g.sphere, m: M(0, 1.64, -.012, 0, 0, 0, .15, .15, .15), col: hc});
    else {
      out.hair.push({g: g.hairCap, m: M(0, 1.61, -.004, tilt, 0, 0, .105, .128, .116), col: hc});
      if (L.hair === 'long') out.hair.push({g: g.box, m: M(0, 1.46, -.082, .06, 0, 0, .2, .32, .07), col: hc});
      if (L.hair === 'bun') out.hair.push({g: g.sphereLo, m: M(0, 1.74, -.05, 0, 0, 0, .05, .045, .05), col: hc});
    }
  }
  if (L.beard) out.hair.push({g: g.beard, m: M(0, 1.6, .004, 0, 0, 0, .104, .124, .114), col: hc});
  if (L.hat === 'sun') {   // straw sun hat
    out.hat.push({g: g.cyl, m: M(0, 1.7, 0, 0, 0, 0, .19, .012, .19), col: 0xd8b870});
    out.hat.push({g: g.cyl, m: M(0, 1.74, 0, 0, 0, 0, .1, .07, .105), col: 0xd8b870});
    out.hat.push({g: g.cyl, m: M(0, 1.71, 0, 0, 0, 0, .104, .02, .108), col: L.suit || 0xc04040});
  }
  if (L.hat === 'top') {
    out.hat.push({g: g.cyl, m: M(0, 1.76, 0, 0, 0, 0, .093, .17, .1), col: 0x1c1816});
    out.hat.push({g: g.cyl, m: M(0, 1.68, 0, 0, 0, 0, .15, .012, .155), col: 0x1c1816});
    out.hat.push({g: g.cyl, m: M(0, 1.7, 0, 0, 0, 0, .0955, .03, .1025), col: BRASS});
  } else if (L.hat === 'bowler') {
    out.hat.push({g: g.hairCap, m: M(0, 1.66, 0, 0, 0, 0, .112, .105, .12), col: 0x2a2420});
    out.hat.push({g: g.cyl, m: M(0, 1.668, 0, 0, 0, 0, .15, .008, .155), col: 0x2a2420});
  }
  if (L.goggles) {   // brass goggles pushed up on the forehead + a leather strap round the head
    for (const sx of [-1, 1]) {
      out.hat.push({g: g.torus, m: M(sx * .034, L.hat ? 1.72 : 1.73, .1, -.35, 0, 0, .027, .027, .05), col: BRASS});
      out.hat.push({g: g.cyl, m: M(sx * .034, L.hat ? 1.72 : 1.73, .098, Math.PI / 2 - .35, 0, 0, .02, .006, .02), col: 0x6aa8a0});
    }
    out.hat.push({g: g.cylOpen, m: M(0, L.hat ? 1.72 : 1.73, 0, 0, 0, 0, .103, .024, .114), col: 0x3a2418});
  }
  // arms: pivot at the shoulder, elbow bend baked into the forearm
  const short = L.sleeve === 'short';
  for (const [k, sx] of [['armL', -1], ['armR', 1]]) {
    const A = out[k]; A.pivot = [sx * .225, 1.4, 0];
    A.push({g: g.upper, m: M(0, 0, 0), ...sleeveTag});
    A.sub = {pivot: [0, -.29, 0], rot: -.28, parts: [   // elbow: forearm + hand
      {g: g.fore, m: M(0, 0, 0), ...(short ? skinTag : sleeveTag)},
      {g: g.sphereLo, m: M(0, -.285, 0, 0, 0, 0, .034, .05, .024), ...skinTag}]};
  }
  // legs: pivot at the hip
  for (const [k, sx] of [['legL', -1], ['legR', 1]]) {
    const A = out[k]; A.pivot = [sx * .092, .9, 0];
    A.push({g: g.thigh, m: M(0, 0, 0), ...pantsTag});
    A.sub = {pivot: [0, -.43, 0], rot: .05, parts: [   // knee: shin + shoe
      {g: g.shin, m: M(0, 0, 0), col: L.dress ? L.skin : L.pants, ...(L.dress ? {tag: 'skin'} : {})},
      {g: g.sphereLo, m: M(0, -.428, .035, 0, 0, 0, .056, .044, .118), col: L.shoe || 0x1c1816}]};
  }
  if (L.kid && !L.livePivot) {   // kid proportions: head (+hair, hat, goggles) scaled 1.32× about the neck
    // buildAvatar sets livePivot and scales its headPivot instead, so worn props scale with a kid's head too
    const up = new THREE.Matrix4().makeTranslation(0, 1.52, 0), down = new THREE.Matrix4().makeTranslation(0, -1.52, 0), sc = new THREE.Matrix4().makeScale(1.32, 1.32, 1.32);
    const k = new THREE.Matrix4().multiplyMatrices(up, new THREE.Matrix4().multiplyMatrices(sc, down));
    for (const grp of [out.head, out.hair, out.hat]) for (const p of grp) p.m = new THREE.Matrix4().multiplyMatrices(k, p.m);
  }
  return out;
}

// ---------- crowd: static, merged ----------
const SUITS = [0xe8425f, 0x2f9ad8, 0xf2c14e, 0x3fbf7a, 0xff8a3c, 0x8a5ad8, 0xffffff, 0x1fb8b0];
export function crowdPerson(skin, opts) {
  const L = randomLook(skin);
  if (opts && opts.swim) Object.assign(L, {swim: _rng() < .5 ? 'f' : 'm', suit: pick(SUITS), hat: _rng() < .3 ? 'sun' : null, goggles: false, vest: 0, dress: false, sleeve: 'short', shoe: 0xe8e0d0});
  const R = rig(L), swing = () => (_rng() - .5) * .5;
  const bodyParts = [], headParts = [];
  const add = (list, group, rot) => {
    const pv = group.pivot, pm = pv ? new THREE.Matrix4().compose(_v.set(...pv), _q.setFromEuler(_e.set(rot, 0, 0)), _s.set(1, 1, 1)) : new THREE.Matrix4();
    for (const p of group) {
      const m = pv ? new THREE.Matrix4().multiplyMatrices(pm, p.m) : p.m;
      (p.face || p.uv ? headParts : list).push({g: p.g, m, col: p.col, uv: p.uv});
    }
    if (group.sub) {
      const sm = new THREE.Matrix4().multiplyMatrices(pm, new THREE.Matrix4().compose(_v.set(...group.sub.pivot), _q.setFromEuler(_e.set(group.sub.rot, 0, 0)), _s.set(1, 1, 1)));
      for (const p of group.sub.parts) list.push({g: p.g, m: new THREE.Matrix4().multiplyMatrices(sm, p.m), col: p.col});
    }
  };
  const a = swing(), l = (_rng() - .5) * .3;
  add(bodyParts, R.torso, 0); add(bodyParts, R.hair, 0); add(bodyParts, R.hat, 0); add(headParts, R.head, 0);
  add(bodyParts, R.armL, a); add(bodyParts, R.armR, -a); add(bodyParts, R.legL, l); add(bodyParts, R.legR, -l);
  const root = new THREE.Group();
  const body = new THREE.Mesh(mergeParts(bodyParts, 'color'), VCOL);
  const head = new THREE.Mesh(mergeParts(headParts, 'uv'), faceMat(L.skin, L.expr, L.eye));
  body.castShadow = head.castShadow = true;
  root.add(body, head);
  root.scale.setScalar(L.scale);
  root.userData.steamSkip = true;
  return root;
}

// ---------- avatar: articulated, per-avatar materials for the customisable parts ----------
export function buildAvatar(hue, prof = {}, foot = 0, over = null) {
  const skinIdx = prof.sk != null ? (+prof.sk % SKINS.length) : hue % SKINS.length;
  const shirtC = new THREE.Color().setHSL((prof.hue ?? hue) / 360, .55, .48).getHex();
  const L = {skin: prof.skinHex ?? SKINS[skinIdx], shirt: shirtC, pants: PANTS[hue % PANTS.length], shoe: 0x1c1816, hair: HAIRS[hue % HAIRS.length], hairC: HAIRC[(hue >> 1) % HAIRC.length],
    expr: prof.face || '', eye: hue % 4, sleeve: hue % 2 ? 'short' : 'long', vest: hue % 3 === 0 ? LEATHER[hue % 4] : 0, dress: false,
    hat: prof.cap ? null : (hue % 4 === 0 ? 'top' : hue % 4 === 1 ? 'bowler' : null), goggles: !prof.cap && hue % 5 === 2, beard: hue % 7 === 3 && hue % 2 === 0, scale: 1};
  if (hue % 6 === 5) Object.assign(L, {kid: true, scale: .68, beard: false, vest: 0, hat: null, sleeve: 'short', dress: hue % 4 === 1});   // ~1 in 6 live avatars are kids
  if (over) Object.assign(L, over);
  L.livePivot = true;   // articulated avatars get a real neck pivot (below) instead of a baked kid head matrix
  const R = rig(L), root = new THREE.Group(), body = new THREE.Group();
  body.position.y = foot; body.scale.setScalar(L.scale); root.add(body);   // feet stay put: scaling is about the body origin
  const own = {shirt: new THREE.MeshStandardMaterial({color: L.shirt, roughness: .78}), skin: new THREE.MeshStandardMaterial({color: L.skin, roughness: .62})};   // L.shirt, not shirtC: an `over` shirt colour must win
  const build = (parts, parent, part) => {   // part: stamps userData.part so js/wear.js can hide a default hair/hat when one is worn   // one mesh per bucket: the live-recolourable tags (shirt, skin) each get
    // their own material; brass keeps its shine; EVERYTHING else (belt, vest, hair, hat, goggles, pants, shoe...)
    // shares one vertex-coloured mesh per call, like crowdPerson. Draw calls per avatar: ~16 -> ~12.
    const buckets = new Map();
    for (const p of parts) { if (p.face) continue; const k = p.tag || (p.uv ? 'u' + p.col : p.col === BRASS ? 'brass' : 'v'); (buckets.get(k) || buckets.set(k, []).get(k)).push(p); }
    for (const [k, ps] of buckets) {
      const tag = ps[0].tag;
      const m = new THREE.Mesh(mergeParts(ps.map(p => ({g: p.g, m: p.m, uv: p.uv, col: p.col})), ps[0].uv ? 'uv' : 'color'),
        tag ? own[tag] : ps[0].uv ? faceMat(L.skin, L.expr, L.eye) : k === 'brass' ? mat(BRASS, .35, .8) : VCOL);
      if (tag) m.userData.custom = tag;
      if (part) m.userData.part = part;
      m.castShadow = tag === 'shirt'; parent.add(m);
    }
  };
  build(R.torso, body);
  // ---- neck pivot: the head, hair and hat are merged meshes whose vertices sit up at y~1.6, so rotating a
  // mesh would swing it in an arc. headRig undoes the pivot's own translation, which keeps every part matrix
  // in body space exactly as rig() built it, while headPivot.rotation.y turns the whole head. A kid's head
  // is scaled here instead of by rig()'s baked matrix (same 1.32 about the same y=1.52), so anything worn on
  // the head scales with it. js/truck.js's cook and the wearable sockets below both hang off this.
  const NECK = 1.52;
  const headPivot = new THREE.Group(); headPivot.position.y = NECK; if (L.kid) headPivot.scale.setScalar(1.32);
  const headRig = new THREE.Group(); headRig.position.y = -NECK; headPivot.add(headRig); body.add(headPivot);
  build(R.hair, headRig, 'hair'); build(R.hat, headRig, 'hat');   // separate meshes so a worn wig / hat can hide just its default
  const head = new THREE.Mesh(mergeParts(R.head.map(p => ({g: p.g, m: p.m, uv: p.uv})), 'uv'), faceMat(L.skin, L.expr, L.eye));
  head.userData.custom = 'skin'; head.userData.skinFace = L.expr + '|' + L.eye; head.castShadow = true; headRig.add(head);
  const arms = [], legs = [], hands = [], feet = [];
  for (const k of ['armL', 'armR', 'legL', 'legR']) {
    const piv = new THREE.Group(); piv.position.set(...R[k].pivot); build(R[k], piv); body.add(piv);
    const sub = new THREE.Group(); sub.position.set(...R[k].sub.pivot); sub.rotation.x = R[k].sub.rot; build(R[k].sub.parts, sub); piv.add(sub);
    piv.userData.sub = sub; piv.userData.rest = R[k].sub.rot;   // elbow / knee: rotate .sub.rotation.x for bends
    const arm = k[0] === 'a';
    const tip = new THREE.Group();   // hand / foot socket: rides the elbow or knee, so props follow the swing
    tip.position.set(0, arm ? -.30 : -.428, arm ? 0 : .035); sub.add(tip);
    (arm ? arms : legs).push(piv); (arm ? hands : feet).push(tip);
  }
  // ---- wearable sockets. Head-side ones hang off headRig so they turn with the face; the rest ride the body.
  // All are given in the same body-space metres as avatars.js BLING_POS, before look.scale.
  const sock = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
  root.userData.sock = {
    crown: sock(headRig, 0, 1.712, 0),     // top of the skull: hats, hair pieces
    face: sock(headRig, 0, 1.56, .098),   // eye line: glasses, goggles, monocle
    chin: sock(headRig, 0, 1.545, .055),   // jaw: beards, moustaches
    ear: sock(headRig, 0, 1.598, 0),       // ear line: headphones, earrings (prop straddles both ears)
    collar: sock(body, 0, 1.46, .05),      // neck: scarves, ties, chains
    chest: sock(body, 0, 1.22, .16),       // front of the torso: medallions, cameras, aprons
    back: sock(body, 0, 1.24, -.16),       // upper back: backpacks, guitars
    hip: sock(body, 0, .97, .1),           // waist: belts, fanny packs
  };
  root.userData.headPivot = headPivot; root.userData.headRig = headRig; root.userData.hands = hands; root.userData.feet = feet;
  root.userData.arms = arms; root.userData.legs = legs; root.userData.head = head; root.userData.steamSkip = true;
  root.userData.look = L; root.userData.foot = foot; root.userData.scale = L.scale;
  return root;
}
// swap an avatar head to another skin tone (reskinLive): faces are baked per tone
export function skinHead(mesh, skinHex) {
  const [expr, eye] = String(mesh.userData.skinFace || '|0').split('|');
  mesh.material = faceMat(skinHex, expr, +eye || 0);
}
