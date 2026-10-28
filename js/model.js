// model.js — loads the compact meshes that tools/model_gen.py bakes out of a ComfyUI-generated GLB.
// Format (models/<name>.json + <name>.bin): quantised interleaved-free blocks, in this order —
//   positions  Uint16 x3   (mapped back through the json's lo/hi bounding box)
//   normals    Int8   x3   (/127)
//   uvs        Uint16 x2   (/65535)
//   colours    Uint8  x3   (only when json.vcol; sRGB vertex colours straight off the generator)
//   indices    Uint16 or Uint32 x3 per triangle (json.idx says which)
// The mesh arrives centred on X/Z with its lowest point at y=0, scaled to the length the packer was
// given, so a caller can drop it straight into the scene. Phones get the half-size *.m.jpg maps.
// Nothing here is three.js-version specific beyond BufferGeometry/BufferAttribute.
import * as THREE from 'three';

const V = 3;   // bump when models/* are regenerated so browsers refetch

// opts.materials: {<group name>: Material} — the generator bakes one colour field over the whole car, so
// the packer splits it into paint/tyre/chrome/glass groups and the caller shades each properly.
export async function load(name, {small = false, base = '/models', materials = null} = {}) {
  const meta = await (await fetch(`${base}/${name}.json?v=${V}`)).json();
  const buf = await (await fetch(`${base}/${name}.bin?v=${V}`)).arrayBuffer();
  const n = meta.verts, tri = meta.tris * 3;
  let o = 0;
  const step = bytes => { const at = o; o = (o + bytes + 3) & ~3; return at; };   // each block is 4-byte padded
  const pos = new Uint16Array(buf, step(n * 6), n * 3);
  const nrm = new Int8Array(buf, step(n * 3), n * 3);
  const uv = new Uint16Array(buf, step(n * 4), n * 2);
  const col = meta.vcol ? new Uint8Array(buf, step(n * 3), n * 3) : null;
  const idx = meta.idx === 32 ? new Uint32Array(buf, step(tri * 4), tri) : new Uint16Array(buf, step(tri * 2), tri);

  const g = new THREE.BufferGeometry();
  const [lx, ly, lz] = meta.lo, [hx, hy, hz] = meta.hi;
  const sx = (hx - lx) / 65535, sy = (hy - ly) / 65535, sz = (hz - lz) / 65535;
  const p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    p[i * 3] = lx + pos[i * 3] * sx; p[i * 3 + 1] = ly + pos[i * 3 + 1] * sy; p[i * 3 + 2] = lz + pos[i * 3 + 2] * sz;
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3, true));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2, true));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();

  const maps = meta.maps || {};
  const mat = new THREE.MeshStandardMaterial({vertexColors: !!col, roughness: .45, metalness: .25, envMapIntensity: 1.2});
  if (Object.keys(maps).length) {
    const L = new THREE.TextureLoader();
    const file = f => `${base}/${small ? f.replace(/\.jpg$/, '.m.jpg') : f}?v=${V}`;
    const get = (f, srgb) => { const t = L.load(file(f)); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 4; t.flipY = false; return t; };
    if (maps.color) mat.map = get(maps.color, true);
    if (maps.normal && !small) mat.normalMap = get(maps.normal, false);
    if (maps.orm) { mat.roughnessMap = mat.metalnessMap = get(maps.orm, false); mat.aoMap = mat.roughnessMap; }
  }
  let material = mat;
  const groups = meta.groups || [];
  if (materials && groups.length) {
    material = [];
    groups.forEach((gr, i) => { g.addGroup(gr.start, gr.count, i); material.push(materials[gr.name] || mat); });
  }
  const mesh = new THREE.Mesh(g, material);
  mesh.userData.meta = meta;
  mesh.userData.groups = groups.map(gr => gr.name);
  return mesh;
}
