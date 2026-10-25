// hotdog.js — the "hot dog eating contest" mini game: tap a lawn table (or the 🌭 pill)
// to play. Solo runs the bite-dial against your own best. "Challenge everyone" posts an open
// call over the live avatar-chat channel (a tagged control line the panel peels off — never
// shown as chat), other visitors get a Join countdown, everyone's dial starts on the same
// server-clock moment, and the final counts come back over that channel for a small board.
// The game: a marker sweeps a ring, you time an EAT! press to land it in the pink bite zone —
// three clean bites swallow a dog, a miss costs a jaw-lockout, so rhythm beats mashing.
// Plain DOM + one small canvas; the 3D scene never has to drop a frame for a contest.
import {announce, clockNow, visitorName, HD} from './avatars.js?v=4';

const DUR = 60;         // seconds per round
const COLLECT_MS = 25000;
const BEST_KEY = 'eol-hd-best';
const DOGS_TO = 3;      // bites per dog

function reportHotdog(dogs) {                      // every contest result feeds /api/scores
  let phone = '';
  try { const a = JSON.parse(localStorage.getItem('eolAcct') || 'null'); if (a && a.phone) phone = a.phone; } catch (e) {}
  try { fetch('/api/score', {method: 'POST', headers: {'Content-Type': 'application/json'}, keepalive: true,
    body: JSON.stringify({game: 'hotdog', value: dogs, name: visitorName(), phone})}).catch(() => {}); } catch (e) {}
}
const ZONE = 0.42;      // bite-zone half-width in radians

const UP = Math.PI * 1.5;   // zone center = top of the dial

let panel, pill, body, dial, eatBtn, timerEl, dogsEl;
let mode = 'idle';       // idle | lobby | countdown | playing | scoring
let round = null;        // {startAt, endsAt, solo, isMine, bite, dogs, lockUntil}
let results = null;      // Map id -> {name, dogs}
let theta = 0, last = 0, tickRaf = 0, cdPoll = 0, collectPoll = 0;
let menuOpen = false, panelWasOpen = false;   // the ordering menu overlays these chips

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const normA = a => { a = (a % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); return a > Math.PI ? a - 2 * Math.PI : a; };

export function init() {
  pill = document.createElement('button');
  pill.id = 'eolHdPill'; pill.textContent = '🌭 Contest';
  pill.title = 'Hot dog eating contest — solo or against everyone';
  document.body.appendChild(pill);

  panel = document.createElement('div');
  panel.id = 'eolHd'; panel.hidden = true;
  panel.innerHTML = `
    <div class="eolHdHead"><b>🌭 Hot Dog Contest</b><button id="eolHdX" aria-label="Close">✕</button></div>
    <div id="eolHdBody"></div>`;
  document.body.appendChild(panel);
  body = panel.querySelector('#eolHdBody');
  pill.onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden && mode === 'idle') toLobby(); };
  panel.querySelector('#eolHdX').onclick = () => { Hardcancel(); panel.hidden = true; };
  addEventListener('eol:hd-open-table', () => { if (menuOpen) return; panel.hidden = false; if (mode === 'idle') toLobby(); });
  // the ordering menu is a full-screen overlay: tuck the contest chip + panel out of the way
  // while it's up (a mid-round game keeps running underneath), restore on close.
  addEventListener('eol:menu-open', () => {
    menuOpen = true; panelWasOpen = !panel.hidden;
    pill.hidden = true; panel.hidden = true;
  });
  addEventListener('eol:menu-close', () => { menuOpen = false; pill.hidden = false; panel.hidden = panelWasOpen; });
  addEventListener(HD.EVENT, ev => onTraffic(ev.detail || {}));
  addEventListener('keydown', e => {
    if (e.key === ' ' && mode === 'playing' && !panel.hidden) { e.preventDefault(); attempt(); }
  });
}

function Hardcancel() {
  if (tickRaf) cancelAnimationFrame(tickRaf); tickRaf = 0;
  if (cdPoll) clearInterval(cdPoll); cdPoll = 0;
  if (collectPoll) clearInterval(collectPoll); collectPoll = 0;
  round = null; results = null;
  mode = 'idle';
}

function toLobby() {
  Hardcancel();
  mode = 'lobby';
  body.innerHTML = `<p class="eolHdMuted">Extra mustard, no cheating. Solo runs the bite-dial against your own best
    (<b class="eolHdBest">${+(localStorage.getItem(BEST_KEY) || 0)}</b> dogs). <b>Challenge everyone</b> drops a 14-second join
    call over the festival chat, then the whole lot eats at once.</p>
    <div class="eolHdButtons">
      <button class="eolHdSolo">Solo run</button>
      <button class="eolHdVs p">Challenge everyone</button>
    </div><div class="eolHdLobby"></div>`;
  body.querySelector('.eolHdSolo').onclick = solo;
  body.querySelector('.eolHdVs').onclick = openCall;
}

function solo() {
  Hardcancel();
  round = {startAt: Date.now() + 3200, solo: true, isMine: true, bite: 0, dogs: 0, lockUntil: 0};
  mode = 'countdown';
  cdPoll = setInterval(pollCountdown, 250);
}

async function openCall() {
  Hardcancel();
  const serverNow = await clockNow(), skew = serverNow - Date.now();
  round = {startAt: Date.now() + skew + 14000, solo: false, isMine: true, bite: 0, dogs: 0, lockUntil: 0, joins: new Map()};
  announce('@hd open ' + Math.round(round.startAt));
  mode = 'countdown';
  cdPoll = setInterval(pollCountdown, 250);
}

function onTraffic({id, name, text}) {
  const parts = String(text || '').trim().split(/\s+/);
  const cmd = parts[0], arg1 = +parts[1] || 0;
  if (cmd === 'open') {
    if (arg1 < Date.now() + 2500) return;   // stale broadcast from before this page load
    Hardcancel();
    round = {startAt: arg1, solo: false, isMine: false, host: name || 'Someone', bite: 0, dogs: 0, lockUntil: 0, joins: new Map()};
    mode = 'countdown';
    if (menuOpen) panelWasOpen = true;   // menu has us covered; the panel pops back on close
    else panel.hidden = false;
    body.innerHTML = `<p><b>${esc(round.host)}</b> opened a hot dog contest — eating starts in
      <b class="eolHdCd">${Math.max(0, Math.round((round.startAt - Date.now()) / 1000))}</b>s.</p>
      <div class="eolHdButtons"><button class="eolHdJoin p">Join the contest</button>
      <button class="eolHdSkip">Just watch</button></div>
      <p class="eolHdMuted eolHdRoster">Roster:</p>`;
    let joined = false;
    const joinBtn = body.querySelector('.eolHdJoin');
    joinBtn.onclick = () => {
      if (joined) return;
      joined = true;
      round.isMine = true;
      announce('@hd join ' + visitorName());
      joinBtn.textContent = 'You’re in!';
    };
    body.querySelector('.eolHdSkip').onclick = () => { joined = true; joinBtn.textContent = 'Watching'; };
    cdPoll = setInterval(pollCountdown, 250);
  } else if (cmd === 'join' && round && round.isMine && !round.solo) {
    if (round.joins && !round.joins.has(id)) {
      round.joins.set(id, name || 'Visitor');
      const roster = body.querySelector('.eolHdRoster');
      if (roster) roster.textContent = 'Roster: ' + [...round.joins.values()].map(esc).join(', ');
    }
  } else if (cmd === 'result' && results) {
    const n = parseInt(parts[1], 10);
    if (!isNaN(n) && n >= 0 && n < 999) {
      results.set(id, {name: name || 'Visitor', dogs: n});
      if (mode === 'scoring') paintBoard();
    }
  }
}

function pollCountdown() {
  if (!round || mode !== 'countdown') { if (cdPoll) clearInterval(cdPoll); cdPoll = 0; return; }
  const left = Math.max(0, round.startAt - Date.now());
  const cd = body.querySelector('.eolHdCd');
  if (cd) cd.textContent = Math.ceil(left / 1000);
  if (left <= 0) startRound();
}

function startRound() {
  if (cdPoll) clearInterval(cdPoll); cdPoll = 0;
  mode = 'playing';
  round.endsAt = round.startAt + DUR * 1000;
  results = round.solo ? null : new Map();
  if (!round.solo) results.set('me', {name: visitorName() + ' (you)', dogs: 0});
  theta = 0; last = 0;
  body.innerHTML = `
    <div class="eolHdMeter"><span class="eolHdDogs">0 dogs</span><b class="eolHdLeft">${DUR}.0s</b></div>
    <canvas class="eolHdDial" width="250" height="168"></canvas>
    <div class="eolHdButtons"><button class="eolHdEat p">EAT!</button><span class="eolHdMuted">· or press space</span></div>`;
  dial = body.querySelector('.eolHdDial'); eatBtn = body.querySelector('.eolHdEat');
  timerEl = body.querySelector('.eolHdLeft'); dogsEl = body.querySelector('.eolHdDogs');
  eatBtn.onclick = attempt;
  eatBtn.focus();
  drawDial(0);
  tickRaf = requestAnimationFrame(tickLoop);
}

function attempt() {
  if (mode !== 'playing' || !eatBtn || !round) return;
  const now = performance.now();
  if (now < (round.lockUntil || 0)) return;
  if (Math.abs(normA(theta - UP)) <= ZONE) {
    round.bite++;
    if (round.bite >= DOGS_TO) {
      round.bite = 0; round.dogs++;
      dogsEl.textContent = round.dogs + ' dog' + (round.dogs === 1 ? '' : 's');
      if (!round.solo && results) results.set('me', {name: visitorName() + ' (you)', dogs: round.dogs});
    }
  } else {
    round.bite = 0; round.lockUntil = now + 430;
    eatBtn.classList.add('eolHdMiss');
    setTimeout(() => eatBtn.classList.remove('eolHdMiss'), 300);
  }
}

function tickLoop() {
  if (mode !== 'playing') { tickRaf = 0; return; }
  tickRaf = requestAnimationFrame(tickLoop);
  const now = performance.now(), dt = Math.min(.08, (now - last) / 1000 || .016);
  last = now;
  theta = (theta + dt * 3.35) % (2 * Math.PI);
  drawDial(theta);
  const left = Math.max(0, round.endsAt - Date.now()) / 1000;
  timerEl.textContent = left.toFixed(1) + 's';
  if (left <= 0) finish();
}

function drawDial(th) {
  if (!dial) return;
  const c = dial.getContext('2d'), w = dial.width, h = dial.height, cx = w / 2, cy = h * 1.28, R = h * 1.05;
  c.clearRect(0, 0, w, h);
  // the upper half of a ring; the pink bite zone straddles its top
  c.lineWidth = 15; c.lineCap = 'butt';
  c.strokeStyle = 'rgba(255,255,255,.16)';
  c.beginPath(); c.arc(cx, cy, R, Math.PI, 2 * Math.PI); c.stroke();
  c.strokeStyle = Math.sin(performance.now() / 260) > 0.4 ? '#e83a73' : '#f0699a';
  c.beginPath(); c.arc(cx, cy, R, UP - ZONE, UP + ZONE); c.stroke();
  // the marker rides the ring; hits only count inside the zone anyway
  const mx = cx + Math.cos(th) * R, my = cy + Math.sin(th) * R;
  if (my < cy + 4) {   // draw only while the marker is on the visible upper arc
    c.fillStyle = '#39d0ff';
    c.beginPath(); c.arc(mx, my, 9, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#0b141c';
    c.beginPath(); c.arc(mx, my, 4, 0, Math.PI * 2); c.fill();
  }
  // bites remaining for the current dog
  c.fillStyle = '#f6e7c8'; c.font = 'bold 20px Inter'; c.textAlign = 'center';
  const label = round.bite ? 'bite ' + (round.bite + 1) + '/' + DOGS_TO : 'next dog!';
  c.fillText(label, cx, h - 26);
}

function finish() {
  if (mode !== 'playing' || !round) return;
  mode = 'scoring';
  if (tickRaf) cancelAnimationFrame(tickRaf); tickRaf = 0;
  const mine = round.dogs || 0;
  reportHotdog(mine);   // → HIGH SCORES board by the truck + the trivia bot's live-score questions
  if (!round.solo) {
    announce('@hd result ' + mine);
    results = results || new Map();
    results.set('me', {name: visitorName() + ' (you)', dogs: mine});
    round.collectUntil = Date.now() + COLLECT_MS;
    collectPoll = setInterval(paintBoard, 2000);
    paintBoard();
  } else {
    const keys = 'eol-hd-best';
    const best = Math.max(+(localStorage.getItem(keys) || 0), mine);
    try { localStorage.setItem(keys, String(best)); } catch (e) {}
    body.innerHTML = `<p><b>${mine} dogs</b> — personal best ${best}.</p>
      <div class="eolHdButtons"><button class="eolHdAgain p">Run again</button></div>`;
    body.querySelector('.eolHdAgain').onclick = solo;
  }
}

function paintBoard() {
  if (mode !== 'scoring' || !round || round.solo) { if (collectPoll) clearInterval(collectPoll); collectPoll = 0; return; }
  const rows = [...results.entries()].map(([id, r]) => ({id, ...r}));
  rows.sort((a, b) => b.dogs - a.dogs);
  const open = Date.now() < (round.collectUntil || 0);
  const doneAll = rows.length >= 2 && !open;
  body.innerHTML = `<p>${rows.length < 2 && open ? 'Collecting the eaters’ counts…' : 'Final board:'}</p>
    <div class="eolHdBoard">${rows.slice(0, 6).map((r, i) =>
      `<div><b>${['🥇', '🥈', '🥉'][i] || (i + 1) + '.'}</b> ${esc(r.name)} — <b>${r.dogs}</b> dogs</div>`).join('')}</div>
    <div class="eolHdButtons">${doneAll ? '<button class="eolHdAgain p">New round</button>' :
      '<span class="eolHdMuted">Eaters still spotting up…</span>'}</div>`;
  const again = body.querySelector('.eolHdAgain');
  if (again) again.onclick = openToEnd;
  if (open && Date.now() > (round.announced || 0) && rows[0].dogs > 0) {
    round.announced = Date.now();
    try { fetch('/api/chat', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({id: localStorage.getItem('eol-visitor-id') || '', text: `🏆 ${rows[0].name} leads with ${rows[0].dogs} dogs (running)`})}); } catch (e) {}
  }
}
function openToEnd() {
  if (collectPoll) clearInterval(collectPoll); collectPoll = 0;
  toLobby();
}
init();
