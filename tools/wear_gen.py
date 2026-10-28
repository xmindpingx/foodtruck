#!/usr/bin/env python3
"""wear_gen.py — generate 3D wearables on the owner's ComfyUI and wire them into bling/catalog.json.

  python3 tools/wear_gen.py list                 items + whether each is generated yet
  python3 tools/wear_gen.py gen [id ...]         FLUX flat-lit reference -> Hunyuan3D-2 mv-turbo (single view) ->
                                                 decimate -> models/wear/<id>.{json,bin}; skips finished items
  python3 tools/wear_gen.py catalog              (re)write the wear-* rows in bling/catalog.json from ITEMS

Pilot findings (see ROADMAP): ~50 s per item warm, 1500 tris is visually identical to 6000 at wearing distance,
generated meshes carry NO colour/UVs so each item is shaded by its `mat` (js/wear.js MATS). Resumable: raw
references and GLBs stay in tools/model_raw/wear/ (gitignored); only models/wear/ is served.
Fields: slot = socket (js/wear.js SLOTS), len = longest side in metres, fit/dy/dz = per-item placement tweaks.
"""
import json, os, shutil, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model_gen as M

RAW = os.path.join(M.RAW, 'wear')
CKPT = 'hunyuan3d-dit-v2-mv-turbo_fp16.safetensors'
FLAT = ('plain seamless pure white background, completely flat even diffuse studio lighting with no specular highlights, '
        'no reflections, no glare and no cast shadow, sharp focus, the whole object visible and centred with generous margin, '
        'isolated object only, no person, no mannequin, no head, no face, no hands, no text, no logos, no watermark')
# id: (label, slot, len m, mat, cost, theme, prompt)   -- starter set; the rest is the ROADMAP "wearables" to-do
ITEMS = {
 'wear-fedora':   ('🎩 Felt-ing Good Fedora', 'hat', .33, 'felt', 90, '', 'a charcoal grey felt fedora hat with a black ribbon band, three-quarter view from slightly above'),
 'wear-shades':   ('🕶️ Shade Tree Shades', 'glasses', .14, 'black', 70, '', 'a pair of classic black wayfarer sunglasses, front three-quarter view'),
 'wear-oxfords':  ('👞 Sole Mates Oxfords', 'shoes', .29, 'black', 150, '', 'a single polished black patent leather oxford dress shoe with laces, side view'),
 'wear-cowboy-boots': ('🤠 Boot Scootin\' Boots', 'shoes', .32, 'leather', 160, '', 'a single tooled brown leather cowboy boot with a pointed toe, side view'),
 'wear-backpack': ('🎒 Pack Rat-ionalist Pack', 'back', .42, 'cloth', 120, '', 'a canvas day backpack with two straps and a front pocket, three-quarter view'),
 'wear-bowtie':   ('🎀 Tie-riffic Bow Tie', 'collar', .10, 'cloth', 60, '', 'a classic bow tie, front view'),
 'wear-cane':     ('🦯 Cane Do Attitude', 'handR', .92, 'wood', 110, '', 'a polished wooden walking cane with a curved handle, full length view'),
 'wear-top-hat':  ('🎩 Top Notch Top Hat', 'hat', .31, 'black', 140, '', 'a tall black silk top hat with a thin band, three-quarter view'),
}

def gen(ids):
    os.makedirs(RAW, exist_ok=True); M.wake()
    for i in ids:
        label, slot, ln, mat, cost, theme, prompt = ITEMS[i]
        if os.path.exists(os.path.join(M.OUT, 'wear', i + '.json')): print('have', i); continue
        png = f'{RAW}/{i}.png'
        if not os.path.exists(png):
            for node in M.run(M.flux_graph(f'{prompt}. {FLAT}', 1024, 1024, seed=abs(hash(i)) % 100000), wait=900, label='ref ' + i).values():
                for im in node.get('images', []): open(png, 'wb').write(M.fetch_image(im)); break
        name = f'eol_{i}.png'; shutil.copy(png, os.path.join(M.COMFY_HOME, 'input', name))
        g = {'1': {'class_type': 'ImageOnlyCheckpointLoader', 'inputs': {'ckpt_name': CKPT}},
             '20': {'class_type': 'LoadImage', 'inputs': {'image': name}},
             '21': {'class_type': 'CLIPVisionEncode', 'inputs': {'clip_vision': ['1', 1], 'image': ['20', 0], 'crop': 'none'}},
             '4': {'class_type': 'Hunyuan3Dv2Conditioning', 'inputs': {'clip_vision_output': ['21', 0]}},
             '5': {'class_type': 'EmptyLatentHunyuan3Dv2', 'inputs': {'resolution': 3072, 'batch_size': 1}},
             '6': {'class_type': 'ModelSamplingAuraFlow', 'inputs': {'model': ['1', 0], 'shift': 1.0}},
             '7': {'class_type': 'KSampler', 'inputs': {'model': ['6', 0], 'positive': ['4', 0], 'negative': ['4', 1], 'latent_image': ['5', 0], 'seed': 42, 'steps': 5, 'cfg': 5.0, 'sampler_name': 'euler', 'scheduler': 'normal', 'denoise': 1.0}},
             '8': {'class_type': 'VAEDecodeHunyuan3D', 'inputs': {'samples': ['7', 0], 'vae': ['1', 2], 'num_chunks': 8000, 'octree_resolution': 256}},
             '9': {'class_type': 'VoxelToMeshBasic', 'inputs': {'voxel': ['8', 0], 'threshold': 0.6}},
             '10': {'class_type': 'DecimateMesh', 'inputs': {'mesh': ['9', 0], 'target_face_count': 1500, 'placement_mode': 'midpoint'}},
             '11': {'class_type': 'MeshSmoothNormals', 'inputs': {'mesh': ['10', 0], 'crease_angle': 60.0}},
             '12': {'class_type': 'SaveGLB', 'inputs': {'mesh': ['11', 0], 'filename_prefix': '3d/eol_' + i}}}
        M.run(g, wait=2400, label='mesh ' + i)
        out = os.path.join(M.COMFY_HOME, 'output', '3d')
        glb = sorted((os.path.join(out, f) for f in os.listdir(out) if f.startswith('eol_' + i) and f.endswith('.glb')), key=os.path.getmtime)[-1]
        shutil.copy(glb, f'{RAW}/{i}.glb')
        M.pack(f'{RAW}/{i}.glb', 'wear/' + i, length=ln, single=True)

# per-item placement tweaks merged into the catalog row (js/wear.js FIT has the per-slot defaults): fit = scale,
# dy/dz = metres from the socket, ry = yaw degrees. Set after looking at the item on an avatar.
PLACE = {'wear-cane': {'dy': -.86}}

def catalog():
    p = os.path.join(M.ROOT, 'bling', 'catalog.json'); c = json.load(open(p))
    c['items'] = [r for r in c['items'] if not r['id'].startswith('wear-')]
    for i, (label, slot, ln, mat, cost, theme, _) in ITEMS.items():
        if os.path.exists(os.path.join(M.OUT, 'wear', i + '.json')):
            c['items'].append({'id': i, 'label': label, 'theme': theme, 'slot': slot, 'cost': cost, 'model': True, 'mat': mat, **PLACE.get(i, {})})
    json.dump(c, open(p, 'w'), indent=1, ensure_ascii=False); print(len([r for r in c['items'] if r['id'].startswith('wear-')]), 'wear rows in catalog')

if __name__ == '__main__':
    a = sys.argv[1:]; cmd = a[0] if a else 'help'
    if cmd == 'list': [print(('✔' if os.path.exists(os.path.join(M.OUT, 'wear', i + '.json')) else '·'), i) for i in ITEMS]
    elif cmd == 'gen': gen(a[1:] or list(ITEMS))
    elif cmd == 'catalog': catalog()
    else: print(__doc__)
