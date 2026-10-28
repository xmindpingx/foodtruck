#!/usr/bin/env python3
"""model_gen.py — generate a hyper-real 3D prop on the owner's ComfyUI and pack it for the web.

  python3 tools/model_gen.py refs                 reference photos of the car (FLUX.2) -> tools/model_raw/
  python3 tools/model_gen.py model <ref.png>      TRELLIS 2 image->3D -> tools/model_raw/<name>.glb (+ preview PNG)
  python3 tools/model_gen.py pack <file.glb> impala --len 5.4 [--rot-x -90] [--yaw 180]
                                                 -> models/impala.{json,bin} + impala-*.jpg (desktop + .m phone)
  python3 tools/model_gen.py info <file.glb>      print mesh/texture stats and the bounding box

ComfyUI (http://127.0.0.1:8888) is socket-activated: the first call wakes it, which can take minutes.
Raw renders and GLBs stay in tools/model_raw/ (gitignored); only models/ is served.
Dev tool: needs Pillow + numpy. The server never imports this.
"""
import json, os, shutil, struct, sys, time, urllib.error, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW, OUT = os.path.join(ROOT, 'tools', 'model_raw'), os.path.join(ROOT, 'models')
COMFY = 'http://127.0.0.1:8888'
COMFY_HOME = '/home/dad/aaservers/ComfyUI'


# ---------------------------------------------------------------- ComfyUI client (retries on every call)
def _get(url, timeout=30, tries=5):
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r: return r.read()
        except Exception as e:
            last = e; time.sleep(2 + i * 2)
    raise last


def _post(url, payload, timeout=60, tries=5):
    body = json.dumps(payload).encode()
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, body, {'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=timeout) as r: return r.read()
        except urllib.error.HTTPError as e:
            raise RuntimeError(f'ComfyUI rejected the graph: {e.read()[:3000].decode("utf8", "replace")}') from None
        except Exception as e:
            last = e; time.sleep(2 + i * 2)
    raise last


def wake(wait=600):
    t0 = time.time()
    while time.time() - t0 < wait:
        try:
            _get(COMFY + '/system_stats', timeout=20, tries=1); return True
        except Exception: time.sleep(4)
    raise SystemExit(f'ComfyUI did not answer at {COMFY} within {wait}s')


def run(graph, wait=3600, label=''):
    """Queue a graph, wait for it, return its history entry (outputs by node id). Poll failures are retried."""
    pid = json.loads(_post(COMFY + '/prompt', {'prompt': graph, 'client_id': 'elotrolado-model'}))['prompt_id']
    t0, misses = time.time(), 0
    while time.time() - t0 < wait:
        time.sleep(3)
        try:
            h = json.loads(_get(f'{COMFY}/history/{pid}', timeout=30, tries=3)).get(pid)
        except Exception:
            misses += 1
            if misses > 40: raise
            continue
        if not h: continue
        st = h.get('status', {})
        if st.get('status_str') == 'error':
            raise RuntimeError(f'{label} failed: ' + json.dumps(st.get('messages', []))[-2000:])
        if st.get('completed') or h.get('outputs'):
            print(f'  {label} done in {time.time()-t0:.0f}s', flush=True)
            return h.get('outputs', {})
    raise RuntimeError(f'{label} timed out after {wait}s')


def fetch_image(im):
    q = urllib.parse.urlencode({'filename': im['filename'], 'subfolder': im.get('subfolder', ''), 'type': im.get('type', 'output')})
    return _get(f'{COMFY}/view?{q}', timeout=120)


# ---------------------------------------------------------------- reference photos
BASE = ('classic 1960s American lowrider two-door hardtop, long low boxy body with crisp horizontal fins and a flat roofline, '
        'deep candy purple metallic paint with a mirror clear coat, chrome bumpers, chrome window trim, chrome wire-spoke wheels '
        'with thin whitewall tires, windows up, clean unbadged body with no emblems')
TAIL = ('plain seamless pure white studio background, soft even studio lighting, sharp focus, photorealistic product photograph, '
        'the whole car visible and centred with generous margin, no people, no text, no logos, no badges, no license plate, no watermark')
VIEWS = {
    'f': ('front three-quarter view from slightly above, wheels straight, completely flat even diffuse lighting '
          'with no specular highlights, no reflections and no glare on the paint, matte finish, uniform shadowless '
          'illumination like a texture reference photo'),
    'a': 'front three-quarter view from slightly above, wheels straight',
    'b': 'direct side profile view at eye level',
    'c': 'rear three-quarter view from slightly above',
}


def refs(only=None, n=2):
    os.makedirs(RAW, exist_ok=True)
    wake()
    for k, v in VIEWS.items():
        if only and k not in only: continue
        for i in range(n):
            dst = os.path.join(RAW, f'impala-{k}{i}.png')
            if os.path.exists(dst): continue
            graph = flux_graph(f'{BASE}, {v}. {TAIL}', 1024, 1024, seed=1000 + i * 7 + ord(k))
            outs = run(graph, label=f'ref {k}{i}')
            for node in outs.values():
                for im in node.get('images', []):
                    open(dst, 'wb').write(fetch_image(im)); print(f'  -> {dst}', flush=True); break
    print('DONE')


def flux_graph(prompt, w, h, seed, steps=4):
    """The same FLUX.2 klein workflow server.py uses for menu photos, as an API graph."""
    return {
        '1': {'class_type': 'UNETLoader', 'inputs': {'unet_name': 'flux-2-klein-4b.safetensors', 'weight_dtype': 'default'}},
        '2': {'class_type': 'CLIPLoader', 'inputs': {'clip_name': 'qwen_3_4b.safetensors', 'type': 'flux2', 'device': 'default'}},
        '3': {'class_type': 'VAELoader', 'inputs': {'vae_name': 'flux2-vae.safetensors'}},
        '4': {'class_type': 'CLIPTextEncode', 'inputs': {'text': prompt, 'clip': ['2', 0]}},
        '5': {'class_type': 'EmptyFlux2LatentImage', 'inputs': {'width': w, 'height': h, 'batch_size': 1}},
        '6': {'class_type': 'Flux2Scheduler', 'inputs': {'steps': steps, 'width': w, 'height': h}},
        '7': {'class_type': 'KSamplerSelect', 'inputs': {'sampler_name': 'euler'}},
        '8': {'class_type': 'RandomNoise', 'inputs': {'noise_seed': seed}},
        '9': {'class_type': 'BasicGuider', 'inputs': {'model': ['1', 0], 'conditioning': ['4', 0]}},
        '10': {'class_type': 'SamplerCustomAdvanced', 'inputs': {'noise': ['8', 0], 'guider': ['9', 0], 'sampler': ['7', 0], 'sigmas': ['6', 0], 'latent_image': ['5', 0]}},
        '11': {'class_type': 'VAEDecode', 'inputs': {'samples': ['10', 0], 'vae': ['3', 0]}},
        '12': {'class_type': 'SaveImage', 'inputs': {'images': ['11', 0], 'filename_prefix': 'elotrolado_ref'}},
    }


# ---------------------------------------------------------------- TRELLIS 2 image -> textured mesh
def trellis_graph(image_name, seed=42, faces=60000, tex=2048, unwrap=2048, remesh=768, prefix='3d/eol', uv=False):
    """Trimmed version of ComfyUI's own 3d_pixal3d_trellis2_image_to_model template (TRELLIS.2 branch only)."""
    g = {
        '1': {'class_type': 'UNETLoader', 'inputs': {'unet_name': 'trellis_2_int8_convrot.safetensors', 'weight_dtype': 'default'}},
        '2': {'class_type': 'CLIPVisionLoader', 'inputs': {'clip_name': 'dino_v3_L_naf_fp32.safetensors'}},
        '3': {'class_type': 'VAELoader', 'inputs': {'vae_name': 'trellis_2_shape_vae_bf16.safetensors'}},
        '4': {'class_type': 'VAELoader', 'inputs': {'vae_name': 'trellis_2_texture_vae_bf16.safetensors'}},
        '5': {'class_type': 'LoadImage', 'inputs': {'image': image_name}},
        '6': {'class_type': 'LoadBackgroundRemovalModel', 'inputs': {'bg_removal_name': 'birefnet.safetensors'}},
        '7': {'class_type': 'RemoveBackground', 'inputs': {'bg_removal_model': ['6', 0], 'image': ['5', 0]}},
        '8': {'class_type': 'ImageCropToMask', 'inputs': {'images': ['5', 0], 'masks': ['7', 0], 'width': 1024, 'height': 1024,
                                                          'pad_factor': 1.1, 'grow_mask': 0, 'background': '#000000'}},
        '9': {'class_type': 'Trellis2Conditioning', 'inputs': {'clip_vision_model': ['2', 0], 'image': ['8', 0]}},
        # --- structure (sparse voxels)
        '10': {'class_type': 'CFGOverride', 'inputs': {'model': ['1', 0], 'cfg': 1.0, 'start_percent': 0.667, 'end_percent': 1.0}},
        '11': {'class_type': 'RescaleCFG', 'inputs': {'model': ['10', 0], 'multiplier': 0.7}},
        '12': {'class_type': 'ModelSamplingSD3', 'inputs': {'model': ['11', 0], 'shift': 5.0}},
        '13': {'class_type': 'EmptyTrellis2LatentStructure', 'inputs': {'batch_size': 1}},
        '14': {'class_type': 'KSampler', 'inputs': {'model': ['12', 0], 'positive': ['9', 0], 'negative': ['9', 1], 'latent_image': ['13', 0],
                                                    'seed': seed, 'steps': 12, 'cfg': 7.5, 'sampler_name': 'euler', 'scheduler': 'normal', 'denoise': 1.0}},
        '15': {'class_type': 'VaeDecodeStructureTrellis2', 'inputs': {'samples': ['14', 0], 'vae': ['3', 0], 'resolution': '32'}},
        # --- shape
        '16': {'class_type': 'Trellis2ShapeStage', 'inputs': {'positive': ['9', 0], 'negative': ['9', 1], 'voxel': ['15', 0]}},
        '17': {'class_type': 'CFGOverride', 'inputs': {'model': ['1', 0], 'cfg': 1.0, 'start_percent': 0.769, 'end_percent': 1.0}},
        '18': {'class_type': 'RescaleCFG', 'inputs': {'model': ['17', 0], 'multiplier': 0.5}},
        '19': {'class_type': 'KSampler', 'inputs': {'model': ['18', 0], 'positive': ['16', 0], 'negative': ['16', 1], 'latent_image': ['16', 2],
                                                    'seed': seed, 'steps': 20, 'cfg': 7.5, 'sampler_name': 'euler', 'scheduler': 'normal', 'denoise': 1.0}},
        '20': {'class_type': 'Trellis2UpsampleStage', 'inputs': {'positive': ['16', 0], 'negative': ['16', 1], 'shape_latent': ['19', 0],
                                                                 'vae': ['3', 0], 'target_resolution': 1536}},
        '21': {'class_type': 'KSampler', 'inputs': {'model': ['18', 0], 'positive': ['20', 0], 'negative': ['20', 1], 'latent_image': ['20', 2],
                                                    'seed': seed, 'steps': 12, 'cfg': 7.5, 'sampler_name': 'euler', 'scheduler': 'simple', 'denoise': 1.0}},
        '22': {'class_type': 'VaeDecodeShapeTrellis', 'inputs': {'samples': ['21', 0], 'vae': ['3', 0]}},
        # --- colour
        '23': {'class_type': 'Trellis2TextureStage', 'inputs': {'positive': ['20', 0], 'negative': ['20', 1], 'shape_latent': ['21', 0]}},
        '24': {'class_type': 'KSampler', 'inputs': {'model': ['1', 0], 'positive': ['23', 0], 'negative': ['23', 1], 'latent_image': ['23', 2],
                                                    'seed': seed + 1, 'steps': 12, 'cfg': 1.0, 'sampler_name': 'euler', 'scheduler': 'normal', 'denoise': 1.0}},
        '25': {'class_type': 'VaeDecodeTextureTrellis', 'inputs': {'samples': ['24', 0], 'vae': ['4', 0], 'shape_subdivides': ['22', 1]}},
        # --- mesh clean-up, UVs and baking
        '26': {'class_type': 'GetMeshInfo', 'inputs': {'mesh': ['22', 0]}},
        '27': {'class_type': 'RemeshMesh', 'inputs': {'mesh': ['26', 0], 'resolution': remesh, 'sign_mode': 'udf', 'sign_mode.qef': False,
                                                      'sign_mode.drop_inverted_components': False,
                                                      'sign_mode.drop_enclosed_components': False, 'band': 1.0,
                                                      'project_back': 0.0, 'fix_poles': False, 'smooth_iters': 20,
                                                      'drop_small_components': 0.01, 'precluster_max_verts': 20000000}},
        '28': {'class_type': 'DecimateMesh', 'inputs': {'mesh': ['27', 0], 'target_face_count': faces, 'placement_mode': 'midpoint'}},
        '29': {'class_type': 'MeshSmoothNormals', 'inputs': {'mesh': ['28', 0], 'crease_angle': 180.0}},
    }
    if not uv:
        # Vertex colours straight off the coloured voxels. The UV route (below) needs a double-precision
        # batched LU solve for the LSCM unwrap, which runs the RX 6800 out of VRAM with the 5 GB model
        # resident - and for a web prop vertex colours are lighter anyway (no atlas to download).
        g['30'] = {'class_type': 'PaintMesh', 'inputs': {'mesh': ['29', 0], 'voxel_colors': ['25', 0]}}
        g['36'] = {'class_type': 'SaveGLB', 'inputs': {'mesh': ['30', 0], 'filename_prefix': prefix}}
        return g
    g.update({
        '30': {'class_type': 'UnwrapMesh', 'inputs': {'mesh': ['29', 0], 'segmenter': 'pec', 'resolution': unwrap, 'padding': 1, 'weld_distance': 0.0002}},
        '31': {'class_type': 'BakeTextureFromVoxel', 'inputs': {'mesh': ['30', 0], 'voxel_colors': ['25', 0], 'texture_size': tex, 'reference_mesh': ['22', 0]}},
        '32': {'class_type': 'BakeNormalMapFromMesh', 'inputs': {'low_poly': ['30', 0], 'high_poly': ['27', 0], 'resolution': tex,
                                                                 'cage_distance': 0.05, 'ignore_backfaces': True}},
        '33': {'class_type': 'BakeAmbientOcclusion', 'inputs': {'low_poly': ['30', 0], 'high_poly': ['27', 0], 'resolution': max(1024, tex // 2),
                                                                'samples': 64, 'max_distance': 0.71, 'strength': 1.0, 'bias': 0.01}},
        '34': {'class_type': 'ApplyTextureToMesh', 'inputs': {'mesh': ['30', 0], 'base_color': ['31', 0], 'metallic': ['31', 1],
                                                              'roughness': ['31', 2], 'occlusion': ['33', 0], 'normal_map': ['32', 0]}},
        '35': {'class_type': 'MeshSmoothNormals', 'inputs': {'mesh': ['34', 0], 'crease_angle': 180.0}},
        '36': {'class_type': 'SaveGLB', 'inputs': {'mesh': ['35', 0], 'filename_prefix': prefix}},
    })
    return g


def model(ref, seed=42, faces=60000, tex=2048, uv=False):
    os.makedirs(RAW, exist_ok=True)
    src = ref if os.path.isabs(ref) else os.path.join(RAW, ref)
    if not os.path.isfile(src): raise SystemExit(f'no such reference image: {src}')
    name = 'eol_' + os.path.basename(src)
    shutil.copy(src, os.path.join(COMFY_HOME, 'input', name))   # same machine: hand ComfyUI the file directly
    stem = os.path.splitext(os.path.basename(src))[0]
    prefix = f'3d/eol_{stem}'
    wake()
    print(f'TRELLIS 2 on {os.path.basename(src)} (seed {seed}, {faces} faces, {tex}px textures) — this takes a few minutes', flush=True)
    run(trellis_graph(name, seed=seed, faces=faces, tex=tex, unwrap=tex, prefix=prefix, uv=uv), label='trellis')
    outdir = os.path.join(COMFY_HOME, 'output', '3d')
    globs = sorted((os.path.join(outdir, f) for f in os.listdir(outdir) if f.startswith(f'eol_{stem}') and f.endswith('.glb')),
                   key=os.path.getmtime)
    if not globs: raise SystemExit(f'no GLB written under {outdir}')
    dst = os.path.join(RAW, f'{stem}.glb')
    shutil.copy(globs[-1], dst)
    print(f'-> {dst} ({os.path.getsize(dst)//1024} KB)')
    info(dst)


# ---------------------------------------------------------------- GLB reading
CT = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_glb(path):
    import numpy as np
    raw = open(path, 'rb').read()
    magic, _ver, _len = struct.unpack_from('<4sII', raw, 0)
    if magic != b'glTF': raise SystemExit('not a GLB file')
    off, js, binr = 12, None, b''
    while off < len(raw):
        clen, ctype = struct.unpack_from('<II', raw, off)
        data = raw[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A: js = json.loads(data)
        elif ctype == 0x004E4942: binr = data
        off += 8 + clen + (-clen % 4)
    g = js

    def acc(i):
        a = g['accessors'][i]
        fmt, size = CT[a['componentType']]
        n = NC[a['type']]
        bv = g['bufferViews'][a['bufferView']]
        base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = bv.get('byteStride') or size * n
        arr = np.frombuffer(binr, dtype=np.dtype(fmt), count=a['count'] * n) if stride == size * n else None
        if arr is None:   # interleaved
            out = np.empty((a['count'], n), dtype=np.dtype(fmt))
            for k in range(a['count']):
                out[k] = np.frombuffer(binr, dtype=np.dtype(fmt), count=n, offset=base + k * stride)
            return out
        arr = np.frombuffer(binr, dtype=np.dtype(fmt), count=a['count'] * n, offset=base)
        return arr.reshape(a['count'], n)

    prims = []
    for m in g.get('meshes', []):
        for p in m['primitives']:
            at = p['attributes']
            prims.append({'pos': acc(at['POSITION']).astype('f4'),
                          'nrm': acc(at['NORMAL']).astype('f4') if 'NORMAL' in at else None,
                          'uv': acc(at['TEXCOORD_0']).astype('f4') if 'TEXCOORD_0' in at else None,
                          'col': acc(at['COLOR_0']).astype('f4') if 'COLOR_0' in at else None,
                          'idx': acc(p['indices']).astype('u4').ravel() if 'indices' in p else None,
                          'mat': p.get('material')})
    texes = {}
    for mi, mat in enumerate(g.get('materials', [])):
        pbr = mat.get('pbrMetallicRoughness', {})
        slots = {'color': pbr.get('baseColorTexture'), 'orm': pbr.get('metallicRoughnessTexture'),
                 'normal': mat.get('normalTexture'), 'occlusion': mat.get('occlusionTexture')}
        for slot, ref in slots.items():
            if not ref: continue
            img = g['images'][g['textures'][ref['index']]['source']]
            if 'bufferView' in img:
                bv = g['bufferViews'][img['bufferView']]
                blob = binr[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']]
                texes.setdefault(mi, {})[slot] = blob
    return prims, texes, g


def info(path):
    import numpy as np
    prims, texes, g = read_glb(path)
    tris = sum((len(p['idx']) // 3 if p['idx'] is not None else len(p['pos']) // 3) for p in prims)
    pos = np.concatenate([p['pos'] for p in prims])
    lo, hi = pos.min(0), pos.max(0)
    print(f'{os.path.basename(path)}: {len(prims)} primitive(s), {len(pos)} verts, {tris} tris')
    print(f'  bbox min {lo.round(3).tolist()} max {hi.round(3).tolist()} size {(hi-lo).round(3).tolist()}')
    for mi, slots in texes.items():
        for slot, blob in slots.items():
            from PIL import Image; import io
            im = Image.open(io.BytesIO(blob))
            print(f'  material {mi} {slot}: {im.size[0]}x{im.size[1]} {im.format} {len(blob)//1024} KB')
    return prims, texes


# ---------------------------------------------------------------- pack for the web
def pack(path, name, length=5.4, rot_x=0.0, yaw=0.0, sizes=(1024, 512), quality=(86, 82)):
    """GLB -> models/<name>.json + .bin (quantised) + colour/normal/orm JPEGs at desktop and phone sizes."""
    import io
    import numpy as np
    from PIL import Image
    prims, texes, g = read_glb(path)
    os.makedirs(OUT, exist_ok=True)

    P, N, U, C, I, base = [], [], [], [], [], 0
    has_col = any(p.get('col') is not None for p in prims)
    for p in prims:
        n = len(p['pos'])
        idx = p['idx'] if p['idx'] is not None else np.arange(n, dtype='u4')
        P.append(p['pos']); I.append(idx + base)
        N.append(p['nrm'] if p['nrm'] is not None else np.zeros((n, 3), 'f4'))
        U.append(p['uv'] if p['uv'] is not None else np.zeros((n, 2), 'f4'))
        if has_col:
            c = p.get('col')
            C.append(np.ones((n, 3), 'f4') if c is None else c[:, :3])
        base += n
    pos, nrm, uv, idx = np.concatenate(P), np.concatenate(N), np.concatenate(U), np.concatenate(I)
    col = np.concatenate(C) if has_col else None

    rx, ry = np.radians(rot_x), np.radians(yaw)
    for ang, (a, b) in ((rx, (1, 2)), (ry, (0, 2))):   # X then Y, in that order
        if not ang: continue
        c, s = np.cos(ang), np.sin(ang)
        for arr in (pos, nrm):
            u_, v_ = arr[:, a].copy(), arr[:, b].copy()
            arr[:, a] = u_ * c - v_ * s; arr[:, b] = u_ * s + v_ * c

    lo, hi = pos.min(0), pos.max(0)
    scale = length / float((hi - lo).max())
    pos *= scale
    lo, hi = pos.min(0), pos.max(0)
    pos -= np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])   # centred on X/Z, resting on y=0
    lo, hi = pos.min(0), pos.max(0)

    span = np.maximum(hi - lo, 1e-6)
    qpos = np.clip(((pos - lo) / span * 65535.0).round(), 0, 65535).astype('<u2')
    ln = np.linalg.norm(nrm, axis=1, keepdims=True); ln[ln == 0] = 1
    qnrm = np.clip((nrm / ln * 127.0).round(), -127, 127).astype('<i1')
    quv = np.clip((uv % 1.0 * 65535.0).round(), 0, 65535).astype('<u2')
    qidx = idx.astype('<u4') if len(pos) > 65535 else idx.astype('<u2')

    if col is not None and col.max() > 1.5: col = col / 255.0   # some exporters hand back 0..255

    # Split the single generated mesh into shading groups so the scene can give each its own material:
    # the generator bakes one colour field over everything, so tyres, glass and chrome would otherwise
    # take the body's candy paint. Classified per triangle from its generated colour plus its height.
    groups = []
    if col is not None:
        tri = idx.reshape(-1, 3)
        c = col[tri].mean(axis=1)
        yv = pos[tri][:, :, 1].mean(axis=1)
        lum = c @ np.array([.2126, .7152, .0722], dtype='f4')
        mx, mn = c.max(1), c.min(1)
        sat = (mx - mn) / np.maximum(mx, 1e-5)
        h = float(pos[:, 1].max() - pos[:, 1].min())
        nrmv = nrm[tri].mean(axis=1)
        ny = np.abs(nrmv[:, 1]) / np.maximum(np.linalg.norm(nrmv, axis=1), 1e-5)
        xa = np.abs(pos[tri][:, :, 0].mean(axis=1))
        halfw = float(np.abs(pos[:, 0]).max())
        gid = np.zeros(len(tri), dtype='i4')                       # 0 paint
        za = np.abs(pos[tri][:, :, 2].mean(axis=1))
        halfl = float(np.abs(pos[:, 2]).max())
        bright = lum > .30
        # only call it chrome where chrome actually lives - bumper/grille ends and wheel-level whitewalls.
        # The generator bakes specular highlights into the colour, so "bright" alone speckles the flanks.
        gid[bright & ((za > .78 * halfl) | (yv < .34 * h))] = 2
        gid[~bright & (yv < .34 * h) & (xa > .50 * halfw)] = 1      # 1 tyre: dark, low, outboard
        gid[~bright & (yv > .58 * h) & (ny < .70)] = 3              # 3 glass: dark, high, steeply angled (roof stays paint)
        order = np.argsort(gid, kind='stable')
        tri = tri[order]; gid = gid[order]
        idx = tri.reshape(-1)
        for g_i, nm in enumerate(('paint', 'tyre', 'chrome', 'glass')):
            n_t = int((gid == g_i).sum())
            if n_t: groups.append({'name': nm, 'start': int((gid < g_i).sum()) * 3, 'count': n_t * 3})
        qidx = idx.astype('<u4') if len(pos) > 65535 else idx.astype('<u2')

    parts = [qpos, qnrm, quv]
    if col is not None:
        parts.append(np.clip(col * 255.0, 0, 255).round().astype('u1'))
    blob = b''.join(a.tobytes() for a in parts)
    blob += b'\0' * (-len(blob) % 4)                     # js/model.js views the index block as Uint16/Uint32
    blob += qidx.tobytes()
    open(os.path.join(OUT, name + '.bin'), 'wb').write(blob)

    written = {}
    for mi, slots in texes.items():
        for slot, data in slots.items():
            if slot == 'occlusion' and 'orm' in slots: continue   # three.js reads AO from the ORM red channel
            im = Image.open(io.BytesIO(data)).convert('RGB')
            for sz, q, suffix in ((sizes[0], quality[0], ''), (sizes[1], quality[1], '.m')):
                f = f'{name}-{slot}{suffix}.jpg'
                im.resize((sz, sz), Image.LANCZOS).save(os.path.join(OUT, f), 'JPEG', quality=q, optimize=True, progressive=True)
                written.setdefault(slot, []).append(f)
    meta = {'v': 1, 'name': name, 'verts': int(len(pos)), 'tris': int(len(idx) // 3),
            'lo': [round(float(x), 5) for x in lo], 'hi': [round(float(x), 5) for x in hi],
            'idx': 32 if qidx.dtype == np.dtype('<u4') else 16, 'vcol': col is not None, 'groups': groups,
            'maps': {k: v[0] for k, v in written.items()}, 'size': [sizes[0], sizes[1]]}
    open(os.path.join(OUT, name + '.json'), 'w').write(json.dumps(meta, indent=1))
    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT) if f.startswith(name))
    print(f'{name}: {meta["tris"]} tris, {meta["verts"]} verts, vertex-colours={col is not None}, maps {list(written)}')
    for g in groups: print(f'  group {g["name"]:7} {g["count"]//3:6} tris')
    print(f'  bbox {np.round(lo,3).tolist()} .. {np.round(hi,3).tolist()}  (length {length} m on its longest axis)')
    print(f'  models/{name}.bin {len(blob)//1024} KB, {total//1024} KB total for both tiers')


if __name__ == '__main__':
    a = sys.argv[1:]
    def opt(flag, cast=float, dflt=None):
        return cast(a[a.index(flag) + 1]) if flag in a else dflt
    cmd = a[0] if a else 'help'
    pos = [x for i, x in enumerate(a) if not x.startswith('--') and (i == 0 or not a[i - 1].startswith('--'))]
    if cmd == 'refs': refs(only=pos[1:] or None)
    elif cmd == 'model': model(pos[1], seed=int(opt('--seed', float, 42)), faces=int(opt('--faces', float, 60000)), tex=int(opt('--tex', float, 2048)), uv='--uv' in a)
    elif cmd == 'info': info(pos[1])
    elif cmd == 'pack': pack(pos[1], pos[2], length=opt('--len', float, 5.4), rot_x=opt('--rot-x', float, 0.0), yaw=opt('--yaw', float, 0.0))
    else: print(__doc__)
