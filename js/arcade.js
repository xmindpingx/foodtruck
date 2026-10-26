// arcade.js — 🎪 The Midway: six minigames that award collectibles to the phone-number account.
// Solo vs AI / time race, or a "Challenge everyone" duel relayed through festival chat '@pa '
// traffic (same pattern as the hot-dog contest). Every finish reports to /api/score so the
// HIGH SCORES board by the truck (click it) and the trivia bot's live-score questions stay true.
// Lobby + done screens speak the language picked at sign-up (Account.lang()).
import * as THREE from 'three';
import {announce, clockNow, visitorName} from './avatars.js?v=6';
import {CONFIG} from './shop.js?v=6';                // games on/off switches (Admin → Settings → Games)
import * as Account from './account.js?v=6';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const rnd = a => a[Math.floor(Math.random() * a.length)];
const ES = () => Account.lang() === 'es';

let panel, body, S, rig, MENU;                    // panel DOM + scene refs
let pills = [];                                   // prop meshes for the click ray
let props = {claw: null, bbt: [], tag: null, board: null};
let tab = 'lobby';
const GAMES = [
  {id: 'claw', icon: '🦞', name: 'Claw Machine', blurb: 'Time the drop. Three grabs per game — grab a mini menu item!'},
  {id: 'bbt', icon: '🎯', name: 'Bean-Bag Toss', blurb: 'Three bags at the boards. Rings score 50 / 25 / 10 — 75+ to win.'},
  {id: 'tag', icon: '🚩', name: 'Tag Arena', blurb: 'Chase the runner with the arrow keys. Three tags in 40 seconds wins!'},
  {id: 'c4', icon: '🔴', name: 'Connect Four', blurb: 'Classic four-in-a-row — solo vs AI or challenge a rival.'},
  {id: 'ttt', icon: '⭕', name: 'Tic-Tac-Toe', blurb: 'Noughts and crosses on the boardwalk.'},
  {id: 'pin', icon: '🪅', name: 'Piñata Smash', blurb: 'Swing at the swing point — five clean hits breaks it open!'},
];
const BL = {   // per-game name/blurb in the language picked at sign-up
  claw: {en: GAMES[0], es: {name: 'Máquina de Garra', blurb: 'Mide el momento. Tres intentos por partida — ¡gana un artículo del menú en miniatura!'}},
  bbt:  {en: GAMES[1], es: {name: 'Lanzar Bolsas', blurb: 'Tres bolsas a las tablas. Los aros valen 50 / 25 / 10 — ¡75+ para ganar!'}},
  tag:  {en: GAMES[2], es: {name: 'Arena de Toques', blurb: 'Persigue al corredor con las flechas. ¡Tres toques en 40 segundos gana!'}},
  c4:   {en: GAMES[3], es: {name: 'Conecta Cuatro', blurb: 'El clásico de cuatro en línea — solo vs IA o reta a alguien.'}},
  ttt:  {en: GAMES[4], es: {name: 'Gato / Tic-Tac-Toe', blurb: 'Triqui en el muelle del camión.'}},
  pin:  {en: GAMES[5], es: {name: 'Rompimiento de Piñata', blurb: 'Golpea cuando la sombra cruce el punto — ¡cinco tazos la rompen!'}},
};
const gameN = id => (BL[id] || {})[ES() ? 'es' : 'en'] || (GAMES.find(g => g.id === id) || {});
const DUELABLE = {c4: 1, ttt: 1};

// ---------- games on/off (Admin → Settings → Games) ----------
// midwayOn switches the whole Midway off (no props, no panel); a per-game flag hides that
// game's prop, tab and score row. Old settings files lack the keys, so !== false keeps every
// default ON — flipping one off in admin is what hides it here.
const gameOn = id => !CONFIG || CONFIG['game' + id.charAt(0).toUpperCase() + id.slice(1) + 'On'] !== false;
const MIDWAY_ON = () => !CONFIG || CONFIG.midwayOn !== false;
const HOTDOG_ON = () => !CONFIG || CONFIG.hotdogOn !== false;
const gamesOn = () => GAMES.filter(g => gameOn(g.id));

let miniItems = [];                               // mini menu-item prize pool (from the live menú)

const TT = {
  en: {
    lobby: 'Winners get <b>miniature menú items</b> added to their profile collection.',
    play: '▶ Play', solo: 'Solo vs AI', duel: '⚔️ Challenge everyone', join: '🤝 Join the duel!',
    waitInvite: 'Challenge sent — the first rival to join starts the duel.',
    signed: n => 'Playing as <b>' + esc(n) + '</b> · 🪙 ' + Math.round(Account.points()) + ' pts · <a href="#" id="eolMidAcct">profile</a>',
    unsigned: '<a href="#" id="eolMidAcct">Sign in</a> to bank points & prizes.',
    prize: n => '🎁 You won a <b>Mini ' + esc(n) + '</b>',
    pocket: ' (waiting in your pocket — sign in to bank it)',
    collect: ' — see your collection!',
    lose: 'So close! Try again.',
    saveFail: 'You earned a prize, but saving it failed. Try again soon.',
    again: '▶ Again', home: '← Midway',
    duelEnd: {me: p => '🏆 You beat ' + esc(p) + '!', draw: p => '🤝 Draw with ' + esc(p) + '!', them: (w, p) => esc(w || p) + ' won the duel.'},
    aiWon: 'The AI won this round.', drawOnly: 'A dead-even draw!', connect: '🎯 Brilliant connect!', cat: "Cat's game — nobody scores.",
    closed: 'The games are switched off right now — the trivia chat and prize shelf still run!',
  },
  es: {
    lobby: 'Los ganadores reciben <b>artículos del menú en miniatura</b> para su colección.',
    play: '▶ Jugar', solo: 'Solo vs IA', duel: '⚔️ Retar a todos', join: '🤝 ¡Entrar al duelo!',
    waitInvite: 'Reto enviado — el primer rival que entre arranca el duelo.',
    signed: n => 'Jugando como <b>' + esc(n) + '</b> · 🪙 ' + Math.round(Account.points()) + ' pts · <a href="#" id="eolMidAcct">perfil</a>',
    unsigned: '<a href="#" id="eolMidAcct">Ingresa</a> para guardar puntos y premios.',
    prize: n => '🎁 Ganaste un <b>' + esc(n) + ' mini</b>',
    pocket: ' (esperando en tu bolsillo — ingresa para guardarlo)',
    collect: ' — ¡mira tu colección!',
    lose: '¡Casi! Inténtalo otra vez.',
    saveFail: 'Ganaste un premio, pero no se pudo guardar. ¡Vuelve pronto!',
    again: '▶ Otra vez', home: '← El Midway',
    duelEnd: {me: p => '🏆 ¡Venciste a ' + esc(p) + '!', draw: p => '🤝 Empate con ' + esc(p) + '!', them: (w, p) => esc(w || p) + ' ganó el duelo.'},
    aiWon: 'La IA ganó esta ronda.', drawOnly: '¡Empate parejo!', connect: '🎯 ¡Conexión brillante!', cat: 'El gato se lo llevó — nadie anota.',
    closed: 'Los juegos están apagados ahorita — ¡la trivia del chat y el estante de premios siguen!',
  },
};
const tt = k => (TT[ES() ? 'es' : 'en'] || TT.en)[k] || TT.en[k];

// ---------- result reporting → data/scores.json (feeds the HIGH SCORES board + trivia) ----------
function report(game, value, label) {
  let phone = '';
  try { const a = JSON.parse(localStorage.getItem('eolAcct') || 'null'); if (a && a.phone) phone = a.phone; } catch (e) {}
  try {
    fetch('/api/score', {method: 'POST', headers: {'Content-Type': 'application/json'},
      keepalive: true, body: JSON.stringify({game, value, label, name: visitorName(), phone})}).catch(() => {});
  } catch (e) {}
}

// ---------- challenge relay (host = the visitor who pressed "Challenge everyone") ----------
const chal = {game: null, role: null, peer: null, startAt: 0, deadline: 0};
const myRooms = {};                               // game -> 'host' (I opened a duel room)
let clockSkew = 0, sayLast = '';
const gameName = id => gameN(id).name || id;

function say(line) {
  sayLast = line || '';
  const el = body && body.querySelector('.eolMidSay');
  if (el) el.textContent = sayLast;
}
function openChallenge(g) {                       // "Challenge everyone": broadcast, wait for a join
  chal.game = g; chal.role = 'host'; chal.peer = null;
  myRooms[g] = 'host';
  chal.deadline = Date.now() + 14000;
  announce('@pa open ' + g + ' ' + Math.round(chal.deadline + (clockSkew || 0)));
  say(tt('waitInvite'));
  render();
}
function joinChallenge(g) {                       // the invited side signs up
  if (chal.role !== 'invited' || chal.game !== g) return;
  chal.role = 'joined';
  announce('@pa join ' + g + ' ' + visitorName());
  say(ES() ? '¡Duelo armado — starting!' : 'Duel armed — awaiting the start…');
  render();
}
function armDuelStart() {                         // both sides start once the clock says go
  const ms = Math.max(0, (chal.startAt || 0) - Date.now());
  setTimeout(() => { if ((chal.role === 'host' || chal.role === 'joined') && chal.game) startGame(chal.game); }, ms);
}
addEventListener('eol:pa', onPa);
function onPa({id, name, text}) {
  const p = String(text || '').split(/\s+/), cmd = p[0], g = p[1] || '';
  if (cmd === 'open' && DUELABLE[g] && gameOn(g)) {
    if (myRooms[g] === 'host') return;            // my own opening echoed back? never self-join
    chal.game = g; chal.role = 'invited'; chal.peer = {id, name};
    chal.deadline = (+p[2] || Date.now() + 14000) - (clockSkew || 0);
    tab = 'lobby'; if (panel && !panel.hidden) render(); else openPanel('lobby');
    say(ES() ? name + ' quiere un duelo de ' + gameName(g) + ' — ¡ábrelo desde su pestaña!'
              : name + ' wants a ' + gameName(g) + ' duel — open the ' + gameName(g) + ' tab to join!');
  }
  if (cmd === 'join' && myRooms[g] === 'host' && !chal.peer) {   // host: a rival signed up
    chal.peer = {id, name: p.slice(2).join(' ') || name};
    myRooms[g] = 'ready';
    chal.startAt = Date.now() + 2200;                             // host-local arming moment
    announce('@pa start ' + g + ' ' + Math.round(chal.startAt + (clockSkew || 0)));  // peer gets server time
    chal.role = 'host';
    armDuelStart();
    if (tab === g) startGame(g); else { tab = g; if (panel && !panel.hidden) render(); }
    say(ES() ? 'Tú vs ' + chal.peer.name + ' — ¡arranca!' : 'You vs ' + chal.peer.name + ' — starting!');
  }
  if (cmd === 'start' && chal.role === 'joined' && chal.game === g) {
    chal.startAt = (+p[2] || 0) - (clockSkew || 0);
    chal.role = 'host';                           // unified: the started duel player
    armDuelStart();
    tab = g; if (panel && !panel.hidden) render(); else openPanel(g);
    say(ES() ? 'Duelo vs ' + (chal.peer ? chal.peer.name : 'rival') + ' — ¡preparate!' : 'Duel vs ' + (chal.peer ? chal.peer.name : 'rival') + ' — get ready!');
  }
  if (cmd === 'mv' && chal.role && chal.game === g && id === (chal.peer && chal.peer.id)) {
    applyOpponentMove(g, p.slice(2).join(' '));
  }
  if (cmd === 'res' && chal.role && chal.game === g && id === (chal.peer && chal.peer.id)) {
    const w = p.slice(2).join(' ');
    duelEnd(g, w === 'draw' ? 'draw' : (chal.peer && w === chal.peer.name ? 'them' : 'me'), w);
  }
}

// ---------- 3D props (all in truck-rig space; serving side is -z) ----------
function box(w, h, d, color) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({color, roughness: .6})); }
function buildProps() {
  // 🦞 claw machine on the serving side, lit from inside (only when its game is on)
  let claw = null;
  if (gameOn('claw')) {
    claw = new THREE.Group();
    const cab = box(1.15, 1.95, .95, 0x7a1f2b); cab.position.y = .97; claw.add(cab);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.1, .06),
      new THREE.MeshStandardMaterial({color: 0xbfe3ff, transparent: true, opacity: .32, roughness: .1}));
    glass.position.set(0, 1.18, -.5); claw.add(glass);
    const marquee = box(1.2, .3, .4, 0xf2c14e); marquee.position.set(0, 2.06, -.25); claw.add(marquee);
    const chute = box(.5, .3, .85, 0x2b1620); chute.position.set(0, .16, .1); claw.add(chute);
    const TINTS = [0xe5534a, 0xf2c14e, 0x53a86e, 0x4f76e5, 0xd77bd0, 0x74dbe6];
    for (let i = 0; i < 6; i++) {
      const p = box(.16, .13, .14, TINTS[i]);
      p.position.set(-.32 + (i % 3) * .32, 1.06 + (i > 2 ? .16 : 0), -.14);
      p.rotation.y = .4; claw.add(p);
    }
    const arm = new THREE.Group();                              // idle sway animated in tick()
    const al = box(.05, .5, .05, 0x202020); al.position.set(-.45, .75, 0); arm.add(al);
    const ar = box(.05, .5, .05, 0x202020); ar.position.set(.45, .75, 0); arm.add(ar);
    const beam = box(.95, .07, .07, 0x202020); beam.position.set(0, .78, 0); arm.add(beam);
    arm.position.y = .75; arm.position.z = -.3; claw.add(arm);
    claw.userData.arm = arm;
    claw.traverse(o => { o.userData.midway = 'claw'; });
    claw.position.set(-6.9, 0, -8.3); claw.rotation.y = .3; rig.add(claw); props.claw = claw;   // west flank of the HIGH SCORES board (was mid serving-side lawn) — user layout pass
  }

  // 🎯 two bean-bag boards angled toward the toss line, west lawn (skipped when the game is off)
  if (gameOn('bbt')) for (let i = 0; i < 2; i++) {
    const g = new THREE.Group();
    const board = box(1.1, 1.4, .08, 0x3d6b35); board.rotation.x = -.5; board.position.set(0, .62, 0);
    const sb = new THREE.Mesh(new THREE.TorusGeometry(.22, .05, 8, 24), new THREE.MeshStandardMaterial({color: 0xf2c14e}));
    sb.position.set(0, .2, .06); board.add(sb);
    const ob = new THREE.Mesh(new THREE.TorusGeometry(.09, .04, 8, 20), new THREE.MeshStandardMaterial({color: 0xe5534a}));
    ob.position.set(0, .2, .075); board.add(ob);
    g.add(board);
    const leg = box(.06, .55, .3, 0x202020); leg.position.set(0, .27, -.45); g.add(leg);
    g.traverse(o => { o.userData.midway = 'bbt'; });
    g.position.set(i ? -7.3 : -5.7, 0, i ? -4.5 : -6.4); g.rotation.y = .45 - i * .5;
    rig.add(g); props.bbt.push(g);
  }

  // 🚩 tag arena: painted ring + pennant flag, east of the tables (skipped when the game is off)
  let tag = null;
  if (gameOn('tag')) {
    tag = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.45, 40),
      new THREE.MeshBasicMaterial({color: 0xf2c14e, transparent: true, opacity: .5, side: THREE.DoubleSide}));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .02; tag.add(ring);
    const base = box(.3, .1, .3, 0x027a74); base.position.y = .05; tag.add(base);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.04, .05, 2.3, 8), new THREE.MeshStandardMaterial({color: 0x8a6d3b}));
    pole.position.y = 1.15; tag.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(.66, .42), new THREE.MeshStandardMaterial({color: 0xe5534a, side: THREE.DoubleSide}));
    flag.position.set(.33, 2.0, 0); tag.add(flag); flag.userData.flag = true;
    tag.traverse(o => { o.userData.midway = 'tag'; });
    tag.position.set(7.9, 0, -6.0); rig.add(tag); props.tag = tag;
  }

  // 🏆 HIGH SCORES standing sign, out by the west lawn (the user asked "off to the side")
  const board = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({color: 0x4a3521, roughness: .9});
  const post = new THREE.Mesh(new THREE.CylinderGeometry(.055, .06, 1.9, 8), postMat);
  post.position.set(-.55, .95, 0); board.add(post);
  const post2 = post.clone(); post2.position.x = .55; board.add(post2);
  const panelM = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.15, .08), new THREE.MeshStandardMaterial({color: 0x221833, roughness: .55}));
  panelM.position.y = 1.62; board.add(panelM);
  const marquee2 = new THREE.Mesh(new THREE.PlaneGeometry(1.55, .34),
    new THREE.MeshBasicMaterial({map: signTexture('🏆 HIGH SCORES'), transparent: true}));
  marquee2.position.set(0, 1.86, .05); board.add(marquee2);
  const sub2 = new THREE.Mesh(new THREE.PlaneGeometry(1.55, .68),
    new THREE.MeshBasicMaterial({map: signTexture('tap to view scores\nper minigame', '#fdf3d0'), transparent: true}));
  sub2.position.set(0, 1.42, .05); board.add(sub2);
  board.traverse(o => { o.userData.midway = 'board'; });
  board.position.set(-4.7, 0, -7.6); board.rotation.y = .32; rig.add(board); props.board = board;

  pills = [claw, ...props.bbt, tag, board].filter(Boolean);   // click targets for whatever got built
}
function signTexture(txt, col) {
  const c = document.createElement('canvas'); c.width = 256; c.height = txt.includes('\n') ? 112 : 56;
  const g = c.getContext('2d');
  g.fillStyle = '#0e0a14'; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#f2c14e'; g.lineWidth = 4; g.strokeRect(3, 3, c.width - 6, c.height - 6);
  g.fillStyle = col || '#f2c14e';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const lines = String(txt).split('\n');
  g.font = 'bold 26px Inter,system-ui,sans-serif';
  if (lines.length > 1) g.font = '16px Inter,system-ui,sans-serif';
  lines.forEach((l, i) => g.fillText(l, c.width / 2, c.height * (i + .5) / lines.length));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------- colliders + click targets ----------
const _bv = new THREE.Vector3();
export function walkBalls() {
  const out = [];
  if (props.claw && props.claw.parent) { props.claw.getWorldPosition(_bv); out.push({x: _bv.x, z: _bv.z, r: .95}); }
  for (const b of props.bbt) if (b.parent) { b.getWorldPosition(_bv); out.push({x: _bv.x, z: _bv.z, r: .6}); }
  if (props.tag && props.tag.parent) { props.tag.getWorldPosition(_bv); out.push({x: _bv.x, z: _bv.z, r: .42}); }
  if (props.board && props.board.parent) { props.board.getWorldPosition(_bv); out.push({x: _bv.x, z: _bv.z, r: .55}); }
  return out;
}
export const targets = () => pills;
export function openFrom(obj) {
  const mw = obj && obj.userData && obj.userData.midway;
  if (mw === 'board') { openScores(); return true; }
  if (mw) { openPanel(mw); return true; }
  return false;
}

// ---------- MIDWAY panel scaffolding ----------
export function openPanel(g) {
  if (!panel) return;
  if (g && g !== 'lobby' && !gameOn(g)) g = 'lobby';   // switched off since this prop/tab was open
  if (panel.hidden) panel.hidden = false;
  if (g) tab = g;
  render();
}
function closePanel() { panel.hidden = true; stopGames(); }
function render() {
  if (!panel) return;
  const on = gamesOn();
  if (!on.find(g => g.id === tab)) tab = on.length ? on[0].id : 'lobby';   // stale/off tab → first live one
  panel.innerHTML = `
    <div class="eolMidHead"><b>🎪 Midway</b>
      <span class="eolMidPts">🪙 ${Math.round(Account.points())} pts</span>
      <button id="eolMidX" aria-label="Close">✕</button></div>
    <div class="eolMidTabs">${on.map(g =>
      `<button class="eolMidTab${g.id === tab ? ' on' : ''}" data-t="${g.id}">${g.icon} <span>${esc(gameN(g.id).name || g.name)}</span></button>`).join('')}</div>
    <div id="eolMidwayBody"></div>`;
  panel.querySelector('#eolMidX').onclick = closePanel;
  panel.querySelectorAll('.eolMidTab').forEach(b => b.onclick = () => { stopGames(); tab = b.dataset.t; render(); });
  body = panel.querySelector('#eolMidwayBody');
  paintLobby();
}
function paintLobby() {
  if (!body) return;
  const on = gamesOn();
  if (!on.length) {                     // every minigame switched off — the board + trivia still run
    body.innerHTML = `<p class="eolMidBlurb">${tt('closed')}</p>`;
    return;
  }
  const g = on.find(x => x.id === tab) || on[0];
  const playing = Boolean(g.id === 'claw' || g.id === 'bbt' || g.id === 'tag' || g.id === 'pin');
  const invitedHere = chal.role === 'invited' && chal.game === g.id;
  body.innerHTML = `
    <div class="eolMidSay"></div>
    ${invitedHere ? `<button class="eolMidJoin p">${tt('join')} ${esc(chal.peer && chal.peer.name || '')}</button>` : ''}
    <p class="eolMidBlurb">${g.icon} <b>${esc(gameN(g.id).name || g.name)}</b> — ${esc(gameN(g.id).blurb || g.blurb)}</p>
    <p class="eolMidAward">${tt('lobby')}</p>
    <div class="eolMidBtns">
      ${playing ? `<button class="eolMidPlay p">${tt('play')} ${esc(gameN(g.id).name || g.name)}</button>` : ''}
      ${DUELABLE[g.id] ? `<button class="eolMidSolo">${tt('solo')}</button>
               <button class="eolMidVs p">${tt('duel')}</button>` : ''}
    </div>
    <div class="eolMidFoot">${Account.signed() ? tt('signed')(Account.name()) : tt('unsigned')}</div>`;
  say(sayLast);
  const joinBtn = body.querySelector('.eolMidJoin');
  if (joinBtn) joinBtn.onclick = () => joinChallenge(g.id);
  const play = body.querySelector('.eolMidPlay');
  if (play) play.onclick = () => startGame(tab);
  const solo = body.querySelector('.eolMidSolo');
  if (solo) solo.onclick = () => { chal.role = null; chal.peer = null; chal.game = null; startGame(tab); };
  const vs = body.querySelector('.eolMidVs');
  if (vs) vs.onclick = () => openChallenge(tab);
  const acct = body.querySelector('#eolMidAcct');
  if (acct) acct.onclick = e => { e.preventDefault(); dispatchEvent(new Event('eol:acct-open')); };
}

// done-screen (also where score reporting + awarding happens)
function finishGame(gameId, opts) {
  const {won, score, label, note} = opts || {};
  stopGames();
  if (typeof score === 'number') report(gameId, score, label);   // the ONE report call per finish
  if (won) {
    const mini = rnd(miniItems) || {id: 'agua-fresca', name: 'Agua Fresca'};
    Account.award('mini-' + mini.id, 'Mini ' + mini.name, gameId)
      .then(j => {
        const wait = (j && j.queued) ? tt('pocket') : tt('collect');
        done(tt('prize')(mini.name) + wait);
      })
      .catch(() => done(tt('saveFail')));
  } else done(note || tt('lose'));
  function done(msg) {
    if (!body) return;
    body.innerHTML = `<div class="eolMidDone">${msg}</div>
      <div class="eolMidBtns"><button id="eolMidAgain" class="p">${tt('again')}</button><button id="eolMidHome">${tt('home')}</button></div>`;
    body.querySelector('#eolMidAgain').onclick = () => startGame(gameId);
    body.querySelector('#eolMidHome').onclick = () => { tab = 'lobby'; render(); };
    refreshPts();
  }
}
function refreshPts() { const el = panel && panel.querySelector('.eolMidPts'); if (el) el.textContent = '🪙 ' + Math.round(Account.points()) + ' pts'; }

// ---------- minigame engine (one <canvas> + one shared rAF) ----------
let live = null;                                  // {id, canvas, cx, w, h, step(), draw(), stop()}
const KEYS = new Set();
addEventListener('keydown', e => {
  if (live && panel && !panel.hidden) {
    KEYS.add(e.key);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key) && e.target === document.body) e.preventDefault();
  }
});
addEventListener('keyup', e => KEYS.delete(e.key));
addEventListener('blur', () => KEYS.clear());
let raf = 0, lastT = 0;
function loop(tm) {
  raf = requestAnimationFrame(loop);
  const dt = Math.min(.05, (tm - lastT) / 1000 || .016); lastT = tm;
  if (!live || !panel || panel.hidden) return;
  try { live.step(dt); live.draw(); } catch (err) { console.error('midway game error', err); stopGames(); }
}
raf = requestAnimationFrame(loop);
function stopGames() { if (live) { try { live.stop && live.stop(); } catch (e) {} } live = null; KEYS.clear(); }

function mount() {
  body.innerHTML = `
    <div class="eolMidSay"></div>
    <div class="eolMidStage"><canvas class="eolMidC" width="340" height="240"></canvas></div>
    <div class="eolMidCtl"><button class="eolMidBack">← ${tt('home').replace('← ', '')}</button><span class="eolMidHint"></span></div>`;
  body.querySelector('.eolMidBack').onclick = () => { stopGames(); tab = 'lobby'; render(); };
  say(sayLast);
  const c = body.querySelector('.eolMidC');
  return {canvas: c, cx: c.getContext('2d'), w: 340, h: 240, hint: body.querySelector('.eolMidHint')};
}
function startGame(id) {
  if (!gameOn(id)) { tab = 'lobby'; render(); return; }   // owner switched this game off mid-session
  if (panel.hidden) panel.hidden = false;
  tab = id; render();
  ({claw: clawStart, bbt: bbtStart, tag: tagStart, pin: pinStart, c4: () => c4Start(mode()), ttt: () => tttStart(mode())}[id] || (() => {}))();
}
function mode() { return (chal.role === 'host' || chal.role === 'joined') && chal.game === tab ? 'duel' : 'solo'; }

// ================= 🦞 CLAW MACHINE =================
function clawStart() {
  const u = mount();
  u.hint.textContent = ES() ? '◀ ▶ apuntar · ESPACIO soltar · 3 intentos' : '◀ ▶ aim · SPACE to drop · 3 grabs';
  const pads = [];
  for (let i = 0; i < 6; i++) pads.push({x: 62 + (i % 3) * 104 + (i > 2 ? 14 : 0), y: i > 2 ? 88 : 140, got: false, item: rnd(miniItems) || {name: 'Treat', id: 'agua-fresca'}});
  const st = {pos: .5, dir: Math.random() < .5 ? 1 : -1, phase: 'aim', dropY: 0, tries: 3, hold: null, won: false};
  live = Object.assign(u, {
    id: 'claw',
    step: (dt) => {
      const k = KEYS;
      if (st.phase === 'aim') {
        if (k.has('ArrowLeft')) { st.pos -= dt * .85; st.dir = -1; }
        if (k.has('ArrowRight')) { st.pos += dt * .85; st.dir = 1; }
        st.pos = Math.max(0, Math.min(1, st.pos));
        if (k.has(' ')) { st.phase = 'down'; k.delete(' '); }
      } else if (st.phase === 'down') {
        st.dropY += dt * 105;
        const ty = 60 + st.dropY;
        const grab = pads.find(p => !p.got && Math.abs(p.x - clawX()) < 20 && Math.abs(p.y - ty) < 16);
        if (grab) { st.hold = grab; st.phase = 'up'; }
        else if (st.dropY > 118) { st.phase = 'up'; }
      } else if (st.phase === 'up') {
        st.dropY -= dt * 140;
        if (st.dropY <= 0) {
          if (st.hold) {
            st.hold.got = true; st.won = true;
            finishGame('claw', {won: true, score: 1, label: 'Mini ' + st.hold.item.name});
            return;                                   // finishGame tore down the board
          }
          st.tries--; st.phase = 'aim'; st.dropY = 0;
          if (st.tries <= 0) finishGame('claw', {won: false, score: 0});
        }
      }
    },
    draw: () => {
      const {cx} = live;
      cx.fillStyle = '#141018'; cx.fillRect(0, 0, live.w, live.h);
      cx.fillStyle = '#241b2e'; cx.fillRect(18, 44, live.w - 36, live.h - 84);
      for (const p of pads) if (!p.got) {
        cx.fillStyle = '#f2c14e'; cx.fillRect(p.x - 15, p.y - 10, 30, 20);
        cx.fillStyle = '#14090b'; cx.font = '7.5px sans-serif'; cx.textAlign = 'center';
        cx.fillText(String(p.item.name).slice(0, 10), p.x, p.y + 4);
      }
      const x = clawX(), dy = 60 + st.dropY;
      cx.strokeStyle = '#cbd5e1'; cx.lineWidth = 3;
      cx.beginPath(); cx.moveTo(x, 26); cx.lineTo(x, dy); cx.stroke();
      cx.fillStyle = '#9aa'; cx.beginPath(); cx.arc(x, dy, 7, 0, 7); cx.fill();
      if (st.hold) {
        const p = st.hold;
        cx.fillStyle = '#f2c14e'; cx.fillRect(x - 15, dy + 12, 30, 20);
        cx.fillStyle = '#14090b'; cx.font = '7.5px sans-serif'; cx.textAlign = 'center';
        cx.fillText(String(p.item.name).slice(0, 10), x, dy + 26);
      }
      cx.strokeStyle = '#f2c14e'; cx.lineWidth = 2.5;
      cx.beginPath(); cx.moveTo(x - 8, dy + 2); cx.lineTo(x - 8, dy + 15); cx.moveTo(x + 8, dy + 2); cx.lineTo(x + 8, dy + 15); cx.stroke();
      cx.fillStyle = '#eee'; cx.font = '12px sans-serif'; cx.textAlign = 'left';
      cx.fillText((ES() ? 'Intentos: ' : 'Grabs: ') + Math.max(0, st.tries), 12, 20);
      if (st.phase === 'over') {
        cx.fillStyle = '#0009'; cx.fillRect(0, 0, live.w, live.h);
        cx.fillStyle = '#fff'; cx.textAlign = 'center'; cx.font = 'bold 15px sans-serif';
        cx.fillText(ES() ? 'Sin intentos — ¡la máquina ganó!' : 'Out of grabs — the machine keeps your coins!', live.w / 2 - 40, live.h / 2 - 6);
      }
    },
    stop: () => {},
  });
  function clawX() { return 40 + st.pos * 260; }
}

// ================= 🎯 BEAN-BAG TOSS =================
function bbtStart() {
  const u = mount();
  u.hint.textContent = ES() ? 'toca: fuerza → toca: arco → vuela el costal · anillos 50/25/10'
                            : 'tap: lock power → tap: lock arc → bag flies · rings 50/25/10';
  const st = {round: 0, score: 0, phase: 'power', power: 0, dir: 1, ang: 0, adir: 1, bag: null, lastPts: undefined};
  const judge = () => {                            // single source of scoring truth
    const lx = 170 + Math.sin(st.ang) * (150 + st.power * 130);
    const d = Math.abs(lx - 170);
    return d < 15 ? 50 : d < 32 ? 25 : d < 46 ? 10 : 0;
  };
  live = Object.assign(u, {
    id: 'bbt',
    step: (dt) => {
      if (st.phase === 'power') {
        st.power += st.dir * dt * 1.5;
        if (st.power > 1) { st.power = 1; st.dir = -1; } else if (st.power < 0) { st.power = 0; st.dir = 1; }
      } else if (st.phase === 'angle') {
        st.ang += st.adir * dt * 2.6;
        if (Math.abs(st.ang) > .55) { st.ang = Math.sign(st.ang) * .55; st.adir *= -1; }
      } else if (st.phase === 'fly' && st.bag) {
        st.bag.t += dt * 2.2;
        if (st.bag.t >= 1) { st.phase = 'judged'; st.lastPts = judge(); st.score += st.lastPts; }
      }
    },
    draw: () => {
      const {cx} = live;
      cx.fillStyle = '#141018'; cx.fillRect(0, 0, live.w, live.h);
      cx.fillStyle = '#2a3f27'; cx.fillRect(30, 46, live.w - 60, live.h - 96);
      const bx = 170, by = 84;
      cx.fillStyle = '#3d6b35'; cx.fillRect(bx - 48, by - 44, 96, 86);
      cx.strokeStyle = '#f2c14e'; cx.lineWidth = 2; cx.beginPath(); cx.arc(bx, by, 46, 0, 7); cx.stroke();
      cx.beginPath(); cx.arc(bx, by, 32, 0, 7); cx.stroke();
      cx.strokeStyle = '#e5534a'; cx.beginPath(); cx.arc(bx, by, 15, 0, 7); cx.stroke();
      if (!st.bag || st.phase !== 'fly') {
        cx.fillStyle = '#c78d5e'; cx.fillRect(170 - 9, 208 - 7, 18, 14);
      } else {
        const t = st.bag.t, lift = Math.sin(t * Math.PI) * -36;
        const px = 170 + (st.bag.tx - 170) * t, py = 208 - (208 - by) * t + lift;
        cx.fillStyle = '#c78d5e'; cx.fillRect(px - 8, py - 5, 16, 11);
      }
      cx.fillStyle = '#fff'; cx.font = '12px sans-serif'; cx.textAlign = 'left';
      cx.fillText((ES() ? 'Costal ' : 'Bag ') + Math.min(3, st.round + 1) + '/3 · ' +
        (ES() ? 'Puntos ' : 'Score ') + st.score + (ES() ? ' (necesitas 75)' : ' (need 75)'), 10, 18);
      if (st.phase === 'power') {
        cx.fillStyle = '#2224'; cx.fillRect(50, live.h - 26, 240, 10);
        cx.fillStyle = '#4fd06a'; cx.fillRect(50, live.h - 26, 240 * st.power, 10);
        cx.fillStyle = '#f2c14e'; cx.fillRect(50 + 240 * .55 - 2, live.h - 28, 4, 14);   // 75-point marker
      }
      if (st.phase === 'angle') {
        cx.strokeStyle = '#4fc0d0'; cx.lineWidth = 2;
        cx.beginPath(); cx.moveTo(170, 208); cx.lineTo(170 + Math.sin(-st.ang) * 200, 40); cx.stroke();
      }
      if (st.phase === 'judged' && st.lastPts !== undefined) {
        cx.fillStyle = '#f2c14e'; cx.textAlign = 'center'; cx.font = 'bold 15px sans-serif';
        cx.fillText(st.lastPts ? '+' + st.lastPts : (ES() ? '¡ni al tablero!' : 'just off the board!'), bx, by - 52);
      }
    },
    stop: () => {},
  });
  u.canvas.addEventListener('pointerdown', () => {
    if (st.phase === 'power') st.phase = 'angle';
    else if (st.phase === 'angle') { st.phase = 'fly'; st.bag = {t: 0, tx: 170}; }
    else if (st.phase === 'judged') {
      if (st.round >= 2) {
        const won = st.score >= 75;
        finishGame('bbt', {won, score: st.score,
          note: (ES() ? 'Puntaje final: <b>' : 'Final bean-bag score: <b>') + st.score + '</b>' +
            (ES() ? ' — ¡75+ gana!' : ' — 75+ to win!')});
      } else { st.round++; st.lastPts = undefined; st.phase = 'power'; st.bag = null; }
    }
  });
}

// ================= 🚩 TAG ARENA =================
function tagStart() {
  const u = mount();
  u.hint.textContent = ES() ? 'flechas / WASD para atrapar al corredor — ¡3 toques en 40s!'
                            : 'arrow keys / WASD chase the runner — 3 tags in 40s!';
  const st = {px: 60, py: 120, r: {x: 250, y: 130, jx: 0, jy: 0}, time: 40, tags: 0, burst: [], over: false};
  live = Object.assign(u, {
    id: 'tag',
    step: (dt) => {
      if (st.over) return;
      const v = 128;
      let dx = 0, dy = 0;
      if (KEYS.has('ArrowLeft') || KEYS.has('a')) dx--;
      if (KEYS.has('ArrowRight') || KEYS.has('d')) dx++;
      if (KEYS.has('ArrowUp') || KEYS.has('w')) dy--;
      if (KEYS.has('ArrowDown') || KEYS.has('s')) dy++;
      const l = Math.hypot(dx, dy) || 1;
      st.px += dx / l * v * dt;
      st.py += dy / l * v * dt;
      st.px = Math.max(14, Math.min(live.w - 14, st.px));
      st.py = Math.max(14, Math.min(live.h - 14, st.py));
      const away = Math.atan2(st.r.y - st.py, st.r.x - st.px) + Math.sin(st.time * 3) * 1.25;
      st.r.x += Math.cos(away) * 118 * dt; st.r.y += Math.sin(away) * 118 * dt;
      st.r.x += st.r.jx * dt; st.r.y += st.r.jy * dt;
      st.r.jx *= .9; st.r.jy *= .9;
      st.r.x = Math.max(14, Math.min(live.w - 14, st.r.x));
      st.r.y = Math.max(14, Math.min(live.h - 14, st.r.y));
      st.time -= dt;
      if (Math.hypot(st.r.x - st.px, st.r.y - st.py) < 21) {
        st.tags++;
        st.time = Math.min(40, st.time + 3.5);
        st.r.jx = (Math.random() - .5) * 340; st.r.jy = (Math.random() - .5) * 340;
        st.burst.push({x: st.px, y: st.py, t: .5});
        st.px = 60; st.py = 120;
        if (st.tags >= 3) { st.over = true; finishGame('tag', {won: true, score: 3, note: ES() ? '<b>¡3 toques!</b> ¡Atrapaste al corredor!' : '<b>3 tags!</b> You caught the runner!'}); return; }
      }
      for (const b of st.burst) b.t -= dt;
      st.burst = st.burst.filter(b => b.t > 0);
      if (st.time <= 0 && !st.over) {
        st.over = true;
        finishGame('tag', {won: false, score: st.tags, note: ES() ? '¡Tiempo! <b>' + st.tags + '/3</b> toques.' : 'Time! <b>' + st.tags + '/3</b> tags.'});
      }
    },
    draw: () => {
      const {cx} = live;
      cx.fillStyle = '#141c2b'; cx.fillRect(0, 0, live.w, live.h);
      cx.strokeStyle = '#f2c14e55'; cx.lineWidth = 14; cx.strokeRect(7, 7, live.w - 14, live.h - 14);
      cx.font = '12px sans-serif'; cx.fillStyle = '#fff'; cx.textAlign = 'left';
      cx.fillText('⏱ ' + Math.max(0, st.time).toFixed(1) + 's · ' + (ES() ? 'Toques ' : 'Tags ') + st.tags + '/3', 10, 20);
      for (const b of st.burst) {
        cx.fillStyle = 'rgba(242,193,78,' + (b.t * 2) + ')';
        cx.beginPath(); cx.arc(b.x, b.y, (0.5 - b.t) * 46 + 8, 0, 7); cx.fill();
      }
      cx.fillStyle = '#4fd06a'; cx.beginPath(); cx.arc(st.r.x, st.r.y, 11, 0, 7); cx.fill();
      cx.fillStyle = '#fff'; cx.beginPath(); cx.arc(st.r.x, st.r.y - 1, 4, 0, 7); cx.fill();
      cx.fillStyle = '#e5534a'; cx.beginPath(); cx.arc(st.px, st.py, 12, 0, 7); cx.fill();
      cx.fillStyle = '#ffe'; cx.font = '10px sans-serif'; cx.textAlign = 'center'; cx.fillText('YOU', st.px, st.py + 26);
    },
    stop: () => {},
  });
}

// ================= 🪅 PIÑATA SMASH =================
function pinStart() {
  const u = mount();
  u.hint.textContent = ES() ? "toca cuando la sombra cruce el punto dulce — 5 golpes"
                            : "tap when the bat's shadow crosses the sweet spot — 5 hits!";
  const HUE = ['#e5534a', '#f2c14e', '#53a86e', '#4f76e5', '#d77bd0', '#74dbe6'];
  const confetti = Array.from({length: 80}, () => ({x: 0, y: 0, vx: 0, vy: 0, on: false, c: '#fff'}));
  const st = {phase: 'swing', ang: 0, adir: 1, hits: 0, miss: 0, done: false};
  const pinX = () => 230 + Math.sin(st.ang) * 24;
  const pinY = () => 86 + (1 - Math.abs(Math.cos(st.ang))) * 24;
  live = Object.assign(u, {
    id: 'pin',
    step: (dt) => {
      if (st.phase === 'swing') {
        st.ang += st.adir * dt * 2.0;
        if (Math.abs(st.ang) > 1.2) { st.ang = Math.sign(st.ang) * 1.2; st.adir *= -1; }
      }
      for (const c of confetti) if (c.on) {
        c.x += c.vx * dt; c.y += c.vy * dt; c.vy += 300 * dt; c.vx *= .995;
        if (c.y > live.h) c.on = false;
      }
    },
    draw: () => {
      const {cx} = live;
      cx.fillStyle = '#221a2e'; cx.fillRect(0, 0, live.w, live.h);
      cx.strokeStyle = '#6b5230'; cx.lineWidth = 3;
      cx.beginPath(); cx.moveTo(40, 40); cx.lineTo(300, 40); cx.stroke();
      const px = pinX(), py = pinY() + 30;
      cx.beginPath(); cx.moveTo(170, 40); cx.lineTo(px, py - 16); cx.stroke();
      if (st.hits < 5) {
        cx.fillStyle = st.hits % 2 ? '#53a86e' : '#e5534a';
        cx.beginPath(); cx.ellipse(px, py, 19, 15, 0, 0, 7); cx.fill();
        for (let i = 0; i < 5; i++) {
          cx.strokeStyle = HUE[i % HUE.length]; cx.lineWidth = 2;
          cx.beginPath(); cx.moveTo(px - 18, py - 14 + i * 6); cx.lineTo(px + 18, py - 14 + i * 6); cx.stroke();
        }
        if (st.hits) cx.fillStyle = '#0006', cx.fillRect(px - 8 - st.hits * 4, py - 6, 16 + st.hits * 8, 4);
        cx.fillStyle = '#fff'; cx.font = '13px sans-serif'; cx.textAlign = 'left';
        cx.fillText((ES() ? 'Golpes: ' : 'Hits: ') + st.hits + '/5 · ' + (ES() ? 'Fallados: ' : 'Misses: ') + st.miss, 8, 20);
        const sx = 96 + st.ang * 14, sy = 196;
        cx.fillStyle = '#e4b06a'; cx.fillRect(sx - 8, sy - 24, 16, 26);
        cx.strokeStyle = '#c78d5e'; cx.lineWidth = 4;
        cx.beginPath(); cx.moveTo(sx, sy - 8); cx.lineTo(sx + 40 + st.ang * 6, sy - 40 + st.ang * 22); cx.stroke();
      }
      for (const c of confetti) if (c.on) { cx.fillStyle = c.c; cx.fillRect(c.x, c.y, 4, 7); }
    },
    stop: () => {},
  });
  u.canvas.addEventListener('pointerdown', () => {
    if (st.done) return;
    if (Math.abs(Math.abs(st.ang) - .9) < .32) {          // sweet-spot ring at the swing extremes
      st.hits++;
      const n = st.hits >= 5 ? confetti.length : 14;
      for (let i = 0; i < n; i++) {
        const c = confetti[i];
        c.on = true; c.x = pinX(); c.y = pinY() + 26;
        c.vx = (Math.random() - .5) * 260; c.vy = -30 - Math.random() * 150;
        c.c = HUE[Math.floor(Math.random() * HUE.length)];
      }
      if (st.hits >= 5) {
        st.done = true;
        finishGame('pin', {won: true, score: 1, label: 'Piñata burst'});
      }
    } else st.miss++;
  });
}

// ================= 🔴 CONNECT FOUR =================
function c4Start(m) {
  const u = mount();
  const st = {b: Array(42).fill(0), turn: 1, over: 0};
  const CELL = 44, OX = 22, OY = 38;
  u.hint.textContent = m === 'solo'
    ? (ES() ? '🔴 tú · 🟡 IA — toca una columna' : '🔴 you · 🟡 AI — click a column to drop')
    : (ES() ? '🔴 tú · 🟡 ' + (chal.peer ? chal.peer.name : 'rival') + ' — mueves primero' : '🔴 you · 🟡 ' + (chal.peer ? chal.peer.name : 'rival') + ' — your move first');
  const winAt = (b, p) => {
    for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++)
      for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        let n = 0;
        for (let k = 0; k < 4; k++) {
          const rr = r + dr * k, cc = c + dc * k;
          if (rr < 0 || rr > 5 || cc < 0 || cc > 6 || b[rr * 7 + cc] !== p) break;
          n++;
        }
        if (n === 4) return true;
      }
    return false;
  };
  const drop = (b, c, p) => { for (let r = 5; r >= 0; r--) if (!b[r * 7 + c]) { b[r * 7 + c] = p; return r; } return -1; };
  const aiMove = b => {
    const open = [...Array(7).keys()].filter(c => !b[c]);
    for (const c of open) { const b2 = b.slice(); drop(b2, c, 2); if (winAt(b2, 2)) return c; }
    for (const c of open) { const b2 = b.slice(); drop(b2, c, 1); if (winAt(b2, 1)) return c; }
    const suicide = c => {                            // don't hand the opponent the win row
      const b2 = b.slice(); const r = drop(b2, c, 2);
      if (r >= 0) { drop(b2, c, 1); if (winAt(b2, 1)) return true; }
      return false;
    };
    const pool = open.filter(c => !suicide(c));
    const use = pool.length ? pool : open;
    return use.sort((a, x) => Math.abs(3 - a) - Math.abs(3 - x))[0];
  };
  const endWith = who => {
    st.over = 1;
    if (m === 'duel') { announce('@pa res c4 ' + (who === 'draw' ? 'draw' : visitorName())); chal.role = null; chal.game = null; }
    setTimeout(() => finishGame('c4', {won: who === 'me', score: who === 'me' ? 1 : 0,
      note: who === 'draw' ? (ES() ? '¡Empate parejo!' : TT.en.drawOnly) :
        who === 'me' ? tt('connect') :
        m === 'duel' ? (chal.peer ? esc(chal.peer.name) : 'Rival') + ' ' + (ES() ? 'ganó el duelo.' : 'won the duel.') : tt('aiWon')}), 850);
  };
  const place = (c, p) => {
    if (st.over || c < 0 || c > 6 || drop(st.b, c, p) < 0) return;
    if (m === 'duel') announce('@pa mv c4 ' + c);
    if (winAt(st.b, p)) return endWith(p === 1 ? 'me' : 'them');
    if (st.b.every(v => v)) return endWith('draw');
    st.turn = p === 1 ? 2 : 1;
    if (m === 'solo' && st.turn === 2) setTimeout(() => {
      if (st.over) return;
      drop(st.b, aiMove(st.b), 2);
      if (winAt(st.b, 2)) return endWith('them');
      st.turn = 1;
    }, 460);
  };
  live = Object.assign(u, {
    id: 'c4',
    step: () => {},
    draw: () => {
      const {cx} = live;
      cx.fillStyle = '#1a2440'; cx.fillRect(0, 0, live.w, live.h);
      for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) {
        const x = OX + c * CELL + CELL / 2, y = OY + r * CELL + CELL / 2;
        cx.fillStyle = '#' + (st.b[r * 7 + c] === 1 ? 'e5534a' : st.b[r * 7 + c] === 2 ? 'f2c14e' : '2c3a5c');
        cx.beginPath(); cx.arc(x, y, 17, 0, 7); cx.fill();
      }
      cx.fillStyle = '#fff'; cx.font = '11px sans-serif'; cx.textAlign = 'center';
      if (m === 'duel' && st.turn === 2) cx.fillText(ES() ? 'Pensando el rival…' : 'Rival thinking…', live.w / 2, 22);
    },
    stop: () => {},
  });
  u.canvas.addEventListener('pointerdown', e => {
    if (st.over || (m === 'duel' && st.turn !== 1)) return;
    place(Math.floor((e.offsetX - OX) / CELL), 1);
  });
  _MOVES.c4 = (payload) => {
    if (st.over || st.turn !== 2) return;
    const c = +payload;
    if (c >= 0 && c <= 6) place(c, 2);
  };
}

// ⭕ tic-tac-toe — keeps AI honest but light (win → block → center → corner)
function tttStart(m) {
  const u = mount();
  const st = {b: Array(9).fill(''), turn: 'X', over: 0};
  const GX = 70, GY = 52, GS = 66;
  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  const winner = b => { for (const [a, c, d] of LINES) if (b[a] && b[a] === b[c] && b[c] === b[d]) return b[a]; return b.every(String) ? ' ' : null; };
  u.hint.textContent = m === 'solo'
    ? (ES() ? '❌ tú · ⭕ IA — toca una casilla' : '❌ you · ⭕ AI — click a square')
    : (ES() ? '❌ tú · ⭕ ' + (chal.peer ? chal.peer.name : 'rival') + ' — mueves primero' : '❌ you · ⭕ ' + (chal.peer ? chal.peer.name : 'rival') + ' — your move first');
  const endWith = who => {
    st.over = 1;
    if (m === 'duel') { announce('@pa res ttt ' + (who === 'draw' ? 'draw' : visitorName())); chal.role = null; chal.game = null; }
    setTimeout(() => finishGame('ttt', {won: who === 'me', score: who === 'me' ? 1 : 0,
      note: who === 'draw' ? (ES() ? 'El gato se lo llevó — nadie anota.' : TT.en.cat) :
        who === 'me' ? tt('connect') :
        m === 'duel' ? (chal.peer ? esc(chal.peer.name) : 'Rival') + ' ' + (ES() ? 'ganó el duelo.' : 'won the duel.') : tt('aiWon')}), 850);
  };
  const play = (i, s) => {
    if (st.over || st.b[i]) return;
    st.b[i] = s;
    if (m === 'duel') announce('@pa mv ttt ' + i);
    const w = winner(st.b);
    if (w === s) return endWith(s === 'X' ? 'me' : 'them');
    if (w === ' ') return endWith('draw');
    st.turn = s === 'X' ? 'O' : 'X';
    if (m === 'solo' && st.turn === 'O') setTimeout(() => {
      if (st.over) return;
      const pick = () => {
        for (const [a, c, d] of LINES) for (const p of ['O', 'X']) {
          const trio = [a, c, d];
          if (trio.filter(t => st.b[t] === p).length === 2) {
            const e = trio.find(t => !st.b[t]);
            if (e !== undefined) return e;
          }
        }
        if (!st.b[4]) return 4;
        const corners = [0, 2, 6, 8].filter(c => !st.b[c]);
        if (corners.length) return rnd(corners);
        return st.b.indexOf('');
      };
      st.b[pick()] = 'O';
      const w2 = winner(st.b);
      if (w2 === 'O') return endWith('them');
      if (w2 === ' ') return endWith('draw');
      st.turn = 'X';
    }, 380);
  };
  live = Object.assign(u, {
    id: 'ttt',
    step: () => {},
    draw: () => {
      const {cx} = live;
      cx.fillStyle = '#2b2130'; cx.fillRect(0, 0, live.w, live.h);
      cx.strokeStyle = '#8b77a5'; cx.lineWidth = 4;
      for (let i = 1; i < 3; i++) {
        cx.beginPath(); cx.moveTo(GX + i * GS, GY); cx.lineTo(GX + i * GS, GY + GS * 3); cx.stroke();
        cx.beginPath(); cx.moveTo(GX, GY + i * GS); cx.lineTo(GX + GS * 3, GY + i * GS); cx.stroke();
      }
      for (let i = 0; i < 9; i++) {
        const x = GX + (i % 3) * GS + GS / 2, y = GY + Math.floor(i / 3) * GS + GS / 2;
        cx.strokeStyle = st.b[i] === 'X' ? '#e5534a' : '#f2c14e'; cx.lineWidth = 6;
        if (st.b[i] === 'X') {
          cx.beginPath(); cx.moveTo(x - 18, y - 18); cx.lineTo(x + 18, y + 18);
          cx.moveTo(x + 18, y - 18); cx.lineTo(x - 18, y + 18); cx.stroke();
        } else if (st.b[i] === 'O') { cx.beginPath(); cx.arc(x, y, 19, 0, 7); cx.stroke(); }
      }
    },
    stop: () => {},
  });
  u.canvas.addEventListener('pointerdown', e => {
    if (st.over || (m === 'duel' && st.turn !== 'X')) return;
    const i = Math.floor((e.offsetX - GX) / GS) + 3 * Math.floor((e.offsetY - GY) / GS);
    if (i >= 0 && i < 9) play(i, 'X');
  });
  _MOVES.ttt = (payload) => {
    if (st.over || st.turn !== 'O') return;
    play(+payload, 'O');
  };
}

// ---------- opponent move dispatch + duel end ----------
const _MOVES = {};                                // game id -> handler assigned inside *_Start
function applyOpponentMove(g, payload) { const f = _MOVES[g]; if (f) f(payload); }
function duelEnd(g, who, winnerName) {
  chal.role = null; chal.game = null;
  const peer = (chal.peer && chal.peer.name) || 'Rival';
  chal.peer = null;
  const D = tt('duelEnd');
  const msg = who === 'me' ? D.me(peer) : who === 'draw' ? D.draw(peer) : D.them(winnerName, peer);
  say(msg);
  finishGame(g, {won: who === 'me', score: who === 'me' ? 1 : 0, note: msg});
}

// ---------- 🏆 HIGH SCORES panel (board prop opens this) ----------
let scorePanel = null;
const SC_T = {
  en: {head: '🏆 HIGH SCORES', refresh: '↺ Refresh', last: 'last', leader: 'shelf leader', shelf: '🏅 Junior prize shelf', king: '🪙 Trivia points king'},
  es: {head: '🏆 MEJORES PUNTAJES', refresh: '↺ Actualizar', last: 'último', leader: 'líder del estante', shelf: '🏅 Estante de premios', king: '🪙 Rey de puntos de trivia'},
};
function openScores() {
  if (!scorePanel) {
    scorePanel = document.createElement('div');
    scorePanel.id = 'eolScores'; scorePanel.hidden = true;
    document.body.appendChild(scorePanel);
  }
  scorePanel.hidden = false;
  fetch('/api/scores').then(r => r.json()).then(j => paintScores(j)).catch(() => paintScores(null));
}
function closeScores() { if (scorePanel) scorePanel.hidden = true; }
function paintScores(j) {
  if (!scorePanel || scorePanel.hidden) return;
  const L = SC_T[ES() ? 'es' : 'en'];
  const row = (k, icon) => {
    const d = (j || {})[k] || {};
    const best = d.best || {};
    const last = d.last || {};
    const hold = d.holder ? (d.holder.name + ' · ' + d.holder.wins + ' ' + (ES() ? 'victorias' : 'wins')) : null;
    return `<div class="eolScoreRow"><div class="eolScoreL"><b>${icon} ${esc(gameN(k).name || k)}</b>` +
      (hold ? `<i>${L.leader}: ${esc(hold)}</i>` : '') + `</div>` +
      `<div class="eolScoreR"><span>🏆 ${esc(best.name || '—')} <b>${best.value ?? ''}</b></span>` +
      `<span>🕐 ${L.last}: ${esc(last.name || '—')}</span></div></div>`;
  };
  const rows = [['hotdog', '🌭'], ['claw', '🦞'], ['bbt', '🎯'], ['tag', '🚩'], ['c4', '🔴'], ['ttt', '⭕'], ['pin', '🪅']]
    .filter(([k]) => (k === 'hotdog' ? HOTDOG_ON() : gameOn(k)));   // switched-off games don't get rows
  scorePanel.innerHTML = `<div class="eolScoreHead"><b>${L.head}</b><button id="eolScoreX" aria-label="Close">✕</button></div>` +
    `<div class="eolScoreRows">` +
    rows.map(([k, icon]) => row(k, icon)).join('') +
    (j && j.collection && j.collection.holder ? `<div class="eolScoreRow big"><div class="eolScoreL"><b>${L.shelf}</b></div><div class="eolScoreR"><span>${esc(j.collection.holder)} · ${j.collection.count}</span></div></div>` : '') +
    (j && j.points && j.points.holder ? `<div class="eolScoreRow big"><div class="eolScoreL"><b>${L.king}</b></div><div class="eolScoreR"><span>${esc(j.points.holder)} · 🪙 ${Math.round(j.points.points)}</span></div></div>` : '') +
    `</div><div class="eolScoreFoot"><button id="eolScoreRef">${L.refresh}</button></div>`;
  scorePanel.querySelector('#eolScoreX').onclick = closeScores;
  scorePanel.querySelector('#eolScoreRef').onclick = openScores;
}

// ---------- init + tick ----------
export function init(params) {
  if (!MIDWAY_ON()) return;   // owner switched the whole Midway off: no props, no panel, no listeners —
                              // targets()/walkBalls() stay empty so scene.js click/walk code is inert
  S = params.scene; rig = params.rig; MENU = params.menu || {categories: []};
  miniItems = (MENU.categories || []).flatMap(c => c.items || []).filter(i => i && i.id && i.name);
  clockNow().then(n => { clockSkew = n - Date.now(); }).catch(() => {});
  panel = document.createElement('div');
  panel.id = 'eolMidway'; panel.hidden = true;
  document.body.appendChild(panel);
  buildProps();
  render();
  setInterval(() => {
    if (chal.role === 'invited' && Date.now() > chal.deadline) {
      chal.role = null; chal.game = null; chal.peer = null;
      if (tab === 'lobby') say('');
    }
    if (myRooms && Object.keys(myRooms).length) { /* host rooms expire naturally with chal */ }
    refreshPts();
  }, 4000);
  addEventListener('eol:acct-ready', () => refreshPts());
  addEventListener('eol:account-updated', () => refreshPts());
  addEventListener('eol:lang', () => { if (panel && !panel.hidden) render(); });
}
export function tick(dt, t) {
  if (props.claw && props.claw.userData.arm) props.claw.userData.arm.rotation.y = Math.sin(t * .9) * .16;
  if (props.tag) {
    const f = props.tag.children.find(o => o.userData.flag);
    if (f) { f.rotation.y = Math.sin(t * 3 + 1) * .45; f.rotation.x = .15 + Math.sin(t * 2.2) * .1; }
  }
}
