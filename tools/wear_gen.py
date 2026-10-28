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
 # --- pride + music festival wearables ---
 'wear-pride-pin':     ('🏳️‍🌈 Pride & Joy Pin', 'chest', .06, 'gold', 80, '', 'a round enamel pin with a rainbow heart emblem, front view'),
 'wear-festival-band': ('🎟️ All-Access Band', 'handR', .12, 'neon', 60, '', 'a fabric festival wristband with a plastic clasp, front view'),
 'wear-bucket-hat':    ('🪣 Bucket List Bucket', 'hat', .30, 'straw', 90, '', 'a canvas bucket hat, three-quarter view from above'),
 'wear-flower-crown':  ('🌸 Petal Pusher Crown', 'hat', .32, 'straw', 100, '', 'a flower crown with small mixed blossoms, top view'),
 'wear-fanny-pack':    ('🎒 Hands-Free Hype Pack', 'waist', .28, 'cloth', 110, '', 'a small fanny pack with a buckle and zipper, front view'),
 'wear-glow-sticks':   ('💚 Glow Getter Sticks', 'handL', .25, 'neon', 70, '', 'a pair of glowing neon glow sticks, front view'),
 'wear-neon-visor':    ('🕶️ Rave Wave Visor', 'glasses', .16, 'glass', 90, '', 'a neon-tinted futuristic visor, front view'),
 'wear-headphones':    ('🎧 Drop the Beat Headphones', 'ears', .18, 'black', 120, '', 'a pair of over-ear headphones, front view'),
 'wear-peace-pendant': ('✌️ Peace Out Pendant', 'chest', .08, 'gold', 80, '', 'a peace sign pendant on a chain, front view'),
 'wear-pride-sash':    ('🌈 Pride Stride Sash', 'chest', .40, 'neon', 100, '', 'a diagonal sash with a rainbow stripe, front view'),
 # --- cannabis (adults only) ---
 'wear-leaf-pin':       ('🍃 Leaf Life Pin', 'chest', .06, 'lime', 80, '', 'a round enamel pin with a cannabis leaf emblem, front view'),
 'wear-hemp-bracelet':  ('🌿 Hemp Circle Bracelet', 'handR', .12, 'straw', 70, '', 'a braided hemp bracelet, front view'),
 'wear-rasta-beanie':   ('🧢 Rasta Beanie', 'hat', .28, 'cloth', 90, '', 'a knit rasta beanie with a folded brim, three-quarter view'),
 'wear-leaf-bandana':   ('🧣 Leafy Bandana', 'hat', .25, 'cloth', 70, '', 'a bandana with a subtle leaf print, folded, front view'),
 'wear-420-shades':     ('🕶️ 420 Shades', 'glasses', .14, 'black', 80, '', 'a pair of dark sunglasses with a small leaf emblem, front view'),
 'wear-leaf-pendant':   ('🍃 Leaf Pendant', 'chest', .07, 'gold', 90, '', 'a cannabis leaf pendant on a chain, front view'),
 'wear-high-buckle':    ('🔗 High Roller Buckle', 'waist', .12, 'gold', 100, '', 'a large belt buckle with a leaf emblem, front view'),
 'wear-hemp-sneakers':  ('👟 Hemp Hi-Tops', 'shoes', .29, 'cloth', 130, '', 'a single canvas hemp high-top sneaker, side view'),
 'wear-hemp-sack':      ('🎒 Hemp Sack Pack', 'back', .40, 'cloth', 120, '', 'a hemp drawstring sack backpack, three-quarter view'),
 'wear-bong-pin':       ('💨 Bong Voyage Pin', 'chest', .06, 'silver', 80, '', 'a small novelty pin shaped like a glass bong, front view'),
 # --- rave ---
 'wear-rave-goggles':   ('🥽 Rave Riot Goggles', 'glasses', .16, 'glass', 100, '', 'a pair of futuristic rave goggles, front view'),
 'wear-neon-cuffs':     ('💡 Neon Cuffs', 'handL', .10, 'neon', 70, '', 'a pair of glowing neon wrist cuffs, front view'),
 'wear-led-choker':     ('✨ LED Choker', 'collar', .10, 'neon', 90, '', 'a glowing LED choker necklace, front view'),
 'wear-platform-boots': ('👢 Platform Stompers', 'shoes', .32, 'black', 150, '', 'a single black platform rave boot, side view'),
 'wear-neon-fanny':     ('🎒 Neon Utility Pack', 'waist', .26, 'neon', 110, '', 'a small neon fanny pack with buckles, front view'),
 'wear-laser-visor':    ('🕶️ Laser Visor', 'glasses', .16, 'glass', 90, '', 'a neon laser-cut visor, front view'),
 'wear-glow-band':      ('💚 Glow Band', 'handR', .10, 'lime', 60, '', 'a glowing lime wristband, front view'),
 'wear-rave-mesh':      ('🕸️ Rave Mesh Top', 'chest', .35, 'neon', 100, '', 'a mesh rave top, front view'),
 'wear-ear-cuffs':      ('💎 Ear Cuff Bling', 'ears', .06, 'silver', 80, '', 'a pair of silver ear cuffs, front view'),
 'wear-holo-pack':      ('🎒 Holo Pack', 'back', .42, 'chrome', 130, '', 'a holographic backpack, three-quarter view'),
 # --- hippie ---
 'wear-groovy-bandana': ('🧣 Groovy Bandana', 'hat', .25, 'cloth', 70, '', 'a tie-dye bandana, folded, front view'),
 'wear-flower-power':   ('🌼 Flower Power Crown', 'hat', .32, 'straw', 100, '', 'a flower crown with daisies, top view'),
 'wear-round-shades':   ('🕶️ Round Trip Shades', 'glasses', .14, 'black', 80, '', 'a pair of round retro sunglasses, front view'),
 'wear-moc-toes':       ('🧦 Moc Toe Mocs', 'shoes', .28, 'leather', 120, '', 'a single suede moccasin shoe, side view'),
 'wear-fringe-vest':    ('🦌 Fringe Benefits Vest', 'chest', .35, 'leather', 130, '', 'a suede fringe vest, front view'),
 'wear-peace-drops':    ('✌️ Peace Drop Earrings', 'ears', .06, 'gold', 70, '', 'a pair of peace sign drop earrings, front view'),
 'wear-bead-necklace':  ('📿 Bead It Necklace', 'collar', .12, 'wood', 80, '', 'a beaded necklace with wooden beads, front view'),
 'wear-hope-headband':  ('🌸 Headband of Hope', 'hat', .28, 'cloth', 70, '', 'a fabric headband with a flower, front view'),
 'wear-free-satchel':   ('🎒 Free Spirit Satchel', 'back', .38, 'leather', 120, '', 'a leather satchel with a long strap, three-quarter view'),
 'wear-sole-sandals':   ('🩴 Sole Searching Sandals', 'shoes', .27, 'leather', 100, '', 'a single leather sandal, side view'),
 # --- wings + themed backpacks (back slot) ---
 'wear-wings':          ('🪽 Angel Wings', 'back', .5, 'feather', 200, '', 'a pair of white feathered angel wings, spread, back view'),
 'wear-hippie-pack':    ('🎒 Groovy Rucksack', 'back', .4, 'cloth', 110, '', 'a canvas rucksack with peace patches, three-quarter view'),
 'wear-biker-pack':     ('🎒 Road Warrior Pack', 'back', .42, 'leather', 130, '', 'a black leather motorcycle backpack with straps, three-quarter view'),
 'wear-teen-pack':      ('🎒 Teen Spirit Pack', 'back', .38, 'cloth', 90, '', 'a small school backpack with pins and patches, three-quarter view'),
 # --- interaction props + dance wearables (queued) ---
 'wear-jump-rope':     ('🪢 Jump to Conclusions Rope', 'handR', .60, 'cloth', 80, '', 'a jump rope with wooden handles, coiled, front view'),
 'wear-tap-shoes':     ('👟 Tap-tastic Shoes', 'shoes', .29, 'black', 120, '', 'a single black tap shoe with metal taps, side view'),
 'wear-tutu':          ('🩰 Tutu Much Tutu', 'waist', .40, 'cloth', 110, '', 'a pink tulle tutu skirt, front view'),
 'wear-salsa-shoes':   ('💃 Salsa Soul Shoes', 'shoes', .29, 'red', 120, '', 'a single red heeled salsa dance shoe, side view'),
 'wear-dance-ribbon':  ('🎀 Ribbon Dancer', 'handL', .45, 'neon', 70, '', 'a flowing dance ribbon on a stick, front view'),
 'wear-steampunk-goggles': ('🥽 Steamy Goggles', 'glasses', .16, 'brass', 100, '', 'a pair of brass steampunk goggles with leather straps, front view'),
 'wear-steampunk-vest':   ('🦺 Steam Vest', 'chest', .35, 'leather', 130, '', 'a brown leather steampunk vest with brass buttons, front view'),
 'wear-halloween-witch-hat': ('🧙 Witch Way Hat', 'hat', .32, 'black', 100, '', 'a black witch hat with a purple band, three-quarter view'),
 'wear-halloween-cape':      ('🧛 Caped Crusader Cape', 'back', .45, 'cloth', 130, '', 'a black vampire cape with a red lining, spread, back view'),
 'wear-christmas-elf-hat':   ('🧝 Elf Help Hat', 'hat', .30, 'cloth', 90, '', 'a green and red elf hat with a bell, three-quarter view'),
 'wear-christmas-scarf':     ('🧣 Wrap Star Scarf', 'collar', .35, 'cloth', 80, '', 'a red and green striped winter scarf, front view'),
 'wear-summer-shades':       ('😎 Sun Out Shades', 'glasses', .14, 'black', 80, '', 'a pair of oversized summer sunglasses, front view'),
 'wear-summer-flipflops':    ('🩴 Flip Flop Flop', 'shoes', .27, 'rubber', 60, '', 'a single pair of rubber flip flops, side view'),
 # --- icon Halloween outfits (queued; apply to AI crowd during halloween theme) ---
 'wear-witch-hat':       ('🧙 Witch Way Hat', 'hat', .32, 'black', 100, 'halloween', 'a black witch hat with a purple band, three-quarter view'),
 'wear-vampire-cape':    ('🧛 Caped Crusader Cape', 'back', .45, 'cloth', 130, 'halloween', 'a black vampire cape with a red lining, spread, back view'),
 'wear-pumpkin-head':    ('🎃 Pumpkin Head', 'hat', .30, 'orange', 120, 'halloween', 'a carved jack-o-lantern pumpkin mask, front view'),
 'wear-skeleton-gloves': ('💀 Bone Zone Gloves', 'handL', .12, 'bone', 80, 'halloween', 'a pair of white skeleton hand gloves, front view'),
 'wear-ghost-sheet':     ('👻 Boo Crew Sheet', 'back', .50, 'cloth', 110, 'halloween', 'a white ghost sheet costume with eye holes, back view'),
 'wear-mummy-wrap':      ('🧻 Wrap Star Mummy', 'chest', .35, 'cloth', 90, 'halloween', 'mummy bandage wraps around the torso, front view'),
 'wear-devil-horns':     ('😈 Horns of Plenty', 'hat', .12, 'red', 90, 'halloween', 'a pair of red devil horns on a headband, front view'),
 'wear-zombie-mask':     ('🧟 Zombie Zone Mask', 'face', .18, 'green', 100, 'halloween', 'a green zombie mask with decayed features, front view'),
 'wear-spider-cape':     ('🕷️ Web Slinger Cape', 'back', .40, 'black', 120, 'halloween', 'a black cape with a spider web pattern, spread, back view'),
 'wear-bat-wings':       ('🦇 Bat Wing Bling', 'back', .45, 'black', 140, 'halloween', 'a pair of black bat wings, spread, back view'),
}

def gen(ids):
    fast = os.environ.get('WEAR_FAST') == '1'
    ref_size = 768 if fast else 1024
    res = 2048 if fast else 3072
    steps = 4 if fast else 5
    tris = 1000 if fast else 1500
    wait_ref = 600 if fast else 900
    wait_mesh = 1200 if fast else 2400
    os.makedirs(RAW, exist_ok=True); M.wake()
    for i in ids:
        label, slot, ln, mat, cost, theme, prompt = ITEMS[i]
        if os.path.exists(os.path.join(M.OUT, 'wear', i + '.json')): print('have', i); continue
        png = f'{RAW}/{i}.png'
        if not os.path.exists(png):
            for node in M.run(M.flux_graph(f'{prompt}. {FLAT}', ref_size, ref_size, seed=abs(hash(i)) % 100000), wait=wait_ref, label='ref ' + i).values():
                for im in node.get('images', []): open(png, 'wb').write(M.fetch_image(im)); break
        name = f'eol_{i}.png'; shutil.copy(png, os.path.join(M.COMFY_HOME, 'input', name))
        g = {'1': {'class_type': 'ImageOnlyCheckpointLoader', 'inputs': {'ckpt_name': CKPT}},
             '20': {'class_type': 'LoadImage', 'inputs': {'image': name}},
             '21': {'class_type': 'CLIPVisionEncode', 'inputs': {'clip_vision': ['1', 1], 'image': ['20', 0], 'crop': 'none'}},
             '4': {'class_type': 'Hunyuan3Dv2Conditioning', 'inputs': {'clip_vision_output': ['21', 0]}},
             '5': {'class_type': 'EmptyLatentHunyuan3Dv2', 'inputs': {'resolution': res, 'batch_size': 1}},
             '6': {'class_type': 'ModelSamplingAuraFlow', 'inputs': {'model': ['1', 0], 'shift': 1.0}},
             '7': {'class_type': 'KSampler', 'inputs': {'model': ['6', 0], 'positive': ['4', 0], 'negative': ['4', 1], 'latent_image': ['5', 0], 'seed': 42, 'steps': steps, 'cfg': 5.0, 'sampler_name': 'euler', 'scheduler': 'normal', 'denoise': 1.0}},
             '8': {'class_type': 'VAEDecodeHunyuan3D', 'inputs': {'samples': ['7', 0], 'vae': ['1', 2], 'num_chunks': 8000, 'octree_resolution': 256}},
             '9': {'class_type': 'VoxelToMeshBasic', 'inputs': {'voxel': ['8', 0], 'threshold': 0.6}},
             '10': {'class_type': 'DecimateMesh', 'inputs': {'mesh': ['9', 0], 'target_face_count': tris, 'placement_mode': 'midpoint'}},
             '11': {'class_type': 'MeshSmoothNormals', 'inputs': {'mesh': ['10', 0], 'crease_angle': 60.0}},
             '12': {'class_type': 'SaveGLB', 'inputs': {'mesh': ['11', 0], 'filename_prefix': '3d/eol_' + i}}}
        M.run(g, wait=wait_mesh, label='mesh ' + i)
        out = os.path.join(M.COMFY_HOME, 'output', '3d')
        glb = sorted((os.path.join(out, f) for f in os.listdir(out) if f.startswith('eol_' + i) and f.endswith('.glb')), key=os.path.getmtime)[-1]
        shutil.copy(glb, f'{RAW}/{i}.glb')
        M.pack(f'{RAW}/{i}.glb', 'wear/' + i, length=ln, single=True)

# per-item placement tweaks merged into the catalog row (js/wear.js FIT has the per-slot defaults): fit = scale,
# dy/dz = metres from the socket, ry = yaw degrees. Set after looking at the item on an avatar.
PLACE = {'wear-cane': {'dy': -.86}, 'wear-wings': {'fit': 3, 'dy': -.1, 'dz': -.15}}

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
    elif cmd == 'gen':
        fast = '--fast' in a
        ids = [x for x in a[1:] if x != '--fast'] or list(ITEMS)
        if fast: os.environ['WEAR_FAST'] = '1'
        gen(ids)
    elif cmd == 'catalog': catalog()
    else: print(__doc__)
