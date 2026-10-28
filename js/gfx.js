// gfx.js — photoreal surface textures rendered on the owner's ComfyUI (tools/gfx_gen.py → gfx/*.jpg).
// Builders tag a material with userData.gfx = '<name>' and optional
//   gfxRepeat [x, y]   uv repeat (default: keep the old map's repeat, else 1×1)
//   gfxTint true       keep material.color as a tint (neutral fabric) — themefx may still recolour it
//   gfxShade 0..1      grey multiplier for natural textures (darker stain), else colour → white
//   gfxOwn true        give this material its own texture object (its uv offset is animated, e.g. the lazy river)
//   gfxMacro texture   (ground) blend this low-frequency texture over the photo to break up tiling
//   gfxSign fn(img)    (booth signs) repaint the sign canvas on top of the generated board image
// apply(root) swaps them in once the images load. Phones / lite mode get the half-size *.m.jpg files and no
// normal maps; GPU textures are shared per image (three.js r160 caches by source). Untagged materials and the
// truck are never touched. Admin → Environment → "Photo textures" (sceneTextures) switches it all off.
import * as THREE from 'three';

const V = 1;   // bump when gfx/*.jpg are regenerated so browsers refetch
const NORMAL = {grass: .55, stone: .45, sand: .4, wood: .8, canvas: .3};   // desktop normal-map strength
const SPECIAL = {deck: 'stone', backdrop: 'backdrop'};

export function init({R, small, enabled = true}) {
  const L = new THREE.TextureLoader(), files = new Map(), done = new WeakSet();
  const aniso = Math.min(small ? 4 : 8, R.capabilities.getMaxAnisotropy());
  const file = (name, kind) => `/gfx/${name}${kind === 'n' ? '.n' : small ? '.m' : ''}.jpg?v=${V}`;
  function get(name, kind) {   // → Promise<Texture|null>, one network load per file
    const url = file(name, kind);
    let p = files.get(url);
    if (!p) {
      p = L.loadAsync(url).then(t => {
        t.colorSpace = kind === 'n' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; return t;
      }).catch(() => null);
      files.set(url, p);
    }
    return p;
  }
  const img = name => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = file(name); });
  const variant = (base, rx, ry) => { const t = base.clone(); t.repeat.set(rx, ry); return t; };   // shares the GPU texture

  // ground: photo grass + the old procedural canvas as a low-frequency multiplier (trampled paths, mow bands)
  function macro(m, tex, repeat) {
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const g = c.getContext('2d'); g.drawImage(tex.image, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data; let r = 0, gg = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4, avg = new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
    m.onBeforeCompile = sh => {
      sh.uniforms.uMacro = {value: tex}; sh.uniforms.uMacroAvg = {value: new THREE.Vector3(avg.r, avg.g, avg.b)};
      sh.uniforms.uMacroRepeat = {value: repeat}; sh.uniforms.uMacroMix = {value: .65};
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vMacroUv;\nuniform float uMacroRepeat;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMacroUv = uv * uMacroRepeat;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vMacroUv;\nuniform sampler2D uMacro;\nuniform vec3 uMacroAvg;\nuniform float uMacroMix;')
        .replace('#include <map_fragment>', '#include <map_fragment>\n{ vec3 mc = texture2D(uMacro, vMacroUv).rgb; diffuseColor.rgb *= mix(vec3(1.0), clamp(mc / max(uMacroAvg, vec3(1e-3)), 0.0, 2.2), uMacroMix); }');
    };
    m.customProgramCacheKey = () => 'eol-macro-ground';
  }

  async function one(m) {
    const u = m.userData, name = u.gfx;
    if (u.gfxSign) { const bg = await img('signboard'); if (bg) u.gfxSign(bg); return; }
    const src = SPECIAL[name] || name;
    const base = await get(src); if (!base) return;
    const old = m.map, rep = u.gfxRepeat || (old ? [old.repeat.x, old.repeat.y] : [1, 1]);
    let t = variant(base, rep[0], rep[1]);
    if (name === 'deck') {   // travertine + grout lines (4×4 tiles per repeat, matching the old canvas grid)
      const S = small ? 256 : 512, c = document.createElement('canvas'); c.width = c.height = S;
      const g = c.getContext('2d'); g.drawImage(base.image, 0, 0, S, S);
      g.strokeStyle = 'rgba(110,92,70,.55)'; g.lineWidth = S / 128;
      for (let i = 0; i <= S; i += S / 4) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.moveTo(0, i); g.lineTo(S, i); g.stroke(); }
      t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; t.repeat.set(rep[0], rep[1]);
    }
    if (u.gfxMacro) macro(m, u.gfxMacro, u.gfxMacroRepeat || 6);
    if (name === 'backdrop') {   // LED wall: glows, ignores the sun
      m.map = t; m.emissiveMap = t; m.emissive.setHex(0xffffff); m.emissiveIntensity = .9; m.color.setHex(0x1a1a1a);
    } else {
      m.map = t;
      if (!u.gfxTint) m.color.setScalar(u.gfxShade ?? 1);
    }
    if (!small && NORMAL[src] && !u.gfxNoNormal) {
      const nb = await get(src, 'n');
      if (nb) { m.normalMap = variant(nb, rep[0], rep[1]); m.normalScale.set(NORMAL[src], NORMAL[src]); }
    }
    m.needsUpdate = true;
    if (old && old !== t && old.isCanvasTexture && !u.gfxMacro) old.dispose();   // the procedural canvas it replaces
  }

  function apply(root) {
    if (!enabled) return;
    root.traverse(o => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m || !m.userData || !m.userData.gfx || done.has(m)) continue;
        done.add(m); one(m);
      }
    });
  }
  return {apply, enabled};
}
