// quests.js — six pun-and-fun vendors, their flash sales, festival-wide flash dances, and a pile of pun
// "minor emergencies" (quests) from vendors, stagehands, the band, lifeguards and kids. Finishing one earns Rep
// (rep.js → server.py rate-limits it), and more Rep means the crowd comes over to greet you more often.
// Everything is data-driven; one quest is active at a time, one small card shows it, and the only per-frame
// work is a few distance checks.
import * as THREE from 'three';

const rnd = (a, b) => a + Math.random() * (b - a), pick = a => a[Math.floor(Math.random() * a.length)];

// id, sign pun, booth colour, flash-sale lines, [x, z, faces south?]
export const VENDORS = [
  {id: 'wok', name: 'Wok This Way', hue: 0xd94a2a, spot: [-24, 22], sales: ['Noodles 50% off — we\'re on a roll, lo mein-ute!', 'Fried rice is half price — it\'s a-RICE-ing deal!', 'Dumplings 2-for-1 — you\'ll be wonton more!']},
  {id: 'pita', name: 'Pita Pan', hue: 0x3aa0d9, spot: [-8, 27], sales: ['Gyros 40% off — they\'re *Greek* to me, but delicious!', 'Hummus half price — it\'s the dip-lomatic choice!', 'Falafel 2-for-1 — a ball-ing good time!']},
  {id: 'fry', name: 'Fry Me to the Moon', hue: 0xe8c23a, spot: [8, 27], sales: ['Fries 50% off — don\'t be a *chip* off the old block!', 'Curly fries half price — a-twist-ing offer!', 'Onion rings 2-for-1 — we\'re all about that ring-ring!']},
  {id: 'brew', name: 'Brew-ha-ha', hue: 0x8a5a3a, spot: [24, 22], sales: ['Iced tea 50% off — it\'s the *leaf* we can do!', 'Lemonade half price — when life gives you deals…', 'Cold brew 2-for-1 — a grounds-breaking offer!']},
  {id: 'sundae', name: 'Sundae Funday', hue: 0xff7ab8, spot: [-26, -38], south: true, sales: ['Cones 50% off — a *scoop* you can\'t pass up!', 'Sundaes half price — that\'s the cherry on top!', 'Popsicles 2-for-1 — chill out, it\'s a steal!']},
  {id: 'pretzel', name: 'Pretzel Logic', hue: 0xc89a4a, spot: [34, -40], south: true, sales: ['Pretzels 50% off — a *twist* of fate!', 'Cheese dip half price — nacho average deal!', 'Giant pretzels 2-for-1 — knot to be missed!']},
];
const DANCE_LINES = ['The DJ dropped the beet! 🥕💃', 'Everybody boogie — it\'s a flash mob, no *mobbing* required!', 'Shake what your mama gave you — and a little glitter!', 'Dance like nobody\'s watching (everybody is)!', 'Quick, the floor is lava — and so are the moves! 🔥', 'It\'s getting hot in here — so dance like it\'s a sprinkler! 💦', 'Cha-cha-cha-change your shoes, we\'re dancing! 👟', 'Soup-er dance party — it\'s a *ladle* of fun!'];

// goal: 'visit:<poi>' | 'deliver:<poiA>><poiB>' | 'tap' | 'dance' | 'litter:<n>' | 'lost'   (poi: v:<vendor> stage window games park can lost)
const Q = [
  ['v:wok', 'Noodle Nightmare', "My noodles are in a tangle — it's a real pasta-vation emergency! Fetch chopsticks from the band's drummer (he's got stick to spare).", 'deliver:stage>v:wok', 3],
  ['v:wok', 'Soy Sorry', "I spilled soy sauce everywhere! Help me *wipe out* the mess — pick up 3 pieces of trash.", 'litter:3', 3],
  ['v:wok', 'Wok Around the Clock', "My wok is missing its lid and I'm losing my *wok*-ing mind! Check the Lost & Found crate by the truck.", 'visit:lost', 2],
  ['v:pita', 'Pita Pan Panic', "Peter Pita flew off with my tomatoes! Can you *pita* around the lawn and find a lost item to calm the crowd?", 'lost', 4],
  ['v:pita', 'Hummus, Hummus Everywhere', "A hummus flood! Quick — run to Brew-ha-ha and borrow their *dip*stick.", 'deliver:v:brew>v:pita', 3],
  ['v:pita', 'Gyro Scope', "My gyro machine's spinning out of control — find the stagehand, he's a real *tech*-nician.", 'visit:stage', 2],
  ['v:fry', 'Fry-day Fiasco', "Someone stole my best fries' *spud*-light! Pick up 4 bits of litter so I can find it.", 'litter:4', 4],
  ['v:fry', 'Chip Off the Old Block', "I need ketchup from Pretzel Logic — it's a real *tomato* emergency, don't let it *ketch*-up with us!", 'deliver:v:pretzel>v:fry', 3],
  ['v:fry', 'Potato Cannon', "The little kid's potato-cannon flew over the stage! Find a lost item and I'll *mash*-ter the thanks.", 'lost', 3],
  ['v:brew', 'Tea-rrible News', "My tea kettle is *steeping* in trouble — go chat up the lifeguards at the water park, they know about *hot* water.", 'visit:park', 3],
  ['v:brew', 'Grounds for Complaint', "Someone left coffee *grounds* all over the lawn! Tidy up 3 pieces of trash, would you?", 'litter:3', 3],
  ['v:brew', 'Latte Dance', "I'm *latte* for my break! Join the next flash dance and shake it with me.", 'dance', 3],
  ['v:sundae', 'Sundae Bloody Sundae', "My ice cream is melting — it's a *mint*-condition emergency! Run for ice from the truck window!", 'deliver:window>v:sundae', 3],
  ['v:sundae', 'Cone-fusion', "I lost the cone for a very *sprinkle*-sad kid. Find a lost item, it'll *scoop* up some joy.", 'lost', 4],
  ['v:sundae', 'Brain Freeze Emergency', "A customer got a brain freeze and I'm out of *cool* ideas — tap me to give a high-five (and a thaw).", 'tap', 1],
  ['v:pretzel', 'Knot Again!', "My pretzel dough got tied in a knot — and I'm *dough*-ing my best! Help by picking up 3 wrappers or cups.", 'litter:3', 3],
  ['v:pretzel', 'Salt of the Earth', "I'm out of salt and I'm feeling *salty*! Borrow some from Wok This Way.", 'deliver:v:wok>v:pretzel', 3],
  ['v:pretzel', 'Pretzel Logic Problem', "If a pretzel falls in the forest… anyway, it's lost! Find a lost item and return it to the Lost & Found.", 'lost', 3],
  ['stage', 'Mic Check, Please', "The singer lost her mic *cable* — she's cable of nothing right now! Ask Fry Me to the Moon for a spare *chord* (cable).", 'deliver:v:fry>stage', 4],
  ['stage', 'Drum Roll, Please', "The drummer's drumsticks vanished — now he's a *snare* of a mess. Find a lost item, in case it's a sticky situation!", 'lost', 4],
  ['stage', 'Amp-ly Ridiculous', "The amp's overheated — it's got *volume* issues. Fetch a cold iced tea from Brew-ha-ha!", 'deliver:v:brew>stage', 4],
  ['stage', 'Guitar Hero Needed', "Our guitarist's string snapped — what a *chord*-ial disaster! Do a flash dance to distract the crowd while we fix it!", 'dance', 4],
  ['stagehand', 'Stagehand Handstand', "I dropped my wrench into the audience — it's a *wrench*-ing experience! Find a lost item for me, I'm all thumbs.", 'lost', 3],
  ['stagehand', 'Spotlight Stealer', "The spotlight went *out of focus*! Tap me for a quick thumbs-up so I can *light* the place up.", 'tap', 1],
  ['stagehand', 'Cable Guy', "I'm *tied up* with cables — help tidy the lawn: pick up 3 pieces of litter!", 'litter:3', 3],
  ['stagehand', 'Curtain Call', "The curtain's stuck — what a *drape*-ful situation! Go see Pita Pan, they have a pole.", 'visit:v:pita', 2],
  ['lifeguard', 'Whistle While You Work', "I lost my whistle — I'm *blowing* it today! Find a lost item and I'll *blow* you a kiss... of thanks.", 'lost', 3],
  ['lifeguard', 'Float Your Boat', "A bumper boat is stuck in a *rut* (a pond rut)! Come over to the water park gate and give me a hand.", 'visit:park', 2],
  ['lifeguard', 'Shark Alert!', "It's just a floatie shark, but it's *jaw-dropping*! Do a victory flash dance to calm the swimmers.", 'dance', 3],
  ['lifeguard', 'Sunscreen Shortage', "I'm *burnt out*! Borrow sunscreen from Sundae Funday — it's the coolest stand.", 'deliver:v:sundae>park', 4],
  ['kid', 'Lost My Teddy', "I can't find Mr. Fluffington and I'm *bear*-ly holding it together! Please find a lost item!", 'lost', 4],
  ['kid', 'Where Is My Mommy?', "I'm lost — kidding! Can you take this high-five to the lifeguard? (Visit the water park.)", 'visit:park', 2],
  ['kid', 'Slippery Slope', "Someone dropped a banana peel — what a *peel*-ing! Pick up 2 pieces of trash.", 'litter:2', 2],
  ['kid', 'Ice Cream Emergency', "My scoop fell on the ground! Run to Sundae Funday and ask for a re-*cone*-ciliation.", 'deliver:window>v:sundae', 3],
  ['any', 'Trash Talk', "The grass is in a *litter*-al mess! Clean up 5 pieces of trash.", 'litter:5', 5],
  ['any', 'Games Night', "I heard the claw machine is clawing at its limits — go see it for me!", 'visit:games', 2],
  ['any', 'Table for None', "Someone left their dinner at a table — it's a *plate*-ful of trouble. Visit the picnic tables.", 'visit:tables', 2],
];

export function init(o) {
  const {S, cam, rig, life, stuff, rep, player, performers, buildBooth, lite, phone: isPhone, createStaff, stage, win, park, open} = o;
  const small = lite || isPhone;
  const vend = {};   // id → {booth, staff, x, z, sale}
  // ---------- vendors ----------
  for (const V of VENDORS) {
    const [x, z] = V.spot, g = buildBooth(V.name, V.hue); g.position.set(x, 0, z); g.rotation.y = V.south ? Math.PI : 0; S.add(g);
    const st = createStaff({x, z: z + (V.south ? .2 : -.2), yaw: V.south ? Math.PI : 0, name: V.name.split(' ')[0] + ' Pat'}); st.quest = 'vendor'; st.vendor = V.id;
    const c = document.createElement('canvas'); c.width = 512; c.height = 160; const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const ban = new THREE.Sprite(new THREE.SpriteMaterial({map: tex, transparent: true, depthTest: false})); ban.scale.set(3.4, 1.06, 1); ban.position.set(x, 4.1, z); ban.renderOrder = 997; ban.visible = false; S.add(ban);
    vend[V.id] = {V, booth: g, staff: st, x, z, ban, tex, c, sale: 0, doneSale: false};
  }
  const banner = (v, line, color) => {
    const g = v.c.getContext('2d'); g.clearRect(0, 0, 512, 160); g.fillStyle = color; g.beginPath(); g.roundRect(4, 4, 504, 152, 24); g.fill(); g.fillStyle = '#fff'; g.textAlign = 'center';
    g.font = '800 30px Inter,sans-serif'; g.fillText(line[0], 256, 52); g.font = '600 20px Inter,sans-serif';
    const w = line[1].split(' '); let l = '', y = 92; for (const t of w) { if (g.measureText(l + t).width > 470) { g.fillText(l, 256, y); y += 26; l = ''; } l += t + ' '; } g.fillText(l, 256, y); v.tex.needsUpdate = true;
  };
  // stagehands by the stage
  const hands = [createStaff({x: -9, z: -58, yaw: 3.14, name: 'Stagehand Stan'}), createStaff({x: 25, z: -58, yaw: 3.14, name: 'Stagehand Gus'})]; hands.forEach(h => { h.quest = 'stagehand'; h.anim = 'queue'; });
  const guards = life.actors.filter(a => a.staff && /^Lifeguard/.test(a.name)); guards.forEach(a => { a.quest = 'lifeguard'; });
  const UI = life;

  // ---------- points of interest (world x,z) ----------
  const poi = {
    stage: () => ({x: 8, z: -58, n: 'the stage'}), window: () => { const w = rig.localToWorld(new THREE.Vector3(win.x1 - .4, 0, win.z + 1.6)); return {x: w.x, z: w.z, n: 'the truck window'}; },
    games: () => { const ps = o.props().map(p => p && p.getWorldPosition ? p : null).filter(Boolean); const w = (ps[0] || rig).getWorldPosition(new THREE.Vector3()); return {x: w.x + 2, z: w.z + 2, n: 'the games'}; },
    park: () => ({x: park.poi.gate ? park.poi.gate.x : -38, z: park.poi.gate ? park.poi.gate.z : -3, n: 'the water park gate'}), lost: () => { const w = new THREE.Vector3(); stuff.crate().getWorldPosition(w); return {x: w.x, z: w.z, n: 'the Lost & Found'}; },
    tables: () => { const t = pick(o.tables), w = t.getWorldPosition(new THREE.Vector3()); return {x: w.x, z: w.z, n: 'the picnic tables'}; },
  };
  const resolve = key => { if (key.startsWith('v:')) { const v = vend[key.slice(2)]; return {x: v.x, z: v.z, n: v.V.name}; } return poi[key](); };

  // ---------- events: flash sales + flash dances ----------
  let nextSale = rnd(25, 45), nextDance = rnd(70, 110), nextQuest = rnd(12, 25), joined = 0, saleTap = new Set();
  const flashSale = () => {
    const free = Object.values(vend).filter(q => !(q.sale > 0)); if (!free.length) return;
    const v = pick(free); const line = pick(v.V.sales);
    v.sale = 55; v.doneSale = false; banner(v, ['⚡ FLASH SALE ⚡', line], '#d02a5a'); v.ban.visible = true; v.staff.anim = 'cheer'; life.setMood(v.staff, 'smile', 50);
    const n = life.rush(v.x, v.z + (v.V.south ? -2 : 2), 50, small ? 2 : 4); life.toast('⚡ ' + v.V.name + ': ' + line + (n ? '  (crowd incoming!)' : ''));
  };
  const flashDance = () => {
    const starters = [...Object.values(vend).map(v => ({x: v.x, z: v.z + (v.V.south ? -4 : 4), n: v.V.name})), {x: 8, z: -56, n: 'the stage'}], at = pick(starters);
    const n = life.flashDance(at.x, at.z, 18, small ? 6 : 14); danceAt = {x: at.x, z: at.z, t: 0, got: false, until: 22};
    life.toast('💃 FLASH DANCE at ' + at.n + '! ' + pick(DANCE_LINES));
    for (const v of Object.values(vend)) if (Math.hypot(v.x - at.x, v.z - at.z) < 12) { v.staff.anim = 'dance'; setTimeout(() => { v.staff.anim = v.sale ? 'cheer' : 'chat'; }, 18000); }
  };
  let danceAt = null;

  // ---------- quests ----------
  const card = document.createElement('div');
  card.style.cssText = 'position:fixed;right:12px;top:84px;z-index:58;width:min(300px,86vw);display:none;background:#180f24f2;color:#f6e7c8;border:1px solid rgba(242,193,78,.55);border-radius:14px;padding:10px 12px;font:13px/1.4 Inter,system-ui,sans-serif;box-shadow:0 10px 30px #000a';
  document.body.appendChild(card);
  let active = null, done = JSON.parse(localStorage.getItem('eol-quests-done') || '[]');
  const parse = g => { const i = g.indexOf(':'); return i < 0 ? [g, ''] : [g.slice(0, i), g.slice(i + 1)]; };
  const goalText = g => { const [k, a] = parse(g); if (k === 'visit') return 'Go to ' + resolve(a).n; if (k === 'deliver') { const [p, d] = a.split('>'); return `Pick up from ${resolve(p).n}, bring to ${resolve(d).n}`; } if (k === 'tap') return 'Tap them to help'; if (k === 'dance') return 'Join the next flash dance (stand with the dancers)'; if (k === 'litter') return `Pick up ${a} pieces of trash and bin them`; if (k === 'lost') return 'Find a lost item and return it'; return ''; };
  const giverActor = q => { const [g] = q; if (g.startsWith('v:')) return vend[g.slice(2)].staff; if (g === 'stagehand') return pick(hands); if (g === 'lifeguard') return pick(guards.length ? guards : hands); if (g === 'kid') return life.actors.find(a => a.kid && !a.staff) || pick(hands); if (g === 'stage') return null; return pick(life.actors.filter(a => !a.staff && !a.kid)); };
  function render() {
    if (!active) { card.style.display = 'none'; return; }
    const q = active.q, left = Math.max(0, Math.ceil(active.t));
    card.style.display = document.body.classList.contains('panel-open') ? 'none' : 'block';
    card.innerHTML = `<div style="display:flex;justify-content:space-between;gap:8px"><b style="color:#f2c14e">❗ ${q[1]}</b><span style="opacity:.75">${left}s · ⭐${q[4]}</span></div><div style="margin:4px 0;font-size:12.5px">${active.giverName}: “${q[2]}”</div><div style="opacity:.9;font-size:12px">🎯 ${active.hint}</div><button id="qSkip" style="margin-top:6px;background:none;border:1px solid rgba(255,255,255,.3);color:#f6e7c8;border-radius:8px;padding:3px 10px;cursor:pointer;font:600 11px Inter">skip</button>`;
    card.querySelector('#qSkip').onclick = () => finish(false);
  }
  function start() {
    const p = player(); if (!p) return;
    const pool = Q.filter(q => !active_recent.includes(q[1])); const q = pick(pool.length ? pool : Q), g = giverActor(q), [k, a] = parse(q[3]);
    active = {q, t: 150, giver: g, giverName: g ? g.name : 'The band', stage: 0, count: 0, hint: goalText(q[3]), dwell: 0, lostId: null};
    active_recent.push(q[1]); if (active_recent.length > 14) active_recent.shift();
    if (k === 'lost') { const spot = stuff.items.filter(i => !i.gone && i.k).sort(() => Math.random() - .5)[0]; const it = stuff.spawnLost(pick(['teddy', 'duck', 'cap', 'ball', 'shoe']), rnd(-20, 40), rnd(6, 28), active.giverName); active.lostId = it.id; active.hint += ' (somewhere on the lawn — look for ❗)'; }
    if (k === 'deliver') { active.from = resolve(a.split('>')[0]); active.to = resolve(a.split('>')[1]); }
    if (k === 'dance') { life.flashDance(p.x + rnd(-8, 8), p.z + rnd(6, 12), 20, small ? 6 : 12); danceAt = {x: p.x, z: p.z, t: 0, got: false, until: 25}; }
    if (g) { life.pop('❗', g.root, 2.2); g.react = performance.now() + 12000; }
    life.toast('❗ New quest: ' + q[1]); render();
  }
  const active_recent = [];
  function finish(ok) {
    if (!active) return; const q = active.q;
    if (ok) {
      done.push(q[1]); try { localStorage.setItem('eol-quests-done', JSON.stringify(done.slice(-200))); } catch (e) {}
      rep.add('quest', q[4]).then(() => life.toast(`🎉 Quest complete: ${q[1]}! +${q[4]} Rep  (${rep.title()}, ${rep.points()})`));
      if (active.giver) { life.pop('⭐', active.giver.root, 2.2); life.setMood(active.giver, 'smile', 6); life.cheer(active.giver, 2.5); }
    } else life.toast('🌀 The emergency resolved itself (or you took a pass).');
    active = null; nextQuest = rnd(18, 40) / (1 + rep.level() * .4); render();
  }
  addEventListener('eol:stuff-delivered', e => {
    if (!active) return; const g = active.q[3], [k, a] = parse(g), d = e.detail || {};
    if (k === 'litter' && d.kind === 'trash') { active.count++; active.hint = goalText(g) + ` — ${active.count}/${a}`; if (active.count >= +a) finish(true); else render(); }
    if (k === 'lost' && d.kind === 'lost' && (d.id === active.lostId || !active.lostId)) finish(true);
  });
  // tapping a giver / vendor
  const onTap = a => {
    if (a.vendor) { const v = vend[a.vendor]; if (v.sale > 0 && !saleTap.has(v.V.id + Math.floor(v.sale > 0))) { /* once per sale below */ } if (v.sale > 0 && !v.doneSale) { v.doneSale = true; rep.add('quest', 1).then(() => life.toast('🛍️ You snagged the flash deal at ' + v.V.name + '! (just for fun — real deals live in the menu)  +1 Rep')); life.pop('⭐', a.root, 2.2); return true; } }
    if (active && active.giver === a && active.q[3] === 'tap') { finish(true); return true; }
    if (a.quest && active && active.giver === a) { life.toast('🗣️ ' + a.name + ': "' + active.q[2] + '"'); return true; }
    return false;
  };

  function tick(t, dt) {
    for (const v of Object.values(vend)) if (v.sale > 0) { v.sale -= dt; if (v.sale <= 0) { v.ban.visible = false; v.staff.anim = 'chat'; } else { const d = Math.hypot(cam.position.x - v.x, cam.position.z - v.z); v.ban.visible = d < (small ? 40 : 75); } }
    nextSale -= dt; if (nextSale <= 0) { nextSale = rnd(70, 120) / (1 + rep.level() * .25); flashSale(); }
    nextDance -= dt; if (nextDance <= 0) { nextDance = rnd(150, 240) / (1 + rep.level() * .25); flashDance(); }
    const p = player();
    if (danceAt) {   // standing with the dancers for ~6 s earns Rep once per dance
      danceAt.until -= dt; if (danceAt.until <= 0) danceAt = null;
      else if (p && !danceAt.got && Math.hypot(p.x - danceAt.x, p.z - danceAt.z) < 7 && life.dancersNear(p.x, p.z, 6) >= 2) { danceAt.t += dt; if (danceAt.t > 6) { danceAt.got = true; if (active && active.q[3] === 'dance') finish(true); else rep.add('quest', 2).then(() => life.toast('💃 You joined the flash dance! +2 Rep')); } }
    }
    if (!active) { if (p && (nextQuest -= dt) <= 0) start(); return; }
    active.t -= dt; if (active.t <= 0) { finish(false); return; }
    if ((active.tick = (active.tick || 0) + dt) > 1) { active.tick = 0; render(); if (active.giver && active.giver.near) { const L = life; if (!active.popped || performance.now() - active.popped > 4000) { active.popped = performance.now(); L.pop('❗', active.giver.root, 2.2); } } }
    if (!p) return;
    const [k, a] = parse(active.q[3]);
    const near = (pt, r = 3.4) => Math.hypot(p.x - pt.x, p.z - pt.z) < r;
    if (k === 'visit' && near(resolve(a))) finish(true);
    else if (k === 'deliver') {
      if (active.stage === 0 && near(active.from)) { active.stage = 1; active.hint = `Got it! Now bring it to ${active.to.n}`; life.toast('📦 Picked up! Now bring it to ' + active.to.n); render(); }
      else if (active.stage === 1 && near(active.to)) finish(true);
    }
  }
  return {tick, onTap, vendors: vend, quests: Q.length};
}
