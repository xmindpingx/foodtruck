// wear.js — 3D wearables: ComfyUI-generated props (models/wear/<id>.json+bin, via model.js) hung on the sockets
// people.js builds on every articulated avatar. A catalog row opts in with `model:true`; its `slot` is a socket
// name below. Geometry is loaded ONCE per id and shared by every wearer (so disposeBody must skip meshes tagged
// userData.shared). Props are ground-anchored (lowest point y=0) at length `len` metres, scaled by `fit`.
import * as THREE from 'three';
import * as Model from './model.js?v=3';

const MATS = {   // shared materials, chosen per catalog row by `mat` (generated meshes carry no colour of their own)
  leather: [0x4a2e1c, .55, 0], felt: [0x56585e, .95, 0], straw: [0xd8b870, .9, 0], denim: [0x3a5a8a, .85, 0], cloth: [0x8a8f9a, .9, 0],
  gold: [0xd4a63a, .3, .9], silver: [0xc8ccd2, .28, .9], chrome: [0xdfe4e8, .12, 1], glass: [0x0b0e15, .08, .3], rubber: [0x1c1c20, .8, 0],
  neon: [0xff2ea6, .35, .15], aqua: [0x2ec4ff, .35, .15], lime: [0x9cff3a, .35, .15], vivid: [0x8a2be2, .35, .15],
  feather: [0xf0e8d0, .9, 0],
  wood: [0x7a4a28, .6, 0], hairdark: [0x1a1208, .8, 0], hairlight: [0x8a6a3a, .8, 0], black: [0x101012, .35, .2],
};
const mats = {}, geos = new Map();
const mat = k => mats[k] || (mats[k] = new THREE.MeshStandardMaterial({color: (MATS[k] || MATS.cloth)[0], roughness: (MATS[k] || MATS.cloth)[1], metalness: (MATS[k] || MATS.cloth)[2]}));

// catalog slot -> where it hangs (people.js userData.sock / hands / feet). 'shoes' goes on both feet.
export const SLOTS = {hat: 'crown', hair: 'crown', glasses: 'face', beard: 'chin', ears: 'ear', collar: 'collar', chest: 'chest', back: 'back', waist: 'hip',
  handL: 'hand0', handR: 'hand1', shoes: 'feet'};
// where a ground-anchored, X/Z-centred prop sits relative to its socket (metres, body space); a row's own fit/dy/dz/ry win
const FIT = {hat: {dy: -.06}, glasses: {dy: -.025, dz: .05}, beard: {dy: -.04, dz: .02}, collar: {dy: -.04, dz: .03}, back: {dy: -.2, dz: -.05},
  waist: {dy: -.05, dz: .02}, shoes: {dy: -.044}, chest: {dy: -.05, dz: .03}, handL: {dy: -.05}, handR: {dy: -.05}};
export const isWear = it => !!(it && it.model && SLOTS[it.slot]);

function sockets(root, slot) {
  const u = root.userData, s = SLOTS[slot];
  if (s === 'feet') return u.feet || [];
  if (s === 'hand0') return u.hands ? [u.hands[0]] : [];
  if (s === 'hand1') return u.hands ? [u.hands[1]] : [];
  return u.sock && u.sock[s] ? [u.sock[s]] : [];
}
const geometry = id => {   // one fetch + one BufferGeometry per id, however many avatars wear it
  if (!geos.has(id)) geos.set(id, Model.load('wear/' + id).then(m => m.geometry).catch(() => null));
  return geos.get(id);
};
// remove whatever this avatar wears from 3D slots, then hang each catalog row's prop; crowd bodies (no sockets) are skipped
export async function apply(root, rows) {
  if (!root || !root.userData || !root.userData.sock) return;
  const gen = root.userData.wearGen = (root.userData.wearGen || 0) + 1;
  for (const m of root.userData.worn || []) m.parent && m.parent.remove(m);
  const worn = root.userData.worn = [];
  const hr = root.userData.headRig, hide = new Set(rows.filter(isWear).map(r => r.slot === 'hat' ? 'hat' : r.slot === 'hair' ? 'hair' : ''));
  if (hr) hr.children.forEach(c => { if (c.userData.part) c.visible = !hide.has(c.userData.part); });   // worn hat/hair replaces the default one
  for (const it of rows) {
    if (!isWear(it)) continue;
    const g = await geometry(it.id); if (!g || root.userData.wearGen !== gen) continue;   // a newer apply() took over while we awaited
    sockets(root, it.slot).forEach((sock, i) => {
      const m = new THREE.Mesh(g, mat(it.mat)), f = FIT[it.slot] || {}; m.userData.shared = true; m.castShadow = true;
      m.scale.setScalar(it.fit || 1); if (it.slot === 'shoes' && i === 0) m.scale.x *= -1;   // one right shoe generated; mirror it for the left foot
      m.position.set(0, it.dy ?? f.dy ?? 0, it.dz ?? f.dz ?? 0); if (it.ry) m.rotation.y = it.ry * Math.PI / 180;
      sock.add(m); worn.push(m);
    });
  }
}
