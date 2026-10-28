// themes.js — the look of the lot. Steampunk is the everyday theme; each big holiday gets its own palette,
// string lights, falling confetti/leaves/snow and floating lanterns/balloons for the days around it
// (soonest first in time, first match wins). The truck is never re-skinned (see themefx.js).
// Choose by hand with /?theme=<id> | auto | classic (remembered in localStorage 'eol-scene-theme').
const mk = (hex, rough = .6, metal = 0) => [hex, rough, metal];

// fab = fabric/paint colours by hue bucket: [red, orange-yellow, green, teal-blue, purple-pink]
export const THEMES = {
  steampunk: {label: 'Steampunk', emoji: '⚙️', fog: 0x8a7a5a, tint: 0xe8c898, lamp: 0xffb347, decor: 'steam',
    m1: mk(0xb8893a, .32, .85), m2: mk(0xa8643a, .38, .85), dark: mk(0x2b2724, .48, .78), light: mk(0xd9c9a0, .82, 0), wood: mk(0x6a4428, .62, .05),
    fab: [0x7a2e2a, 0xb8893a, 0x5f7a4a, 0x2f4a63, 0x5a3550]},
  mexindep: {label: 'Mexican Independence', emoji: '🇲🇽', win: [9, 5, 9, 17], fog: 0xd8c8a0, tint: 0xffe8c8, lamp: 0xffd060,
    m1: mk(0x1f8a3a, .5), m2: mk(0xd02a2a, .5), dark: mk(0x241a14, .6), light: mk(0xfaf2e0, .8), wood: mk(0x6a4428, .65, .05), fab: [0xd02a2a, 0xf2c14e, 0x1f8a3a, 0x1f9aa8, 0xe8409a],
    string: [0x1f8a3a, 0xf8f8f0, 0xd02a2a], fall: {colors: [0x1f8a3a, 0xf8f8f0, 0xd02a2a], size: .16, speed: .9, sway: 1.2}, floats: {colors: [0x1f8a3a, 0xf8f8f0, 0xd02a2a], shape: 'sphere'}},
  halloween: {label: 'Halloween', emoji: '🎃', win: [10, 17, 10, 31], fog: 0x5a4468, tint: 0xb89ad0, lamp: 0xff7a1a,
    m1: mk(0xe8731a, .5, .1), m2: mk(0x6a2d8f, .5, .1), dark: mk(0x1a1420, .6, .2), light: mk(0xd8cfc0, .8), wood: mk(0x4a3020, .7, .05), fab: [0x8a1f1f, 0xe8731a, 0x3f7a2a, 0x4a3a7a, 0x6a2d8f],
    string: [0xff7a1a, 0x8a4de8, 0x7aff4a], fall: {colors: [0xe8731a, 0x8a3a1a, 0xf2a33c], size: .2, speed: .7, sway: 1.4}, floats: {colors: [0xff7a1a, 0xff9a3a], shape: 'lantern'}},
  muertos: {label: 'Día de los Muertos', emoji: '💀', win: [11, 1, 11, 3], fog: 0x6a4a6a, tint: 0xd8a8d0, lamp: 0xffa020,
    m1: mk(0xf29a1a, .5, .1), m2: mk(0xd0287a, .5, .1), dark: mk(0x241a30, .6, .2), light: mk(0xf2e6d0, .8), wood: mk(0x6a3a22, .65, .05), fab: [0xd0287a, 0xf29a1a, 0x2f9a6a, 0x1f9aa8, 0x8a3fb0],
    string: [0xf29a1a, 0xd0287a, 0x1f9aa8, 0x8a3fb0], fall: {colors: [0xf29a1a, 0xffc840, 0xff8a1a], size: .17, speed: .6, sway: 1.5}, floats: {colors: [0xf29a1a, 0xd0287a, 0x1f9aa8], shape: 'lantern'}},
  thanksgiving: {label: 'Thanksgiving', emoji: '🦃', win: [11, 15, 11, 27, 'thanksgiving'], fog: 0xb89868, tint: 0xf0c890, lamp: 0xffc060,
    m1: mk(0xc8742a, .55, .1), m2: mk(0x8a4a1f, .6, .05), dark: mk(0x2b1d14, .65), light: mk(0xe6d4b0, .8), wood: mk(0x6a4428, .62, .05), fab: [0x8a2a1f, 0xd8922a, 0x6a7a2a, 0x7a5a3a, 0x7a3a2a],
    string: [0xffc060, 0xe8731a, 0xb03a1a], fall: {colors: [0xb03a1a, 0xe8731a, 0xd8a02a, 0x8a5a1a], size: .22, speed: .8, sway: 1.6}, floats: {colors: [0xe8731a, 0xd8a02a], shape: 'lantern'}},
  christmas: {label: 'Christmas', emoji: '🎄', win: [12, 1, 12, 26], fog: 0xc8d8e8, tint: 0xd8e8ff, lamp: 0xfff0c0,
    m1: mk(0xc8aa4a, .35, .8), m2: mk(0xb02a2a, .45, .1), dark: mk(0x1a2a1e, .6), light: mk(0xf4f4f0, .8), wood: mk(0x5a3a22, .65, .05), fab: [0xb02a2a, 0xc8aa4a, 0x1f6a3a, 0x2a5a8a, 0x1f6a3a],
    string: [0xff3a3a, 0x3aff6a, 0xffd860, 0x6aa8ff, 0xffffff], fall: {colors: [0xffffff, 0xeaf2ff], size: .14, speed: .9, sway: .8}, floats: {colors: [0xc82a2a, 0x1f8a3a, 0xc8aa4a], shape: 'sphere'}},
  newyear: {label: "New Year's", emoji: '🎆', win: [12, 27, 1, 2], fog: 0x40405a, tint: 0xb8b8e0, lamp: 0xffe9a0,
    m1: mk(0xd4af37, .3, .85), m2: mk(0xc0c4cc, .3, .85), dark: mk(0x14141c, .5, .3), light: mk(0xf4f0e0, .8), wood: mk(0x3a2a24, .65), fab: [0x8a1f3a, 0xd4af37, 0x2a6a5a, 0x2a3a8a, 0x5a2a8a],
    string: [0xd4af37, 0xe8e8f0, 0xffffff, 0x6aa8ff], fall: {colors: [0xd4af37, 0xe8e8f0, 0xff6aa8, 0x6aa8ff], size: .15, speed: .8, sway: 1.8}, floats: {colors: [0xd4af37, 0xc0c4cc], shape: 'sphere'}},
  valentine: {label: "Valentine's Day", emoji: '💘', win: [2, 5, 2, 15], fog: 0xe8c0cc, tint: 0xffd8e4, lamp: 0xff8aa8,
    m1: mk(0xd8486a, .45, .1), m2: mk(0xf2a0b8, .5), dark: mk(0x3a1a2a, .6), light: mk(0xfbeaee, .8), wood: mk(0x6a3a3a, .65, .05), fab: [0xc0284a, 0xf2a0b8, 0xe8809a, 0x8a4a7a, 0xd860a0],
    string: [0xff5a8a, 0xff9ab8, 0xffffff, 0xc0284a], fall: {colors: [0xff5a8a, 0xff9ab8, 0xc0284a], size: .2, speed: .6, sway: 1.5}, floats: {colors: [0xc0284a, 0xff5a8a, 0xff9ab8], shape: 'sphere'}},
  stpatrick: {label: "St. Patrick's Day", emoji: '☘️', win: [3, 8, 3, 18], fog: 0xb8d8a8, tint: 0xd8ffd0, lamp: 0x9aff7a,
    m1: mk(0xd4af37, .35, .8), m2: mk(0x2e8b3d, .5), dark: mk(0x12281a, .6), light: mk(0xe8f0d8, .8), wood: mk(0x5a4028, .65, .05), fab: [0x1f7a3a, 0xd4af37, 0x2e8b3d, 0x1f8a6a, 0x4aa84a],
    string: [0x3aff6a, 0xd4af37, 0xffffff, 0xff9a3a], fall: {colors: [0x2e8b3d, 0x4aa84a, 0xd4af37], size: .16, speed: .8, sway: 1.3}, floats: {colors: [0x2e8b3d, 0xd4af37], shape: 'sphere'}},
  easter: {label: 'Easter', emoji: '🐣', win: [0, 0, 0, 0, 'easter'], fog: 0xe8e0f0, tint: 0xfff0f8, lamp: 0xfff0a0,
    m1: mk(0xf2c0d8, .55), m2: mk(0xb8d8f2, .55), dark: mk(0x5a4a6a, .6), light: mk(0xfff8e8, .8), wood: mk(0x8a6a4a, .65, .05), fab: [0xf2a0b8, 0xf2e08a, 0xa8e0a8, 0xa8c8f2, 0xd0b0f2],
    string: [0xf2a0b8, 0xf2e08a, 0xa8e0a8, 0xa8c8f2], fall: {colors: [0xf2a0b8, 0xf2e08a, 0xa8c8f2, 0xd0b0f2], size: .17, speed: .6, sway: 1.5}, floats: {colors: [0xf2a0b8, 0xa8c8f2, 0xf2e08a], shape: 'sphere'}},
  cinco: {label: 'Cinco de Mayo', emoji: '🪅', win: [4, 28, 5, 6], fog: 0xe8d8a8, tint: 0xfff0c0, lamp: 0xffd060,
    m1: mk(0xd02a2a, .5), m2: mk(0x1f8a3a, .5), dark: mk(0x241a14, .6), light: mk(0xfaf2e0, .8), wood: mk(0x6a4428, .65, .05), fab: [0xd02a2a, 0xf2c14e, 0x1f8a3a, 0x1f9aa8, 0xe8409a],
    string: [0xd02a2a, 0xf8f8f0, 0x1f8a3a, 0xf2c14e, 0xe8409a], fall: {colors: [0xd02a2a, 0xf8f8f0, 0x1f8a3a, 0xf2c14e], size: .16, speed: .9, sway: 1.4}, floats: {colors: [0xd02a2a, 0x1f8a3a, 0xf2c14e, 0xe8409a], shape: 'sphere'}},
  july4: {label: 'Fourth of July', emoji: '🎇', win: [6, 25, 7, 5], fog: 0xc8d4e8, tint: 0xe0ecff, lamp: 0xfff0d0,
    m1: mk(0xc8282e, .5), m2: mk(0x1f3a8a, .5), dark: mk(0x14182a, .6), light: mk(0xf8f8f8, .8), wood: mk(0x5a3a22, .65, .05), fab: [0xc8282e, 0xe8e8e8, 0x2a5a8a, 0x1f3a8a, 0xc8282e],
    string: [0xff3a3a, 0xffffff, 0x3a6aff], fall: {colors: [0xff3a3a, 0xffffff, 0x3a6aff], size: .15, speed: .9, sway: 1.5}, floats: {colors: [0xc8282e, 0xf8f8f8, 0x1f3a8a], shape: 'sphere'}},
};
export const HOLIDAYS = ['mexindep', 'halloween', 'muertos', 'thanksgiving', 'christmas', 'newyear', 'valentine', 'stpatrick', 'easter', 'cinco', 'july4'];

function easter(y) {   // anonymous Gregorian computus
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
    h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31), da = (h + l - 7 * m + 114) % 31 + 1;
  return new Date(y, mo - 1, da);
}
function thanksgiving(y) { const d = new Date(y, 10, 1); return new Date(y, 10, 1 + (4 - d.getDay() + 7) % 7 + 21); }   // 4th Thursday of November
function windowFor(id, y) {   // [start, end] dates (inclusive) of a holiday's theme in year y
  const t = THEMES[id], w = t.win;
  if (w[4] === 'easter') { const e = easter(y); return [new Date(e.getTime() - 10 * 864e5), new Date(e.getTime() + 864e5)]; }
  if (w[4] === 'thanksgiving') { const g = thanksgiving(y); return [new Date(g.getTime() - 12 * 864e5), new Date(g.getTime() + 864e5)]; }
  return [new Date(y, w[0] - 1, w[1]), new Date(w[2] < w[0] ? y + 1 : y, w[2] - 1, w[3], 23, 59)];
}
const day = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
// the holiday theme whose window contains `now`, else steampunk
export function autoTheme(now = new Date()) {
  const t = day(now);
  for (const y of [now.getFullYear() - 1, now.getFullYear()])
    for (const id of HOLIDAYS) { const [a, b] = windowFor(id, y); if (t >= a && t <= b) return id; }
  return 'steampunk';
}
// next holiday after `now` (for the chip label)
export function nextHoliday(now = new Date()) {
  const t = day(now); let best = null;
  for (const y of [now.getFullYear(), now.getFullYear() + 1])
    for (const id of HOLIDAYS) { const [a] = windowFor(id, y); if (a > t && (!best || a < best[1])) best = [id, a]; }
  return best && best[0];
}
// override: 'auto' (default) | 'classic' | a theme id; ?theme= sets it
export function stored() {
  try {
    const q = new URLSearchParams(location.search).get('theme');
    if (q) localStorage.setItem('eol-scene-theme', q);
    const v = localStorage.getItem('eol-scene-theme');
    return v || 'auto';
  } catch (e) { return 'auto'; }
}
export function resolve() {   // → id of the theme to render, or 'default' for the untouched classic look
  const v = stored();
  if (v === 'classic' || v === 'default') return 'default';
  if (v !== 'auto' && THEMES[v]) return v;
  return autoTheme();
}
export const CYCLE = ['auto', 'steampunk', ...HOLIDAYS, 'classic'];
