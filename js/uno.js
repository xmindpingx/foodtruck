// uno.js — 🃏 UNO multiplayer, drop in / drop out anytime. Tap the UNO table on the lot to
// open the lobby; create or join a room, and the game starts when 2+ players are in. Players
// can leave mid-hand (their cards are discarded, turn advances) and new players can join mid-game
// (dealt a hand from the deck). Polls /api/uno/room every 2s so everyone stays in sync.
import {CONFIG} from './shop.js?v=8';
import * as Account from './account.js?v=8';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const COLORS = {red: '#e53935', blue: '#1e88e5', green: '#43a047', yellow: '#fdd835', wild: '#222'};
const GLYPH = {skip: '⊘', reverse: '⇄', draw2: '+2', wild: 'W', wild4: '+4'};

let panel, body, roomId = null, myVid = '', myName = '', pollT = 0, lastState = null, menuOpen = false, panelWasOpen = false;

function vid() { return myVid || (myVid = 'v' + Math.random().toString(36).slice(2, 10)); }
function name() { return myName || (myName = (localStorage.getItem('eol-visitor-name') || 'Player').slice(0, 24)); }

function init() {
  if (!CONFIG || CONFIG.gameUnoOn === false) return;
  buildUI();
  addEventListener('eol:uno-open', () => { if (menuOpen) return; panel.hidden = false; showLobby(); });
  addEventListener('eol:menu-open', () => { menuOpen = true; panelWasOpen = !panel.hidden; panel.hidden = true; });
  addEventListener('eol:menu-close', () => { menuOpen = false; panel.hidden = panelWasOpen; if (!panel.hidden) tick(); });
}

function buildUI() {
  panel = document.createElement('div');
  panel.id = 'eolUno'; panel.hidden = true;
  panel.style.cssText = 'position:fixed;inset:0;z-index:80;display:none;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,.92);backdrop-filter:blur(4px);font:13px/1.4 Inter,sans-serif;color:#f6e7c8';
  panel.innerHTML = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <b style="font-size:16px">🃏 UNO</b>
      <span id="unoStatus" style="opacity:.7;font-size:12px"></span>
      <button id="unoX" style="margin-left:auto;background:none;border:0;color:#f6e7c8;font-size:18px;cursor:pointer">✕</button></div>
    <div id="unoBody" style="width:min(92vw,720px);max-height:76vh;overflow:auto;background:#141021;border:1px solid rgba(242,193,78,.3);border-radius:14px;padding:12px"></div>`;
  document.body.appendChild(panel);
  body = panel.querySelector('#unoBody');
  panel.querySelector('#unoX').onclick = () => { panel.style.display = 'none'; panel.hidden = true; if (pollT) { clearInterval(pollT); pollT = 0; } };
}

function showLobby() {
  panel.hidden = false; panel.style.display = 'flex';
  if (pollT) { clearInterval(pollT); pollT = 0; }
  roomId = null; lastState = null;
  body.innerHTML = `<div style="display:flex;gap:8px;margin-bottom:10px">
      <button id="unoCreate" style="padding:8px 14px;border-radius:10px;border:1px solid rgba(242,193,78,.5);background:rgba(242,193,78,.15);color:#f6e7c8;cursor:pointer;font:600 13px Inter">Create a table</button>
      <button id="unoRefresh" style="padding:8px 14px;border-radius:10px;border:1px solid #444;background:#1a1a2e;color:#f6e7c8;cursor:pointer;font:600 13px Inter">Refresh</button></div>
    <div id="unoRooms"></div>`;
  body.querySelector('#unoCreate').onclick = createRoom;
  body.querySelector('#unoRefresh').onclick = listRooms;
  listRooms();
}

async function listRooms() {
  try {
    const r = await fetch('/api/uno/rooms', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'}).then(x => x.json());
    const el = body.querySelector('#unoRooms');
    if (!r.rooms || !r.rooms.length) { el.innerHTML = '<p style="opacity:.6">No open tables — create one!</p>'; return; }
    el.innerHTML = r.rooms.map(rm => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;margin:4px 0;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:rgba(30,22,40,.6)">
      <div><b>${esc(rm.name)}</b> <span style="opacity:.6;font-size:11px">(${rm.players}/8 · ${rm.status})</span></div>
      <button data-id="${rm.id}" style="padding:6px 12px;border-radius:8px;border:1px solid #43a047;background:rgba(67,160,71,.2);color:#f6e7c8;cursor:pointer;font:600 12px Inter">Join</button></div>`).join('');
    el.querySelectorAll('button[data-id]').forEach(b => b.onclick = () => joinRoom(b.dataset.id));
  } catch (e) { body.querySelector('#unoRooms').innerHTML = '<p style="color:#ff6b6b">Network hiccup.</p>'; }
}

async function createRoom() {
  try {
    const r = await fetch('/api/uno/create', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: 'UNO table', vid: vid(), pname: name()})}).then(x => x.json());
    if (!r.ok) throw new Error(r.error);
    roomId = r.id; enterRoom();
  } catch (e) { alert(e.message || 'Could not create.'); }
}

async function joinRoom(id) {
  try {
    const r = await fetch('/api/uno/join', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({room: id, vid: vid(), pname: name()})}).then(x => x.json());
    if (!r.ok) throw new Error(r.error);
    roomId = id; enterRoom();
  } catch (e) { alert(e.message || 'Could not join.'); }
}

function enterRoom() {
  panel.hidden = false; panel.style.display = 'flex';
  if (pollT) clearInterval(pollT);
  pollT = setInterval(tick, 2000);
  tick();
}

async function tick() {
  if (!roomId) return;
  try {
    const r = await fetch('/api/uno/room', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({room: roomId, vid: vid()})}).then(x => x.json());
    if (!r.ok) { if (r.error === 'room not found') { roomId = null; showLobby(); } return; }
    lastState = r;
    renderRoom(r);
  } catch (e) {}
}

function cardHtml(c, playable) {
  const col = COLORS[c.color] || '#555';
  const val = c.value;
  const disp = (val === 'skip' ? '⊘' : val === 'reverse' ? '⇄' : val === 'draw2' ? '+2' :
                val === 'wild' ? 'W' : val === 'wild4' ? '+4' : val);
  return `<div style="display:inline-flex;align-items:center;justify-content:center;width:46px;height:68px;
    border-radius:8px;background:${col};color:${c.color === 'yellow' ? '#222' : '#fff'};font:700 18px Inter,sans-serif;
    box-shadow:0 2px 6px rgba(0,0,0,.4);margin:3px;cursor:${playable ? 'pointer' : 'default'};
    border:2px solid ${playable ? '#fff' : 'transparent'};opacity:${playable ? 1 : .85};
    transform:${playable ? 'translateY(-2px)' : 'none'}">${disp}</div>`;
}

function renderRoom(r) {
  const st = panel.querySelector('#unoStatus');
  const isMyTurn = r.turnId === vid();
  st.textContent = r.status === 'finished' ? ('Winner: ' + (r.players.find(p => p.id === r.winner) || {}).name)
    : (isMyTurn ? 'YOUR TURN' : ((r.players[r.turn] || {}).name || '') + "'s turn");
  const top = r.top;
  const topHtml = top ? cardHtml(top, false) : '';
  const colorDot = `<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${COLORS[r.color] || '#888'};vertical-align:middle;margin-left:6px;border:2px solid #fff"></span>`;
  const others = r.players.filter(p => p.id !== vid()).map(p =>
    `<div style="padding:4px 8px;border-radius:8px;background:${p.id === r.turnId ? 'rgba(242,193,78,.25)' : 'rgba(30,22,40,.6)'};font-size:12px">
      ${esc(p.name)} <span style="opacity:.6">(${p.count})</span>${p.uno ? ' 🃏' : ''}</div>`).join('');
  const playable = (card, i) => r.status === 'playing' && isMyTurn && _canPlay(card, r);
  const handHtml = (r.hand || []).map((c, i) => cardHtml(c, playable(c, i))).replace('>', ` data-i="${i}">`).join('');
  body.innerHTML = `
    <div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">
      <div style="flex:1;min-width:200px">
        <div style="opacity:.7;font-size:11px;margin-bottom:4px">Discard ${colorDot}</div>
        <div style="min-height:76px">${topHtml}</div>
        ${r.drawStack ? `<div style="color:#ff6b6b;font:700 12px Inter;margin-top:4px">Draw ${r.drawStack}!</div>` : ''}
        <div style="margin-top:8px;font-size:11px;opacity:.6">${r.players.length} players · deck ${r.deck}</div>
        <div style="display:flex;flex-direction:column;gap:4px;margin-top:8px">${others}</div>
      </div>
      <div style="flex:2;min-width:260px">
        <div style="opacity:.7;font-size:11px;margin-bottom:4px">Your hand (${(r.hand || []).length})</div>
        <div id="unoHand" style="display:flex;flex-wrap:wrap">${handHtml}</div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button id="unoDraw" style="padding:8px 14px;border-radius:10px;border:1px solid #444;background:#1a1a2e;color:#f6e7c8;cursor:pointer;font:600 12px Inter" ${isMyTurn ? '' : 'disabled'}>Draw</button>
          <button id="unoUno" style="padding:8px 14px;border-radius:10px;border:1px solid #fdd835;background:rgba(253,216,53,.15);color:#f6e7c8;cursor:pointer;font:600 12px Inter" ${isMyTurn ? '' : 'disabled'}>UNO!</button>
          <button id="unoLeave" style="padding:8px 14px;border-radius:10px;border:1px solid #e5534a;background:rgba(229,83,83,.15);color:#f6e7c8;cursor:pointer;font:600 12px Inter">Leave</button>
        </div>
        ${r.status === 'finished' ? `<button id="unoAgain" style="margin-top:8px;padding:8px 14px;border-radius:10px;border:1px solid #43a047;background:rgba(67,160,71,.2);color:#f6e7c8;cursor:pointer;font:600 12px Inter">New game</button>` : ''}
      </div>
    </div>`;
  // bind hand clicks
  body.querySelectorAll('#unoHand > div').forEach(el => {
    el.onclick = () => {
      const i = +el.dataset.i;
      const card = (r.hand || [])[i];
      if (!card) return;
      if (card.color === 'wild' || card.value === 'wild4') {
        const col = prompt('Pick a color: red / blue / green / yellow', 'red');
        playCard(i, col || 'red');
      } else playCard(i, '');
    };
  });
  const drawBtn = body.querySelector('#unoDraw');
  if (drawBtn) drawBtn.onclick = drawCard;
  const unoBtn = body.querySelector('#unoUno');
  if (unoBtn) unoBtn.onclick = callUno;
  const leaveBtn = body.querySelector('#unoLeave');
  if (leaveBtn) leaveBtn.onclick = leaveRoom;
  const againBtn = body.querySelector('#unoAgain');
  if (againBtn) againBtn.onclick = () => {
    fetch('/api/uno/create', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: 'UNO table', vid: vid(), pname: name()})}).then(x => x.json()).then(rr => {
        if (rr.ok) { roomId = rr.id; enterRoom(); }
      });
  };
  if (r.status === 'lobby' && r.players.length >= 2) {
    // auto-start
    fetch('/api/uno/start', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({room: roomId, vid: vid()})}).then(() => tick());
  }
}

function _canPlay(card, r) {
  if (card.color === 'wild') return true;
  if (card.color === r.color) return true;
  if (card.value === r.value && r.value !== 'wild' && r.value !== 'wild4') return true;
  return false;
}

async function playCard(idx, color) {
  try {
    const r = await fetch('/api/uno/play', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({room: roomId, vid: vid(), idx, color})}).then(x => x.json());
    if (!r.ok) { alert(r.error || 'Cannot play'); return; }
    tick();
  } catch (e) { alert('Network hiccup'); }
}

async function drawCard() {
  try {
    const r = await fetch('/api/uno/draw', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({room: roomId, vid: vid()})}).then(x => x.json());
    if (!r.ok) { alert(r.error || 'Cannot draw'); return; }
    tick();
  } catch (e) { alert('Network hiccup'); }
}

async function callUno() {
  try { await fetch('/api/uno/uno', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({room: roomId, vid: vid()})}); tick(); } catch (e) {}
}

async function leaveRoom() {
  try { await fetch('/api/uno/leave', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({room: roomId, vid: vid()})}); } catch (e) {}
  roomId = null; if (pollT) { clearInterval(pollT); pollT = 0; } showLobby();
}

init();
window.__EOL_UNO_OPEN = () => {
  if (!panel) buildUI();
  panel.hidden = false; panel.style.display = 'flex';
  if (!roomId) showLobby(); else tick();
};