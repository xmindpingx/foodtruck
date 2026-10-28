#!/usr/bin/env python3
"""gfx_gen.py — photoreal surface textures for the 3D lot, rendered on the owner's ComfyUI.

  python3 tools/gfx_gen.py gen [name ...]     render missing raw images into tools/gfx_raw/ (ComfyUI, FLUX.2 klein)
  python3 tools/gfx_gen.py gen --redo grass   re-render one (keeps the old raw as <name>-old.png)
  python3 tools/gfx_gen.py build              raw -> gfx/<name>.jpg (desktop), <name>.m.jpg (phone), <name>.n.jpg (normal map)
  python3 tools/gfx_gen.py list               show the texture table

Options: --comfy http://127.0.0.1:8888 (socket-activated: the first request wakes it; this waits up to 4 min).
Raw renders live in tools/gfx_raw/ (gitignored, never served); only the built JPEGs are served (gfx/ is in server.py PUBLIC_DIRS).
js/gfx.js maps these names onto scene materials. Needs Pillow + numpy for `build` (dev tool, not the server).
"""
import json, os, sys, time, tempfile, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW, OUT = os.path.join(ROOT, 'tools', 'gfx_raw'), os.path.join(ROOT, 'gfx')   # raw renders stay outside the public gfx/ dir

SURF = ('shot straight down, soft even overcast daylight, no shadows, no objects, no horizon, uniform pattern from edge to edge, '
        'crisp macro detail, photorealistic surface texture')
FOOD = ('appetizing professional food photograph, warm golden light, shallow depth of field, dark rustic wooden background, '
        'centered, no text, no logos, no hands')
# name: (prompt, width, height, kind)   kind: seamless | seamx (planks: only left/right wrap) | tint (neutral fabric) | photo
TEX = {
    'grass': (f'Top-down photograph of a festival lawn: dense short green grass blades with a few clover leaves and specks of dry yellow straw, {SURF}', 1024, 1024, 'seamless'),
    'wood': ('Top-down photograph of a weathered outdoor picnic table top made of five horizontal light-brown cedar planks with natural wood grain, '
             'small knots and narrow dark gaps between the planks, planks run left to right across the whole image, soft even daylight, no shadows, '
             'no objects, photorealistic surface texture', 1024, 1024, 'seamx'),
    'canvas': (f'Close-up photograph of plain white heavy cotton canvas tent fabric with a visible woven thread texture and subtle soft wrinkles, {SURF}', 1024, 1024, 'tint'),
    'stone': (f'Top-down photograph of a beige travertine stone pool deck surface with fine pores, subtle cream and tan veining and a light sandy grain, no grout lines, {SURF}', 1024, 1024, 'seamless'),
    'sand': (f'Top-down photograph of fine golden beach sand with very subtle wind ripples and a few tiny shell fragments, no footprints, {SURF}', 1024, 1024, 'seamless'),
    'water': ('Top-down photograph looking straight down into a clear turquoise swimming pool, bright sunlight caustic light patterns on the light blue pool floor, '
              'gentle surface ripples, uniform pattern from edge to edge, no pool edges, no lane lines, no people, no objects, photorealistic', 1024, 1024, 'seamless'),
    'backdrop': ('Abstract concert LED screen visuals that fill the entire image edge to edge: a glowing warm sunset gradient from deep purple at the top '
                 'through magenta to orange at the bottom, soft out-of-focus bokeh light orbs and faint diagonal light beams, no screen frame, no stage, '
                 'no people, no silhouettes, no text, no logos, photorealistic', 1024, 512, 'photo'),
    'signboard': ('Front view photograph of a blank weathered wooden sign board made of cream-painted horizontal planks with a hand-painted dark red border '
                  'and slightly chipped paint, the board fills the entire frame edge to edge, flat even lighting, no text, no letters, no logos, photorealistic', 1024, 320, 'photo'),
    # --- '64 lowrider: the maps that carry the realism (wire wheels and candy flake can't be modelled cheaply)
    'car-paint': ('Extreme macro photograph of a flawless candy purple metalflake car paint surface, deep violet base with fine silver '
                  'metal flakes sparkling under a glossy clear coat, perfectly flat panel, ' + SURF, 1024, 1024, 'seamless'),
    'car-wheel': ('Straight-on front view photograph of a chrome wire-spoke car wheel, 72 thin polished chrome spokes radiating from a '
                  'chrome knock-off hub to a chrome rim, surrounded by a thin white wall tire, the wheel perfectly centred and circular '
                  'and filling the frame, shot square to the camera, studio lighting, isolated on a pure solid flat black background, '
                  'photorealistic, no text, no logos', 512, 512, 'photo'),
    'car-tire': ('Extreme macro photograph of a black rubber car tire sidewall and tread, fine rubber grain and shallow tread grooves '
                 'running left to right, matte black, ' + SURF, 512, 512, 'seamx'),
    'car-grille': ('Extreme close-up macro photograph cropped tight on the chrome grille mesh of a 1960s American car: '
                   'rows of fine polished horizontal chrome bars with dark gaps between them, filling the entire frame edge to edge '
                   'with no border, no body panels, no headlights, no background, flat even studio lighting, photorealistic, '
                   'no text, no logos', 1024, 512, 'photo'),
    'car-seat': ('Extreme macro photograph of tan tuck-and-roll pleated leather car upholstery, evenly spaced vertical padded rolls with '
                 'stitched seams, soft leather grain, ' + SURF, 512, 512, 'seamless'),
    'food-wok': (f'Lo mein noodles with colorful stir-fried vegetables in an open white takeout box with wooden chopsticks, {FOOD}', 512, 512, 'photo'),
    'food-pita': (f'A stuffed gyro pita wrap with sliced roast meat, tomato, red onion and creamy tzatziki in a paper wrap, {FOOD}', 512, 512, 'photo'),
    'food-fry': (f'Golden crispy french fries spilling from a red and white striped paper cone next to a small cup of ketchup, {FOOD}', 512, 512, 'photo'),
    'food-brew': (f'A tall glass of iced coffee and a mason jar of pink lemonade with ice cubes and lemon slices, cold condensation droplets, {FOOD}', 512, 512, 'photo'),
    'food-sundae': (f'An ice cream sundae in a tall glass with three scoops, hot fudge, whipped cream, rainbow sprinkles and a cherry on top, {FOOD}', 512, 512, 'photo'),
    'food-pretzel': (f'A giant golden soft pretzel sprinkled with coarse salt next to a small cup of warm cheese dip on parchment paper, {FOOD}', 512, 512, 'photo'),
}
NORMALS = ('grass', 'stone', 'sand', 'wood', 'canvas', 'car-paint', 'car-tire', 'car-seat')
CROP = {'signboard': .015}   # trim a thin white margin some renders leave around the subject   # desktop-only tangent-space normal maps derived from luminance


def _client():
    sys.path.insert(0, os.path.join(ROOT, 'tools'))
    import model_gen
    return model_gen


def gen(names, url, redo=False):
    os.makedirs(RAW, exist_ok=True)
    M = _client(); M.COMFY = url
    M.wake()
    todo = [n for n in (names or TEX) if n in TEX]
    for n in todo:
        dst = os.path.join(RAW, n + '.png')
        if os.path.exists(dst):
            if not redo: continue
            os.replace(dst, os.path.join(RAW, n + '-old.png'))
        prompt, w, h, _ = TEX[n]
        t = time.time()
        for attempt in (1, 2):
            try:
                outs = M.run(M.flux_graph(prompt, w, h, seed=1234 + attempt * 31 + (hash(n) & 0xffff)), label=n)
                for node in outs.values():
                    for im in node.get('images', []):
                        png = M.fetch_image(im); open(dst, 'wb').write(png)
                        print(f'{n}: ok {len(png)//1024} KB {time.time()-t:.0f}s', flush=True); break
                if os.path.exists(dst): break
            except Exception as e:
                print(f'{n}: attempt {attempt} failed: {e}', flush=True); M.wake(120)
    print('DONE', flush=True)


# ---------------------------------------------------------------- build (Pillow + numpy)
def build(names):
    import numpy as np
    from PIL import Image, ImageFilter
    os.makedirs(OUT, exist_ok=True)

    def band_mask(n, band=.22):   # 1 in the middle, smoothstep to 0 within `band` of either edge
        d = np.minimum(np.arange(n), n - 1 - np.arange(n)) / (n * band)
        d = np.clip(d, 0, 1); return d * d * (3 - 2 * d)

    def seam_x(a):   # blend the image with itself rolled half-way so the left/right edges wrap seamlessly
        m = band_mask(a.shape[1])[None, :, None]
        return a * m + np.roll(a, a.shape[1] // 2, axis=1) * (1 - m)

    def seam_y(a):
        m = band_mask(a.shape[0])[:, None, None]
        return a * m + np.roll(a, a.shape[0] // 2, axis=0) * (1 - m)

    def even_light(a, sigma):   # flatten large-scale lighting gradients (keeps tiling from showing bright/dark patches)
        im = Image.fromarray(np.clip(a, 0, 255).astype('uint8'))
        low = np.asarray(im.filter(ImageFilter.GaussianBlur(sigma)), dtype=np.float32)
        return a - low + low.mean(axis=(0, 1), keepdims=True)

    def normal_map(a, strength=2.2):   # luminance as height -> tangent-space normal (wrap-around gradients so it tiles)
        h = (a[..., 0] * .299 + a[..., 1] * .587 + a[..., 2] * .114) / 255.0
        h = np.asarray(Image.fromarray((h * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(1.2)), dtype=np.float32) / 255.0
        dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
        dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
        nz = 1.0 / np.sqrt(dx * dx + dy * dy + 1.0)
        n = np.stack([-dx * nz, dy * nz, nz], -1)   # OpenGL convention (+Y up), what three.js expects
        return ((n * .5 + .5) * 255).astype('uint8')

    def save(arr, path, q=84):
        Image.fromarray(np.clip(arr, 0, 255).astype('uint8')).save(path, 'JPEG', quality=q, optimize=True, progressive=True)

    for n in (names or TEX):
        src = os.path.join(RAW, n + '.png')
        if n not in TEX or not os.path.exists(src): print(f'{n}: no raw render, skipped'); continue
        _, w, h, kind = TEX[n]
        im = Image.open(src).convert('RGB')
        if n in CROP: c = CROP[n]; im = im.crop((round(im.width * c), round(im.height * c), round(im.width * (1 - c)), round(im.height * (1 - c))))
        a = np.asarray(im.resize((w, h), Image.LANCZOS), dtype=np.float32)
        if kind in ('seamless', 'seamx', 'tint'): a = even_light(a, max(w, h) / 6)
        if kind in ('seamless', 'tint'): a = seam_y(seam_x(a))
        elif kind == 'seamx': a = seam_x(a)
        if kind == 'tint':   # neutral near-white weave so material.color tints it (canopies, umbrellas)
            g = a.mean(axis=2, keepdims=True); g = (g - g.mean()) * .55 + 222; a = np.repeat(g, 3, axis=2)
        full = os.path.join(OUT, n + '.jpg'); save(a, full)
        small = Image.open(full).resize((max(64, w // 2), max(32, h // 2)), Image.LANCZOS)
        small.save(os.path.join(OUT, n + '.m.jpg'), 'JPEG', quality=82, optimize=True, progressive=True)
        if n in NORMALS: save(normal_map(a, 3.0 if n in ('canvas', 'wood') else 2.2), os.path.join(OUT, n + '.n.jpg'), q=88)
        print(f'{n}: built {w}x{h} ({kind})' + (' + normal' if n in NORMALS else ''))


if __name__ == '__main__':
    args = sys.argv[1:]
    url = 'http://127.0.0.1:8888'
    if '--comfy' in args: i = args.index('--comfy'); url = args[i + 1]; del args[i:i + 2]
    redo = '--redo' in args; args = [a for a in args if a != '--redo']
    cmd, names = (args[0] if args else 'list'), args[1:]
    if cmd == 'gen': gen(names, url, redo)
    elif cmd == 'build': build(names)
    else:
        for k, (p, w, h, kind) in TEX.items(): print(f'{k:13} {w}x{h} {kind:8} {p[:90]}…')
