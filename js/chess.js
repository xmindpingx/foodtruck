// chess.js — ♟️ Crystal Chess, multiplayer. Tap the crystal chess table on the lot to open.
// Standard rules (castling, en passant, promotion, check/checkmate/stalemate). Pieces are
// drawn as translucent crystal (gradient fills + specular highlights + drop shadows) and every
// CAPTURE plays a battle animation: the attacker slides in, the two clash with a spark, and
// the captured piece shatters into crystal shards. Polls /api/chess/room every 2s.
import {CONFIG} from './shop.js?v=6';
import * as Account from './account.js?v=7';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

const SQ = 56, BOARD = SQ * 8;     // 448 px
const FILES = 'abcdefgh';

let panel, boardC, ctx, lobbyEl, roomId = null, mySide = null, pollT = 0;
let board = null, turn = 'white', winner = null, players = [], spectators = 0;
let selected = null, legalTargets = [], anim = null, menuOpen = false, panelWasOpen = false;
let lastMoveKey = null;

function vid() { return localStorage.getItem('eol-visitor-id') || ('v' + Math.random().toString(36).slice(2, 10)); }
function name() { return (localStorage.getItem('eol-visitor-name') || 'Player').slice(0, 24); }

function init() {
  if (!CONFIG || CONFIG.gameChessOn === false) return;
  buildUI();
  addEventListener('eol:chess-open', () => { if (menuOpen) return; panel.hidden = false; panel.style.display = 'flex'; if (!roomId) showLobby(); else tick(); });
  addEventListener('eol:menu-open', () => { menuOpen = true; panelWasOpen = !panel.hidden && panel.style.display !== 'none'; panel.style.display = 'none'; panel.hidden = true; });
  addEventListener('eol:menu-close', () => { menuOpen = false; panel.hidden = !panelWasOpen; panel.style.display = panelWasOpen ? 'flex' : 'none'; if (!panel.hidden) tick(); });
}

function buildUI() {
  panel = document.createElement('div');
  panel.id = 'eolChess'; panel.hidden = true; panel.style.display = 'none';
  panel.style.cssText = 'position:fixed;inset:0;z-index:80;display:none;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,.92);backdrop-filter:blur(4px);font:13px/1.4 Inter,sans-serif;color:#f6e7c8';
  panel.innerHTML = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <b style="font-size:16px">♟️ Crystal Chess</b>
      <span id="chessStatus" style="opacity:.7;font-size:12px"></span>
      <button id="chessX" style="margin-left:auto;background:none;border:0;color:#f6e7c8;font-size:18px;cursor:pointer">✕</button></div>
    <div id="chessLobby" style="width:min(92vw,520px);background:#141021;border:1px solid rgba(242,193,78,.3);border-radius:14px;padding:14px"></div>
    <canvas id="chessC" width="${BOARD}" height="${BOARD}" style="display:none;border:2px solid #2a2a40;border-radius:6px;touch-action:none;max-width:90vw;max-height:70vh;background:#0a0618"></canvas>
    <div style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap;justify-content:center">
      <button id="chessNew" style="padding:8px 14px;border-radius:10px;border:1px solid #43a047;background:rgba(67,160,71,.2);color:#f6e7c8;cursor:pointer;font:600 12px Inter">New game</button>
      <button id="chessLeave" style="padding:8px 14px;border-radius:10px;border:1px solid #e5534a;background:rgba(229,83,83,.15);color:#f6e7c8;cursor:pointer;font:600 12px Inter">Leave</button>
      <span id="chessInfo" style="opacity:.7;font-size:11px;margin-left:8px"></span></div>`;
  document.body.appendChild(panel);
  boardC = panel.querySelector('#chessC');
  ctx = boardC.getContext('2d');
  lobbyEl = panel.querySelector('#chessLobby');
  panel.querySelector('#chessX').onclick = () => { panel.style.display = 'none'; panel.hidden = true; if (pollT) { clearInterval(pollT); pollT = 0; } };
  panel.querySelector('#chessNew').onclick = newGame;
  panel.querySelector('#chessLeave').onclick = leaveRoom;
  boardC.addEventListener('click', onBoardClick);
  boardC.addEventListener('touchstart', e => { e.preventDefault(); const t = e.touches[0]; const r = boardC.getBoundingClientRect(); const sx = boardC.width/r.width, sy = boardC.height/r.height; onBoardClick({clientX: t.clientX, clientY: t.clientY, _sx: sx, _sy: sy}); }, {passive: false});
}

async function tick() {
  if (!roomId) return;
  try {
    const r = await fetch('/api/chess/room', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({room: roomId, vid: vid()})}).then(x => x.json());
    if (!r.ok) { if (r.error === 'room not found') { roomId = null; showLobby(); } return; }
    const newMoveKey = r.moves && r.moves.length ? (r.moves[0].from + r.moves[0].to) : null;
    if (newMoveKey && newMoveKey !== lastMoveKey) {
      lastMoveKey = newMoveKey;
      startBattleAnim(r.moves[0]);
    }
    board = r.board; turn = r.turn; winner = r.winner; players = r.players; spectators = r.spectators;
    mySide = r.side || mySide;
    selected = null; legalTargets = [];
    render();
    updateStatus(r);
  } catch (e) {}
}

function updateStatus(r) {
  const st = panel.querySelector('#chessStatus');
  const info = panel.querySelector('#chessInfo');
  if (r.status === 'lobby') st.textContent = 'Waiting for an opponent…';
  else if (r.winner === 'draw') st.textContent = 'Draw!';
  else if (r.winner) st.textContent = (r.winner === 'white' ? 'White' : 'Black') + ' wins!';
  else st.textContent = (r.turn === 'white' ? 'White' : 'Black') + ' to move' + (mySide ? ' · you are ' + mySide : ' · spectating');
  info.textContent = players.map(p => p.name + ' (' + p.side + ')').join(' · ') + (spectators ? ' · ' + spectators + ' watching' : '');
}

// ---------- board rendering (crystal pieces) ----------
function drawBoard() {
  if (!ctx) return;
  ctx.clearRect(0, 0, BOARD, BOARD);
  // squares
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const light = (x + y) % 2 === 0;
    ctx.fillStyle = light ? '#d8cfe8' : '#6b5a8a';
    ctx.fillRect(x * SQ, (7 - y) * SQ, SQ, SQ);
  }
  // last move highlight
  if (lastMoveKey && board) {
    const m = lastMoveKey;
    const fx = m.charCodeAt(0) - 97, fy = parseInt(m[1]) - 1;
    const tx = m.charCodeAt(2) - 97, ty = parseInt(m[3]) - 1;
    ctx.fillStyle = 'rgba(242,193,78,.35)';
    ctx.fillRect(fx * SQ, (7 - fy) * SQ, SQ, SQ);
    ctx.fillRect(tx * SQ, (7 - ty) * SQ, SQ, SQ);
  }
  // selected square
  if (selected) {
    ctx.fillStyle = 'rgba(0,122,255,.4)';
    ctx.fillRect(selected.x * SQ, (7 - selected.y) * SQ, SQ, SQ);
    for (const t of legalTargets) {
      ctx.fillStyle = board && board[7 - t.y][t.x] ? 'rgba(255,60,80,.55)' : 'rgba(0,122,255,.35)';
      ctx.beginPath(); ctx.arc(t.x * SQ + SQ / 2, (7 - t.y) * SQ + SQ / 2, 8, 0, Math.PI * 2); ctx.fill();
    }
  }
  // pieces
  if (board) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const p = board[y][x];
    if (!p) continue;
    // skip the captured piece if it's mid-battle (handled by anim)
    if (anim && anim.captured && anim.captured.x === x && anim.captured.y === 7 - y && anim.phase < 1) continue;
    drawCrystalPiece(p, x, (7 - y) * SQ + SQ / 2, (7 - y) * SQ + SQ / 2);
  }
  // battle animation overlay
  if (anim) drawBattleAnim();
}

function drawCrystalPiece(code, gx, cx, cy) {
  const side = code[0], type = code[1];
  const isW = side === 'w';
  // crystal gradient fill
  const grad = ctx.createRadialGradient(cx - 6, cy - 8, 2, cx, cy, SQ * .42);
  if (isW) { grad.addColorStop(0, 'rgba(255,255,255,.95)'); grad.addColorStop(.4, 'rgba(220,230,255,.85)'); grad.addColorStop(1, 'rgba(160,180,220,.7)'); }
  else { grad.addColorStop(0, 'rgba(80,60,120,.95)'); grad.addColorStop(.4, 'rgba(40,20,80,.85)'); grad.addColorStop(1, 'rgba(15,5,40,.7)'); }
  // drop shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
  ctx.fillStyle = grad;
  ctx.font = 'bold 40px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText((isW ? PIECE_GLYPH[type] : PIECE_GLYPH[type]), cx, cy);
  ctx.restore();
  // specular highlight
  ctx.fillStyle = isW ? 'rgba(255,255,255,.55)' : 'rgba(200,180,255,.35)';
  ctx.beginPath(); ctx.ellipse(cx - 6, cy - 8, 6, 4, -.4, 0, Math.PI * 2); ctx.fill();
}

function startBattleAnim(mv) {
  if (!mv) return;
  const from = mv.from, to = mv.to;
  const fx = from.charCodeAt(0) - 97, fy = parseInt(from[1]) - 1;
  const tx = to.charCodeAt(0) - 97, ty = parseInt(to[1]) - 1;
  const captured = mv.captured;
  anim = {from: {x: fx, y: fy}, to: {x: tx, y: ty}, captured: captured ? {x: tx, y: ty} : null,
          phase: 0, t0: performance.now(), dur: captured ? 900 : 320};
  requestAnimationFrame(animLoop);
}

function animLoop() {
  if (!anim) return;
  const now = performance.now();
  anim.phase = Math.min(1, (now - anim.t0) / anim.dur);
  drawBoard();
  if (anim.phase < 1) requestAnimationFrame(animLoop);
  else { anim = null; drawBoard(); }
}

function drawBattleAnim() {
  if (!anim) return;
  const p = anim.phase;
  const sx = anim.from.x * SQ + SQ / 2, sy = (7 - anim.from.y) * SQ + SQ / 2;
  const ex = anim.to.x * SQ + SQ / 2, ey = (7 - anim.to.y) * SQ + SQ / 2;
  // attacker slides in (ease-in-out)
  const e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  const ax = sx + (ex - sx) * e, ay = sy + (ey - sy) * e;
  // captured piece shatters (only if captured)
  if (anim.captured) {
    const cx = ex, cy = ey;
    const shatter = Math.max(0, (p - .3) / .7);
    // flash on clash
    if (p > .35 && p < .7) {
      ctx.fillStyle = `rgba(255,220,120,${1 - Math.abs(p - .5) * 4})`;
      ctx.beginPath(); ctx.arc(cx, cy, 18 + (p - .35) * 40, 0, Math.PI * 2); ctx.fill();
    }
    // shards
    ctx.save();
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const dist = shatter * (14 + (i % 3) * 6);
      const sx2 = cx + Math.cos(ang) * dist, sy2 = cy + Math.sin(ang) * dist;
      const shardSize = (1 - shatter) * 4 + 1;
      ctx.fillStyle = i % 2 ? 'rgba(200,180,255,.85)' : 'rgba(255,255,255,.9)';
      ctx.beginPath(); ctx.arc(sx2, sy2, shardSize, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  // attacker piece (drawn on top) — use the moving piece's glyph; infer from board? use last move piece
  // We don't have piece here; draw a generic crystal disc as the attacker
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
  const g2 = ctx.createRadialGradient(ax - 4, ay - 6, 1, ax, ay, SQ * .38);
  g2.addColorStop(0, 'rgba(255,255,255,.95)'); g2.addColorStop(1, 'rgba(160,180,220,.7)');
  ctx.fillStyle = g2;
  ctx.beginPath(); ctx.arc(ax, ay, SQ * .38, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,.6)';
  ctx.beginPath(); ctx.ellipse(ax - 4, ay - 6, 5, 3, -.4, 0, Math.PI * 2); ctx.fill();
}

function onBoardClick(e) {
  if (!board || winner || turn !== mySide) return;
  const r = boardC.getBoundingClientRect();
  const sx = e._sx || (boardC.width / r.width), sy = e._sy || (boardC.height / r.height);
  const x = Math.floor((e.clientX - r.left) * sx / SQ);
  const y = 7 - Math.floor((e.clientY - r.top) * sy / SQ);
  if (x < 0 || x > 7 || y < 0 || y > 7) return;
  // if a promotion is pending, ignore (handled by promo picker — auto-queen for simplicity)
  if (selected) {
    const t = legalTargets.find(t => t.x === x && t.y === y);
    if (t) {
      const promo = t.promo && t.promo !== null ? (t.promo === 'q' ? 'q' : t.promo) : null;
      makeMove(selected.x, selected.y, x, y, promo || 'q');
      selected = null; legalTargets = []; render();
      return;
    }
  }
  // select own piece
  const p = board[7 - y][x];
  if (p && p[0] === (mySide === 'white' ? 'w' : 'b')) {
    selected = {x, y};
    // compute legal targets client-side: ask server? We'll just send and let server validate; but show dots:
    // simple: highlight all squares (server validates). For better UX, compute basic moves locally.
    legalTargets = basicMoves(x, y);
    render();
  } else {
    selected = null; legalTargets = []; render();
  }
}

function basicMoves(x, y) {
  // lightweight client-side move hints (server is authoritative)
  const p = board[7 - y][x];
  if (!p) return [];
  const side = p[0], type = p[1];
  const out = [];
  const add = (nx, ny) => { if (nx < 0 || nx > 7 || ny < 0 || ny > 7) return; const t = board[7 - ny][nx]; if (t && t[0] === side) return; out.push({x: nx, y: ny, promo: null}); };
  if (type === 'N') { for (const [dx,dy] of [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]]) add(x+dx, y+dy); }
  else if (type === 'K') { for (let dx=-1;dx<=1;dx++) for (let dy=-1;dy<=1;dy++) if (dx||dy) add(x+dx,y+dy); }
  else if (type === 'P') {
    const d = side === 'w' ? 1 : -1, start = side === 'w' ? 1 : 6;
    if (!board[7-(y+d)][x]) { add(x, y+d); if (y === start && !board[7-(y+2*d)][x]) add(x, y+2*d); }
    for (const dx of [-1,1]) { const t = board[7-(y+d)] && board[7-(y+d)][x+dx]; if (t && t[0] !== side) add(x+dx, y+d); }
  } else {
    const dirs = type === 'B' ? [[-1,-1],[-1,1],[1,-1],[1,1]] :
                 type === 'R' ? [[-1,0],[1,0],[0,-1],[0,1]] :
                 [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]];
    for (const [dx,dy] of dirs) {
      let nx = x+dx, ny = y+dy;
      while (nx >= 0 && nx <= 7 && ny >= 0 && ny <= 7) {
        const t = board[7-ny][nx];
        if (t) { if (t[0] !== side) add(nx, ny); break; }
        add(nx, ny); nx += dx; ny += dy;
      }
    }
  }
  // mark promotion
  for (const t of out) if (type === 'P' && (t.y === 0 || t.y === 7)) t.promo = 'q';
  return out;
}

async function makeMove(fx, fy, tx, ty, promo) {
  try {
    const r = await fetch('/api/chess/move', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({room: roomId, vid: vid(), from: FILES[fx] + (fy+1), to: FILES[tx] + (ty+1), promo})}).then(x => x.json());
    if (!r.ok) { alert(r.error || 'Illegal move'); selected = null; legalTargets = []; render(); return; }
    tick();
  } catch (e) { alert('Network hiccup'); }
}

async function newGame() {
  if (!roomId) return;
  try { await fetch('/api/chess/reset', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({room: roomId, vid: vid()})}); tick(); } catch (e) {}
}

async function leaveRoom() {
  if (roomId) try { await fetch('/api/chess/leave', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({room: roomId, vid: vid()})}); } catch (e) {}
  roomId = null; mySide = null; board = null; selected = null; legalTargets = []; anim = null;
  if (pollT) { clearInterval(pollT); pollT = 0; }
  showLobby();
}

function render() {
  if (!ctx) return;
  drawBoard();
  const st = panel.querySelector('#chessStatus');
  if (st) {
    if (winner === 'draw') st.textContent = 'Draw!';
    else if (winner) st.textContent = (winner === 'white' ? 'White' : 'Black') + ' wins!';
    else st.textContent = (turn === 'white' ? 'White' : 'Black') + ' to move' + (mySide ? ' · you are ' + mySide : ' · spectating');
  }
}

function showLobby() {
  lobbyEl.style.display = 'block'; boardC.style.display = 'none';
  lobbyEl.innerHTML = `<div style="display:flex;gap:8px;margin-bottom:10px">
      <button id="chCreate" style="padding:8px 14px;border-radius:10px;border:1px solid rgba(242,193,78,.5);background:rgba(242,193,78,.15);color:#f6e7c8;cursor:pointer;font:600 13px Inter">Create a table</button>
      <button id="chRefresh" style="padding:8px 14px;border-radius:10px;border:1px solid #444;background:#1a1a2e;color:#f6e7c8;cursor:pointer;font:600 13px Inter">Refresh</button></div>
    <div id="chRooms"></div>`;
  lobbyEl.querySelector('#chCreate').onclick = createRoom;
  lobbyEl.querySelector('#chRefresh').onclick = listRooms;
  listRooms();
}

async function createRoom() {
  try {
    const r = await fetch('/api/chess/create', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: 'Chess table', vid: vid(), pname: name()})}).then(x => x.json());
    if (!r.ok) throw new Error(r.error);
    roomId = r.id; mySide = r.side; enterRoom();
  } catch (e) { alert(e.message || 'Could not create.'); }
}

async function joinRoom(id) {
  try {
    const r = await fetch('/api/chess/join', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({room: id, vid: vid(), pname: name()})}).then(x => x.json());
    if (!r.ok) throw new Error(r.error);
    roomId = id; mySide = r.side; enterRoom();
  } catch (e) { alert(e.message || 'Could not join.'); }
}

async function listRooms() {
  try {
    const r = await fetch('/api/chess/rooms').then(x => x.json());
    const el = lobbyEl.querySelector('#chRooms');
    if (!r.rooms || !r.rooms.length) { el.innerHTML = '<p style="opacity:.6">No open tables — create one!</p>'; return; }
    el.innerHTML = r.rooms.map(rm => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;margin:4px 0;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:rgba(30,22,40,.6)">
      <div><b>${esc(rm.name)}</b> <span style="opacity:.6;font-size:11px">(${rm.players}/2 · ${rm.status})</span></div>
      <button data-id="${rm.id}" style="padding:6px 12px;border-radius:8px;border:1px solid #43a047;background:rgba(67,160,71,.2);color:#f6e7c8;cursor:pointer;font:600 12px Inter">Join</button></div>`).join('');
    el.querySelectorAll('button[data-id]').forEach(b => b.onclick = () => joinRoom(b.dataset.id));
  } catch (e) { lobbyEl.querySelector('#chRooms').innerHTML = '<p style="color:#ff6b6b">Network hiccup.</p>'; }
}

function enterRoom() {
  lobbyEl.style.display = 'none'; boardC.style.display = 'block';
  panel.hidden = false; panel.style.display = 'flex';
  if (pollT) clearInterval(pollT);
  pollT = setInterval(tick, 2000);
  tick();
}

init();
window.__EOL_CHESS_OPEN = () => {
  if (!panel) buildUI();
  panel.hidden = false; panel.style.display = 'flex';
  if (!roomId) showLobby(); else tick();
};