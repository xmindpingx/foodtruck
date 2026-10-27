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

let panel, boardC, ctx, lobbyEl, roomId = null, mySide = null, pollT = 0, soloMode = false;
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
      <select id="chessTheme" style="padding:6px 10px;border-radius:10px;border:1px solid #444;background:#1a1a2e;color:#f6e7c8;font:600 11px Inter;cursor:pointer">
        <option value="southpark">🎨 South Park</option>
        <option value="medieval">⚔️ Medieval Classic</option>
        <option value="ice">🧊 Ice Crystal</option>
        <option value="classic">♟️ Classic</option>
        <option value="battle">⚔️ BattleChess</option>
      </select>
      <button id="chessLeave" style="padding:8px 14px;border-radius:10px;border:1px solid #e5534a;background:rgba(229,83,83,.15);color:#f6e7c8;cursor:pointer;font:600 12px Inter">Leave</button>
      <span id="chessInfo" style="opacity:.7;font-size:11px;margin-left:8px"></span></div>`;
  document.body.appendChild(panel);
  boardC = panel.querySelector('#chessC');
  ctx = boardC.getContext('2d');
  lobbyEl = panel.querySelector('#chessLobby');
  panel.querySelector('#chessX').onclick = () => { panel.style.display = 'none'; panel.hidden = true; if (pollT) { clearInterval(pollT); pollT = 0; } };
  panel.querySelector('#chessNew').onclick = newGame;
  panel.querySelector('#chessLeave').onclick = leaveRoom;
  const themeSel = panel.querySelector('#chessTheme');
  if (themeSel) {
    themeSel.value = pieceTheme;
    themeSel.onchange = () => { setPieceTheme(themeSel.value); };
  }
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
      if (r.moves[0].captured) startBattleAnim(r.moves[0]);
    }
    board = r.board; turn = r.turn; winner = r.winner; players = r.players; spectators = r.spectators;
    if (!mySide && Array.isArray(r.players)) {
      const me = r.players.find(p => p.id === vid());
      if (me) mySide = me.side;
    }
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
    ctx.fillRect(x * SQ, y * SQ, SQ, SQ);
  }
  // last move highlight
  if (lastMoveKey && board) {
    const m = lastMoveKey;
    const fx = m.charCodeAt(0) - 97, fy = parseInt(m[1]) - 1;
    const tx = m.charCodeAt(2) - 97, ty = parseInt(m[3]) - 1;
    ctx.fillStyle = 'rgba(242,193,78,.35)';
    ctx.fillRect(fx * SQ, fy * SQ, SQ, SQ);
    ctx.fillRect(tx * SQ, ty * SQ, SQ, SQ);
  }
  // selected square
  if (selected) {
    ctx.fillStyle = 'rgba(0,122,255,.4)';
    ctx.fillRect(selected.x * SQ, selected.y * SQ, SQ, SQ);
    for (const t of legalTargets) {
      ctx.fillStyle = board && board[t.y][t.x] ? 'rgba(255,60,80,.55)' : 'rgba(0,122,255,.35)';
      ctx.beginPath(); ctx.arc(t.x * SQ + SQ / 2, t.y * SQ + SQ / 2, 8, 0, Math.PI * 2); ctx.fill();
    }
  }
  // pieces
  if (board) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const p = board[y][x];
    if (!p) continue;
    // skip the captured piece if it's mid-battle (handled by anim)
    if (anim && anim.captured && anim.captured.x === x && anim.captured.y === y && anim.phase < 1) continue;
    drawCrystalPiece(p, x, x * SQ + SQ / 2, y * SQ + SQ / 2);
  }
  // battle animation overlay
  if (anim) drawBattleAnim();
}

// ---------- chess piece themes ----------
// South Park: flat colors, bold outlines, big heads, simple bodies (cartoon cutout look)
// Medieval Classic: human-like 3D pieces with metallic shading, armor, realistic proportions
let pieceTheme = (() => {
  try { return localStorage.getItem('chess-theme') || 'southpark'; } catch (e) { return 'southpark'; }
})();
function setPieceTheme(t) {
  pieceTheme = t;
  try { localStorage.setItem('chess-theme', t); } catch (e) {}
  render();
}

const battleImgs = {};
function battleImg(code) {
  if (battleImgs[code]) return battleImgs[code];
  const im = new Image();
  im.src = 'img/chess/battle/' + code + '.png';
  battleImgs[code] = im;
  im.onload = () => { try { render(); } catch (e) {} };
  return im;
}
function drawBattlePiece(code, cx, cy) {
  const side = code[0], type = code[1];
  const im = battleImg(code);
  if (im.complete && im.naturalWidth > 0) {
    const sz = SQ * 0.9;
    ctx.drawImage(im, cx - sz/2, cy - sz/2, sz, sz);
    return;
  }
  const isW = side === 'w';
  const s = SQ * 0.42;
  // metallic gradient
  const grad = ctx.createLinearGradient(cx, cy - s * 1.4, cx, cy + s * 1.2);
  if (isW) { grad.addColorStop(0, '#f7f3e8'); grad.addColorStop(0.5, '#d8c8a0'); grad.addColorStop(1, '#a89060'); }
  else { grad.addColorStop(0, '#4a4a5a'); grad.addColorStop(0.5, '#2a2a3a'); grad.addColorStop(1, '#0a0a14'); }
  const outline = isW ? '#3a2a10' : '#000';
  const accent = isW ? '#c9a227' : '#8b1a1a';
  ctx.save();
  ctx.translate(cx, cy);
  // base
  ctx.fillStyle = grad;
  ctx.strokeStyle = outline; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, s * 1.05, s * 0.75, s * 0.22, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  // body varies by type
  if (type === 'P') {
    // stem
    ctx.beginPath();
    ctx.moveTo(-s*0.25, s*0.85); ctx.lineTo(-s*0.18, -s*0.1); ctx.lineTo(s*0.18, -s*0.1); ctx.lineTo(s*0.25, s*0.85);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // head
    ctx.beginPath(); ctx.arc(0, -s*0.45, s*0.32, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  } else if (type === 'R') {
    ctx.fillRect(-s*0.45, -s*0.9, s*0.9, s*1.75);
    ctx.strokeRect(-s*0.45, -s*0.9, s*0.9, s*1.75);
    // battlements
    for (let i = -2; i <= 2; i++) {
      ctx.fillRect(i*s*0.18 - s*0.07, -s*1.15, s*0.14, s*0.28);
      ctx.strokeRect(i*s*0.18 - s*0.07, -s*1.15, s*0.14, s*0.28);
    }
    ctx.fillRect(-s*0.5, -s*0.95, s*1.0, s*0.12);
  } else if (type === 'N') {
    // base body
    ctx.beginPath();
    ctx.moveTo(-s*0.4, s*0.85); ctx.lineTo(-s*0.3, -s*0.2); ctx.lineTo(s*0.1, -s*0.9);
    ctx.lineTo(s*0.45, -s*0.5); ctx.lineTo(s*0.35, s*0.85);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // ear
    ctx.beginPath(); ctx.moveTo(s*0.1, -s*0.9); ctx.lineTo(s*0.25, -s*1.15); ctx.lineTo(s*0.4, -s*0.85); ctx.closePath(); ctx.fill(); ctx.stroke();
    // eye
    ctx.fillStyle = isW ? '#1a1208' : '#f6e7c8';
    ctx.beginPath(); ctx.arc(s*0.15, -s*0.55, s*0.06, 0, Math.PI*2); ctx.fill();
  } else if (type === 'B') {
    ctx.beginPath();
    ctx.moveTo(0, -s*1.1); ctx.lineTo(-s*0.35, s*0.85); ctx.lineTo(s*0.35, s*0.85);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // slit
    ctx.strokeStyle = isW ? '#3a2a10' : '#555'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -s*0.9); ctx.lineTo(0, s*0.6); ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(0, -s*1.15, s*0.1, 0, Math.PI*2); ctx.fill();
  } else if (type === 'Q') {
    // body
    ctx.beginPath();
    ctx.moveTo(-s*0.4, s*0.85); ctx.lineTo(-s*0.35, -s*0.6); ctx.lineTo(s*0.35, -s*0.6); ctx.lineTo(s*0.4, s*0.85);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // crown
    ctx.beginPath();
    ctx.moveTo(-s*0.45, -s*0.6); ctx.lineTo(-s*0.5, -s*1.0); ctx.lineTo(-s*0.2, -s*0.75);
    ctx.lineTo(0, -s*1.15); ctx.lineTo(s*0.2, -s*0.75); ctx.lineTo(s*0.5, -s*1.0); ctx.lineTo(s*0.45, -s*0.6);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // jewels
    ctx.fillStyle = accent;
    for (const jx of [-s*0.45, 0, s*0.45]) {
      ctx.beginPath(); ctx.arc(jx, -s*0.95, s*0.08, 0, Math.PI*2); ctx.fill();
    }
  } else if (type === 'K') {
    ctx.beginPath();
    ctx.moveTo(-s*0.4, s*0.85); ctx.lineTo(-s*0.35, -s*0.6); ctx.lineTo(s*0.35, -s*0.6); ctx.lineTo(s*0.4, s*0.85);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // crown base
    ctx.fillRect(-s*0.45, -s*0.75, s*0.9, s*0.18);
    ctx.strokeRect(-s*0.45, -s*0.75, s*0.9, s*0.18);
    // cross
    ctx.fillStyle = accent;
    ctx.fillRect(-s*0.06, -s*1.25, s*0.12, s*0.55);
    ctx.fillRect(-s*0.22, -s*1.12, s*0.44, s*0.12);
    ctx.strokeStyle = outline; ctx.lineWidth = 1;
    ctx.strokeRect(-s*0.06, -s*1.25, s*0.12, s*0.55);
    ctx.strokeRect(-s*0.22, -s*1.12, s*0.44, s*0.12);
  }
  ctx.restore();
}

function drawCrystalPiece(code, gx, cx, cy) {
  const side = code[0], type = code[1];
  const isW = side === 'w';
  if (pieceTheme === 'battle') {
    drawBattlePiece(code, cx, cy);
    return;
  }
  if (pieceTheme === 'classic') {
    const W = {K:'♔',Q:'♕',R:'♖',B:'♗',N:'♘',P:'♙'};
    const B = {K:'♚',Q:'♛',R:'♜',B:'♝',N:'♞',P:'♟'};
    const g = (isW ? W : B)[type] || '';
    ctx.save();
    ctx.font = 'bold ' + Math.round(SQ * 0.85) + 'px "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isW ? '#f6e7c8' : '#1a1208';
    ctx.strokeStyle = isW ? '#1a1208' : '#f6e7c8';
    ctx.lineWidth = 2;
    ctx.strokeText(g, cx, cy);
    ctx.fillText(g, cx, cy);
    ctx.restore();
    return;
  }
  // theme palette
  let skin, cloth, accent, outline, hair;
  if (pieceTheme === 'ice') {
    skin = isW ? '#e8f4ff' : '#a0c8e8'; cloth = isW ? '#d0e8ff' : '#1a3a5a';
    accent = isW ? '#74dbe6' : '#4f76e5'; outline = '#1a2a4a'; hair = isW ? '#b8d8f0' : '#0a1a3a';
  } else if (pieceTheme === 'medieval') {
    skin = isW ? '#f0d8a0' : '#8a6a40'; cloth = isW ? '#e8dcc8' : '#2a1a3a';
    accent = isW ? '#c9a227' : '#8b1a1a'; outline = '#1a1208'; hair = isW ? '#8a6a30' : '#1a0a0a';
  } else {
    skin = isW ? '#f5d6a8' : '#c8a070'; cloth = isW ? '#f0e8d8' : '#3a2050';
    accent = isW ? '#ffd700' : '#cc2222'; outline = '#000000'; hair = isW ? '#d4a040' : '#2a1a0a';
  }
  const s = SQ * 0.4;
  const bw = s * 0.75, bh = s * 0.7;
  const hr = s * 0.38;
  const hy = cy - hr * 0.3;  // head sits just above body, not floating

  // body (big, visible rect with bold outline)
  ctx.fillStyle = cloth;
  ctx.strokeStyle = outline; ctx.lineWidth = 2;
  ctx.fillRect(cx - bw, cy - bh * 0.1, bw * 2, bh);
  ctx.strokeRect(cx - bw, cy - bh * 0.1, bw * 2, bh);
  // belt
  ctx.fillStyle = isW ? '#8a6b3f' : '#1a1a3a';
  ctx.fillRect(cx - bw, cy + bh * 0.3, bw * 2, bh * 0.12);
  // legs
  ctx.fillStyle = cloth;
  ctx.fillRect(cx - bw * 0.8, cy + bh * 0.9, bw * 0.65, s * 0.3);
  ctx.fillRect(cx + bw * 0.15, cy + bh * 0.9, bw * 0.65, s * 0.3);
  ctx.strokeStyle = outline; ctx.lineWidth = 1.5;
  ctx.strokeRect(cx - bw * 0.8, cy + bh * 0.9, bw * 0.65, s * 0.3);
  ctx.strokeRect(cx + bw * 0.15, cy + bh * 0.9, bw * 0.65, s * 0.3);
  // shoes
  ctx.fillStyle = isW ? '#5a3a1f' : '#111';
  ctx.fillRect(cx - bw * 0.85, cy + bh + s * 0.28, bw * 0.75, s * 0.1);
  ctx.fillRect(cx + bw * 0.1, cy + bh + s * 0.28, bw * 0.75, s * 0.1);
  // arms
  ctx.fillStyle = cloth;
  ctx.fillRect(cx - bw - s * 0.15, cy, s * 0.18, bh * 0.7);
  ctx.fillRect(cx + bw - s * 0.03, cy, s * 0.18, bh * 0.7);
  ctx.strokeStyle = outline; ctx.lineWidth = 1;
  ctx.strokeRect(cx - bw - s * 0.15, cy, s * 0.18, bh * 0.7);
  ctx.strokeRect(cx + bw - s * 0.03, cy, s * 0.18, bh * 0.7);
  // hands
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(cx - bw - s * 0.06, cy + bh * 0.75, s * 0.08, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = outline; ctx.lineWidth = 1; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx + bw + s * 0.06, cy + bh * 0.75, s * 0.08, 0, Math.PI * 2); ctx.fill();
  ctx.stroke();
  // head
  ctx.fillStyle = skin;
  ctx.strokeStyle = outline; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, hy, hr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // hair
  ctx.fillStyle = hair;
  ctx.beginPath(); ctx.arc(cx, hy - hr * 0.15, hr * 1.0, Math.PI, 0); ctx.fill();
  ctx.fillRect(cx - hr * 0.9, hy - hr * 0.15, hr * 1.8, hr * 0.25);
  // eyes
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.ellipse(cx - hr * 0.3, hy - hr * 0.05, hr * 0.2, hr * 0.22, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + hr * 0.3, hy - hr * 0.05, hr * 0.2, hr * 0.22, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = outline; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(cx - hr * 0.3, hy - hr * 0.05, hr * 0.2, hr * 0.22, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(cx + hr * 0.3, hy - hr * 0.05, hr * 0.2, hr * 0.22, 0, 0, Math.PI * 2); ctx.stroke();
  // pupils
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath(); ctx.arc(cx - hr * 0.3, hy - hr * 0.05, hr * 0.1, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + hr * 0.3, hy - hr * 0.05, hr * 0.1, 0, Math.PI * 2); ctx.fill();
  // mouth
  ctx.strokeStyle = '#b05050'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx - hr * 0.15, hy + hr * 0.25); ctx.lineTo(cx + hr * 0.15, hy + hr * 0.25); ctx.stroke();

  // ---- role-specific medieval accessories ----
  if (type === 'K') {
    ctx.fillStyle = accent;
    ctx.fillRect(cx - hr * 0.7, hy - hr * 1.0, hr * 1.4, hr * 0.2);
    ctx.strokeStyle = outline; ctx.lineWidth = 1;
    ctx.strokeRect(cx - hr * 0.7, hy - hr * 1.0, hr * 1.4, hr * 0.2);
    for (let i = 0; i < 5; i++) {
      const px = cx - hr * 0.6 + i * hr * 0.3;
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.moveTo(px, hy - hr * 1.0); ctx.lineTo(px + hr * 0.1, hy - hr * 1.25); ctx.lineTo(px + hr * 0.2, hy - hr * 1.0); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx + bw + s * 0.1, cy + bh * 0.3); ctx.lineTo(cx + bw + s * 0.1, cy - s * 0.6); ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(cx + bw + s * 0.1, cy - s * 0.65, s * 0.08, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = 1; ctx.stroke();
  } else if (type === 'Q') {
    ctx.fillStyle = accent;
    ctx.fillRect(cx - hr * 0.7, hy - hr * 1.0, hr * 1.4, hr * 0.2);
    for (let i = 0; i < 3; i++) {
      const px = cx - hr * 0.5 + i * hr * 0.5;
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.arc(px, hy - hr * 1.1, hr * 0.08, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.strokeStyle = outline; ctx.lineWidth = 1;
    ctx.strokeRect(cx - hr * 0.7, hy - hr * 1.0, hr * 1.4, hr * 0.2);
    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx + bw + s * 0.1, cy + bh * 0.3); ctx.lineTo(cx + bw + s * 0.1, cy - s * 0.6); ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(cx + bw + s * 0.1, cy - s * 0.65, s * 0.08, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = isW ? '#d0a0d0' : '#5a3070'; ctx.globalAlpha = .5;
    ctx.beginPath(); ctx.moveTo(cx - bw, cy + bh * 0.9); ctx.lineTo(cx - bw * 1.2, cy + bh + s * 0.3); ctx.lineTo(cx + bw * 1.2, cy + bh + s * 0.3); ctx.lineTo(cx + bw, cy + bh * 0.9); ctx.fill();
    ctx.globalAlpha = 1;
  } else if (type === 'R') {
    ctx.fillStyle = accent;
    ctx.fillRect(cx - hr * 0.75, hy - hr * 0.9, hr * 1.5, hr * 0.22);
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(cx - hr * 0.65 + i * hr * 0.33, hy - hr * 1.15, hr * 0.22, hr * 0.22);
      ctx.strokeStyle = outline; ctx.lineWidth = 1; ctx.strokeRect(cx - hr * 0.65 + i * hr * 0.33, hy - hr * 1.15, hr * 0.22, hr * 0.22);
    }
    ctx.strokeStyle = outline; ctx.lineWidth = 1;
    ctx.strokeRect(cx - hr * 0.75, hy - hr * 0.9, hr * 1.5, hr * 0.22);
    ctx.fillStyle = accent; ctx.globalAlpha = .6;
    ctx.beginPath(); ctx.ellipse(cx - bw - s * 0.15, cy + bh * 0.1, s * 0.12, s * 0.15, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = outline; ctx.lineWidth = 1; ctx.stroke();
  } else if (type === 'B') {
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.moveTo(cx, hy - hr * 1.3); ctx.lineTo(cx - hr * 0.4, hy - hr * 0.5); ctx.lineTo(cx + hr * 0.4, hy - hr * 0.5); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx + bw + s * 0.1, cy + bh * 0.3); ctx.lineTo(cx + bw + s * 0.1, cy - s * 0.6); ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(cx + bw + s * 0.1, cy - s * 0.65, s * 0.06, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = 1; ctx.stroke();
  } else if (type === 'N') {
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(cx, hy - hr * 0.1, hr * 1.0, Math.PI * 0.7, Math.PI * 2.3); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = isW ? '#cc2222' : '#ffd700';
    ctx.beginPath(); ctx.moveTo(cx, hy - hr * 1.0); ctx.quadraticCurveTo(cx + hr * 0.2, hy - hr * 1.3, cx + hr * 0.1, hy - hr * 1.15); ctx.fill();
    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx + bw + s * 0.1, cy + bh * 0.3); ctx.lineTo(cx + bw + s * 0.1, cy - s * 0.6); ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.moveTo(cx + bw + s * 0.1 - s * 0.05, cy - s * 0.55); ctx.lineTo(cx + bw + s * 0.1, cy - s * 0.65); ctx.lineTo(cx + bw + s * 0.1 + s * 0.05, cy - s * 0.55); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = 1; ctx.stroke();
  } else {
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(cx, hy - hr * 0.1, hr * 0.8, Math.PI, 0); ctx.fill();
    ctx.fillRect(cx - hr * 0.8, hy - hr * 0.1, hr * 1.6, hr * 0.15);
    ctx.strokeStyle = outline; ctx.lineWidth = 1;
    ctx.strokeRect(cx - hr * 0.8, hy - hr * 0.1, hr * 1.6, hr * 0.15);
    ctx.strokeStyle = accent; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx + bw + s * 0.1, cy + bh * 0.3); ctx.lineTo(cx + bw + s * 0.1, cy - s * 0.6); ctx.stroke();
  }
  ctx.restore();
}

function roundRect2(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function startBattleAnim(mv) {
  if (!mv) return;
  const from = mv.from, to = mv.to;
  const fx = from.charCodeAt(0) - 97, fy = parseInt(from[1]) - 1;
  const tx = to.charCodeAt(0) - 97, ty = parseInt(to[1]) - 1;
  const captured = mv.captured;
  anim = {from: {x: fx, y: fy}, to: {x: tx, y: ty},
          captured: captured ? {x: tx, y: ty, piece: captured} : null,
          phase: 0, t0: performance.now(), dur: captured ? 3600 : 500};
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

const bishopRookFrames = [];
for (let i = 0; i < 8; i++) {
  const im = new Image();
  im.src = 'img/chess/battle/anim_bishop_rook_' + String(i).padStart(2, '0') + '.png';
  bishopRookFrames.push(im);
}
const kingBishopFrames = [];
for (let i = 0; i < 8; i++) {
  const im = new Image();
  im.src = 'img/chess/battle/anim_king_bishop_' + String(i).padStart(2, '0') + '.png';
  kingBishopFrames.push(im);
}
const kingPawnFrames = [];
for (let i = 0; i < 8; i++) {
  const im = new Image();
  im.src = 'img/chess/battle/anim_king_pawn_' + String(i).padStart(2, '0') + '.png';
  kingPawnFrames.push(im);
}
const kingRookFrames = [];
for (let i = 0; i < 8; i++) {
  const im = new Image();
  im.src = 'img/chess/battle/anim_king_rook_' + String(i).padStart(2, '0') + '.png';
  kingRookFrames.push(im);
}
const knightBishopFrames = [];
for (let i = 0; i < 8; i++) {
  const im = new Image();
  im.src = 'img/chess/battle/anim_knight_bishop_' + String(i).padStart(2, '0') + '.png';
  knightBishopFrames.push(im);
}
const knightKnightFrames = [];
for (let i = 0; i < 8; i++) {
  const im = new Image();
  im.src = 'img/chess/battle/anim_knight_knight_' + String(i).padStart(2, '0') + '.png';
  knightKnightFrames.push(im);
}
const knightPawnFrames = [];
for (let i = 0; i < 8; i++) {
  const im = new Image();
  im.src = 'img/chess/battle/anim_knight_pawn_' + String(i).padStart(2, '0') + '.png';
  knightPawnFrames.push(im);
}
const knightQueenFrames = [];
for (let i = 0; i < 8; i++) {
  const im = new Image();
  im.src = 'img/chess/battle/anim_knight_queen_' + String(i).padStart(2, '0') + '.png';
  knightQueenFrames.push(im);
}
const knightRookFrames = [];
for (let i = 0; i < 8; i++) {
  const im = new Image();
  im.src = 'img/chess/battle/anim_knight_rook_' + String(i).padStart(2, '0') + '.png';
  knightRookFrames.push(im);
}
const pawnBishopFrames = [];
for (let i = 0; i < 8; i++) {
  const im = new Image();
  im.src = 'img/chess/battle/anim_pawn_bishop_' + String(i).padStart(2, '0') + '.png';
  pawnBishopFrames.push(im);
}
const pawnKingFrames = [];
for (let i = 0; i < 8; i++) {
  const im = new Image();
  im.src = 'img/chess/battle/anim_pawn_king_' + String(i).padStart(2, '0') + '.png';
  pawnKingFrames.push(im);
}
const pawnKnightFrames = [];
for (let i = 0; i < 8; i++) {
  const im = new Image();
  im.src = 'img/chess/battle/anim_pawn_knight_' + String(i).padStart(2, '0') + '.png';
  pawnKnightFrames.push(im);
}
const pawnPawnFrames = [];
for (let i = 0; i < 8; i++) {
  const im = new Image();
  im.src = 'img/chess/battle/anim_pawn_pawn_' + String(i).padStart(2, '0') + '.png';
  pawnPawnFrames.push(im);
}
const pawnQueenFrames = [];
for (let i = 0; i < 8; i++) {
  const im = new Image();
  im.src = 'img/chess/battle/anim_pawn_queen_' + String(i).padStart(2, '0') + '.png';
  pawnQueenFrames.push(im);
}
const pawnRookFrames = [];
for (let i = 0; i < 8; i++) {
  const im = new Image();
  im.src = 'img/chess/battle/anim_pawn_rook_' + String(i).padStart(2, '0') + '.png';
  pawnRookFrames.push(im);
}
const queenBishopFrames = [];
for (let i = 0; i < 8; i++) {
  const im = new Image();
  im.src = 'img/chess/battle/anim_queen_bishop_' + String(i).padStart(2, '0') + '.png';
  queenBishopFrames.push(im);
}
const queenKnightFrames = [];
for (let i = 0; i < 8; i++) {
  const im = new Image();
  im.src = 'img/chess/battle/anim_queen_knight_' + String(i).padStart(2, '0') + '.png';
  queenKnightFrames.push(im);
}
const queenPawnFrames = [];
for (let i = 0; i < 8; i++) {
  const im = new Image();
  im.src = 'img/chess/battle/anim_queen_pawn_' + String(i).padStart(2, '0') + '.png';
  queenPawnFrames.push(im);
}
const queenQueenFrames = [];
for (let i = 0; i < 8; i++) {
  const im = new Image();
  im.src = 'img/chess/battle/anim_queen_queen_' + String(i).padStart(2, '0') + '.png';
  queenQueenFrames.push(im);
}
const rookBishopFrames = [];
for (let i = 0; i < 8; i++) {
  const im = new Image();
  im.src = 'img/chess/battle/anim_rook_bishop_' + String(i).padStart(2, '0') + '.png';
  rookBishopFrames.push(im);
}
const rookPawnFrames = [];
for (let i = 0; i < 8; i++) {
  const im = new Image();
  im.src = 'img/chess/battle/anim_rook_pawn_' + String(i).padStart(2, '0') + '.png';
  rookPawnFrames.push(im);
}
const rookQueenFrames = [];
for (let i = 0; i < 8; i++) {
  const im = new Image();
  im.src = 'img/chess/battle/anim_rook_queen_' + String(i).padStart(2, '0') + '.png';
  rookQueenFrames.push(im);
}
const rookRookFrames = [];
for (let i = 0; i < 8; i++) {
  const im = new Image();
  im.src = 'img/chess/battle/anim_rook_rook_' + String(i).padStart(2, '0') + '.png';
  rookRookFrames.push(im);
}
const bishopBishopFrames = [];
for (let i = 0; i < 8; i++) {
  const im = new Image();
  im.src = 'img/chess/battle/anim_bishop_bishop_' + String(i).padStart(2, '0') + '.png';
  bishopBishopFrames.push(im);
}
const bishopKingFrames = [];
for (let i = 0; i < 8; i++) {
  const im = new Image();
  im.src = 'img/chess/battle/anim_bishop_king_' + String(i).padStart(2, '0') + '.png';
  bishopKingFrames.push(im);
}
const bishopKnightFrames = [];
for (let i = 0; i < 8; i++) {
  const im = new Image();
  im.src = 'img/chess/battle/anim_bishop_knight_' + String(i).padStart(2, '0') + '.png';
  bishopKnightFrames.push(im);
}
const bishopPawnFrames = [];
for (let i = 0; i < 8; i++) {
  const im = new Image();
  im.src = 'img/chess/battle/anim_bishop_pawn_' + String(i).padStart(2, '0') + '.png';
  bishopPawnFrames.push(im);
}
function drawBattleAnim() {
  if (!anim) return;
  // special bishop vs rook animation using provided frames
  const capturedPiece = (anim.captured && anim.captured.piece) ? anim.captured.piece : '';
  const pType = capturedPiece.length >= 2 ? capturedPiece[1] : 'P';
  const tx = anim.to.x, ty = anim.to.y;
  const attackerCode = (board && board[ty]) ? board[ty][tx] : '';
  const aType = attackerCode.length >= 2 ? attackerCode[1] : '';
  if ((pType === 'R' && aType === 'B') || (pType === 'B' && aType === 'R')) {
    const p = anim.phase;
    const frames = (aType === 'R') ? rookBishopFrames : bishopRookFrames;
    const idx = Math.min(frames.length - 1, Math.floor(p * frames.length));
    const im = frames[idx];
    const cx = tx * SQ + SQ / 2, cy = ty * SQ + SQ / 2;
    if (im && im.complete && im.naturalWidth > 0) {
      const sz = SQ * 1.6;
      ctx.drawImage(im, cx - sz / 2, cy - sz / 2, sz, sz);
    }
    return;
  }
  if (pType === 'B' && aType === 'B') {
    const p = anim.phase;
    const idx = Math.min(bishopBishopFrames.length - 1, Math.floor(p * bishopBishopFrames.length));
    const im = bishopBishopFrames[idx];
    const cx = tx * SQ + SQ / 2, cy = ty * SQ + SQ / 2;
    if (im && im.complete && im.naturalWidth > 0) {
      const sz = SQ * 1.6;
      ctx.drawImage(im, cx - sz / 2, cy - sz / 2, sz, sz);
    }
    return;
  }
  if ((pType === 'B' && aType === 'K') || (pType === 'K' && aType === 'B')) {
    const p = anim.phase;
    const frames = (aType === 'B') ? bishopKingFrames : kingBishopFrames;
    const idx = Math.min(frames.length - 1, Math.floor(p * frames.length));
    const im = frames[idx];
    const cx = tx * SQ + SQ / 2, cy = ty * SQ + SQ / 2;
    if (im && im.complete && im.naturalWidth > 0) {
      const sz = SQ * 1.6;
      ctx.drawImage(im, cx - sz / 2, cy - sz / 2, sz, sz);
    }
    return;
  }
  if ((pType === 'P' && aType === 'K') || (pType === 'K' && aType === 'P')) {
    const p = anim.phase;
    const idx = Math.min(kingPawnFrames.length - 1, Math.floor(p * kingPawnFrames.length));
    const im = kingPawnFrames[idx];
    const cx = tx * SQ + SQ / 2, cy = ty * SQ + SQ / 2;
    if (im && im.complete && im.naturalWidth > 0) {
      const sz = SQ * 1.6;
      ctx.drawImage(im, cx - sz / 2, cy - sz / 2, sz, sz);
    }
    return;
  }
  if ((pType === 'R' && aType === 'K') || (pType === 'K' && aType === 'R')) {
    const p = anim.phase;
    const idx = Math.min(kingRookFrames.length - 1, Math.floor(p * kingRookFrames.length));
    const im = kingRookFrames[idx];
    const cx = tx * SQ + SQ / 2, cy = ty * SQ + SQ / 2;
    if (im && im.complete && im.naturalWidth > 0) {
      const sz = SQ * 1.6;
      ctx.drawImage(im, cx - sz / 2, cy - sz / 2, sz, sz);
    }
    return;
  }
  if ((pType === 'B' && aType === 'N') || (pType === 'N' && aType === 'B')) {
    const p = anim.phase;
    const frames = (aType === 'B') ? bishopKnightFrames : knightBishopFrames;
    const idx = Math.min(frames.length - 1, Math.floor(p * frames.length));
    const im = frames[idx];
    const cx = tx * SQ + SQ / 2, cy = ty * SQ + SQ / 2;
    if (im && im.complete && im.naturalWidth > 0) {
      const sz = SQ * 1.6;
      ctx.drawImage(im, cx - sz / 2, cy - sz / 2, sz, sz);
    }
    return;
  }
  if (pType === 'N' && aType === 'N') {
    const p = anim.phase;
    const idx = Math.min(knightKnightFrames.length - 1, Math.floor(p * knightKnightFrames.length));
    const im = knightKnightFrames[idx];
    const cx = tx * SQ + SQ / 2, cy = ty * SQ + SQ / 2;
    if (im && im.complete && im.naturalWidth > 0) {
      const sz = SQ * 1.6;
      ctx.drawImage(im, cx - sz / 2, cy - sz / 2, sz, sz);
    }
    return;
  }
  if ((pType === 'P' && aType === 'N') || (pType === 'N' && aType === 'P')) {
    const p = anim.phase;
    const idx = Math.min(knightPawnFrames.length - 1, Math.floor(p * knightPawnFrames.length));
    const im = knightPawnFrames[idx];
    const cx = tx * SQ + SQ / 2, cy = ty * SQ + SQ / 2;
    if (im && im.complete && im.naturalWidth > 0) {
      const sz = SQ * 1.6;
      ctx.drawImage(im, cx - sz / 2, cy - sz / 2, sz, sz);
    }
    return;
  }
  if ((pType === 'Q' && aType === 'N') || (pType === 'N' && aType === 'Q')) {
    const p = anim.phase;
    const idx = Math.min(knightQueenFrames.length - 1, Math.floor(p * knightQueenFrames.length));
    const im = knightQueenFrames[idx];
    const cx = tx * SQ + SQ / 2, cy = ty * SQ + SQ / 2;
    if (im && im.complete && im.naturalWidth > 0) {
      const sz = SQ * 1.6;
      ctx.drawImage(im, cx - sz / 2, cy - sz / 2, sz, sz);
    }
    return;
  }
  if ((pType === 'R' && aType === 'N') || (pType === 'N' && aType === 'R')) {
    const p = anim.phase;
    const idx = Math.min(knightRookFrames.length - 1, Math.floor(p * knightRookFrames.length));
    const im = knightRookFrames[idx];
    const cx = tx * SQ + SQ / 2, cy = ty * SQ + SQ / 2;
    if (im && im.complete && im.naturalWidth > 0) {
      const sz = SQ * 1.6;
      ctx.drawImage(im, cx - sz / 2, cy - sz / 2, sz, sz);
    }
    return;
  }
  if ((pType === 'B' && aType === 'P') || (pType === 'P' && aType === 'B')) {
    const p = anim.phase;
    const frames = (aType === 'B') ? bishopPawnFrames : pawnBishopFrames;
    const idx = Math.min(frames.length - 1, Math.floor(p * frames.length));
    const im = frames[idx];
    const cx = tx * SQ + SQ / 2, cy = ty * SQ + SQ / 2;
    if (im && im.complete && im.naturalWidth > 0) {
      const sz = SQ * 1.6;
      ctx.drawImage(im, cx - sz / 2, cy - sz / 2, sz, sz);
    }
    return;
  }
  if ((pType === 'K' && aType === 'P') || (pType === 'P' && aType === 'K')) {
    const p = anim.phase;
    const idx = Math.min(pawnKingFrames.length - 1, Math.floor(p * pawnKingFrames.length));
    const im = pawnKingFrames[idx];
    const cx = tx * SQ + SQ / 2, cy = ty * SQ + SQ / 2;
    if (im && im.complete && im.naturalWidth > 0) {
      const sz = SQ * 1.6;
      ctx.drawImage(im, cx - sz / 2, cy - sz / 2, sz, sz);
    }
    return;
  }
  if ((pType === 'N' && aType === 'P') || (pType === 'P' && aType === 'N')) {
    const p = anim.phase;
    const idx = Math.min(pawnKnightFrames.length - 1, Math.floor(p * pawnKnightFrames.length));
    const im = pawnKnightFrames[idx];
    const cx = tx * SQ + SQ / 2, cy = ty * SQ + SQ / 2;
    if (im && im.complete && im.naturalWidth > 0) {
      const sz = SQ * 1.6;
      ctx.drawImage(im, cx - sz / 2, cy - sz / 2, sz, sz);
    }
    return;
  }
  if (pType === 'P' && aType === 'P') {
    const p = anim.phase;
    const idx = Math.min(pawnPawnFrames.length - 1, Math.floor(p * pawnPawnFrames.length));
    const im = pawnPawnFrames[idx];
    const cx = tx * SQ + SQ / 2, cy = ty * SQ + SQ / 2;
    if (im && im.complete && im.naturalWidth > 0) {
      const sz = SQ * 1.6;
      ctx.drawImage(im, cx - sz / 2, cy - sz / 2, sz, sz);
    }
    return;
  }
  if ((pType === 'P' && aType === 'Q') || (pType === 'Q' && aType === 'P')) {
    const p = anim.phase;
    const idx = Math.min(pawnQueenFrames.length - 1, Math.floor(p * pawnQueenFrames.length));
    const im = pawnQueenFrames[idx];
    const cx = tx * SQ + SQ / 2, cy = ty * SQ + SQ / 2;
    if (im && im.complete && im.naturalWidth > 0) {
      const sz = SQ * 1.6;
      ctx.drawImage(im, cx - sz / 2, cy - sz / 2, sz, sz);
    }
    return;
  }
  if ((pType === 'P' && aType === 'R') || (pType === 'R' && aType === 'P')) {
    const p = anim.phase;
    const frames = (aType === 'R') ? rookPawnFrames : pawnRookFrames;
    const idx = Math.min(frames.length - 1, Math.floor(p * frames.length));
    const im = frames[idx];
    const cx = tx * SQ + SQ / 2, cy = ty * SQ + SQ / 2;
    if (im && im.complete && im.naturalWidth > 0) {
      const sz = SQ * 1.6;
      ctx.drawImage(im, cx - sz / 2, cy - sz / 2, sz, sz);
    }
    return;
  }
  if ((pType === 'R' && aType === 'Q') || (pType === 'Q' && aType === 'R')) {
    const p = anim.phase;
    const frames = (aType === 'R') ? rookQueenFrames : null;
    // if rook is attacker use rook frames; else (queen attacking rook) no dedicated frames yet -> fallback to null (default)
    if (frames) {
      const idx = Math.min(frames.length - 1, Math.floor(p * frames.length));
      const im = frames[idx];
      const cx = tx * SQ + SQ / 2, cy = ty * SQ + SQ / 2;
      if (im && im.complete && im.naturalWidth > 0) {
        const sz = SQ * 1.6;
        ctx.drawImage(im, cx - sz / 2, cy - sz / 2, sz, sz);
        return;
      }
    }
  }
  if (pType === 'R' && aType === 'R') {
    const p = anim.phase;
    const idx = Math.min(rookRookFrames.length - 1, Math.floor(p * rookRookFrames.length));
    const im = rookRookFrames[idx];
    const cx = tx * SQ + SQ / 2, cy = ty * SQ + SQ / 2;
    if (im && im.complete && im.naturalWidth > 0) {
      const sz = SQ * 1.6;
      ctx.drawImage(im, cx - sz / 2, cy - sz / 2, sz, sz);
    }
    return;
  }
  if ((pType === 'B' && aType === 'Q') || (pType === 'Q' && aType === 'B')) {
    const p = anim.phase;
    const idx = Math.min(queenBishopFrames.length - 1, Math.floor(p * queenBishopFrames.length));
    const im = queenBishopFrames[idx];
    const cx = tx * SQ + SQ / 2, cy = ty * SQ + SQ / 2;
    if (im && im.complete && im.naturalWidth > 0) {
      const sz = SQ * 1.6;
      ctx.drawImage(im, cx - sz / 2, cy - sz / 2, sz, sz);
    }
    return;
  }
  if ((pType === 'P' && aType === 'Q') || (pType === 'Q' && aType === 'P')) {
    const p = anim.phase;
    const idx = Math.min(queenPawnFrames.length - 1, Math.floor(p * queenPawnFrames.length));
    const im = queenPawnFrames[idx];
    const cx = tx * SQ + SQ / 2, cy = ty * SQ + SQ / 2;
    if (im && im.complete && im.naturalWidth > 0) {
      const sz = SQ * 1.6;
      ctx.drawImage(im, cx - sz / 2, cy - sz / 2, sz, sz);
    }
    return;
  }
  if (pType === 'Q' && aType === 'Q') {
    const p = anim.phase;
    const idx = Math.min(queenQueenFrames.length - 1, Math.floor(p * queenQueenFrames.length));
    const im = queenQueenFrames[idx];
    const cx = tx * SQ + SQ / 2, cy = ty * SQ + SQ / 2;
    if (im && im.complete && im.naturalWidth > 0) {
      const sz = SQ * 1.6;
      ctx.drawImage(im, cx - sz / 2, cy - sz / 2, sz, sz);
    }
    return;
  }
  const p = anim.phase;
  const sx = anim.from.x * SQ + SQ / 2, sy = anim.from.y * SQ + SQ / 2;
  const ex = anim.to.x * SQ + SQ / 2, ey = anim.to.y * SQ + SQ / 2;
  const e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  const ax = sx + (ex - sx) * (p < .4 ? e * .6 : .6 + (p - .4) * .67);
  const ay = sy + (ey - sy) * (p < .4 ? e * .6 : .6 + (p - .4) * .67);
  const cx = ex, cy = ey;

  // determine captured piece type
  const pSide = capturedPiece.length >= 2 ? capturedPiece[0] : 'b';

  // per-type config: accessories that fall off, quotes, colors
  const TYPE_CFG = {
    P: { // pawn — tiny soldier
      name: 'Pawn', color: '#c8b89a', accent: '#8a6b3f',
      quotes: ["I'm just a pawn!", "Tis but a scratch!", "Just a flesh wound!", "I yield!"],
      // accessories: helmet, shield, sword (fall off before limbs)
      accs: ['helmet', 'shield', 'sword'],
    },
    N: { // knight — horse
      name: 'Knight', color: '#b8a080', accent: '#6b4a2a',
      quotes: ["Neigh! Tis but a scratch!", "I'm invincible!", "Just a flesh wound!", "Alright, we'll call it a draw."],
      accs: ['mane', 'head', 'tail'],
    },
    B: { // bishop — clergy
      name: 'Bishop', color: '#d8d0e8', accent: '#6b4a8a',
      quotes: ["My faith is unshaken!", "Tis but a scratch to the clergy!", "Just a flesh wound!", "I yield!"],
      accs: ['mitre', 'staff', 'robe'],
    },
    R: { // rook — castle tower
      name: 'Rook', color: '#b0b8c8', accent: '#4a5a7a',
      quotes: ["The walls are crumbling!", "Tis but a scratch in the masonry!", "Just a flesh wound!", "I yield!"],
      accs: ['turret', 'wall', 'flag'],
    },
    Q: { // queen — regal
      name: 'Queen', color: '#e8d0f0', accent: '#8a4a8a',
      quotes: ["Off with their heads!", "I am not amused!", "Just a flesh wound!", "I yield!"],
      accs: ['crown', 'scepter', 'cape'],
    },
    K: { // king — royal
      name: 'King', color: '#f0e0c0', accent: '#8a6a2a',
      quotes: ["I am the king!", "Well, I didn't vote for you.", "Help, help, I'm being repressed!", "I yield! ...okay, I'm dead."],
      accs: ['crown', 'sword', 'cape'],
    },
  };
  const cfg = TYPE_CFG[pType] || TYPE_CFG.P;

  if (anim.captured) {
    const arm1 = p >= 0.18, leg1 = p >= 0.34, arm2 = p >= 0.50, leg2 = p >= 0.66, shatter = p >= 0.82;
    const acc1 = p >= 0.10, acc2 = p >= 0.26, acc3 = p >= 0.42;  // accessories fall first
    const bx = cx, by = cy;
    ctx.save();
    ctx.strokeStyle = cfg.color; ctx.lineWidth = 2.5; ctx.lineCap = 'round';

    // ---- type-specific drawing ----
    if (pType === 'R') {
      // Rook: a castle tower — body is a box, turret on top, flag
      // base (always until shatter)
      if (!shatter) {
        ctx.fillStyle = cfg.color;
        ctx.fillRect(bx - 9, by - 4, 18, 14);
        ctx.strokeStyle = cfg.accent; ctx.lineWidth = 1.5;
        ctx.strokeRect(bx - 9, by - 4, 18, 14);
        // battlements
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = cfg.color;
          ctx.fillRect(bx - 9 + i * 6, by - 8, 4, 4);
        }
      }
      // turret (falls first)
      if (!acc1) {
        ctx.fillStyle = cfg.accent;
        ctx.fillRect(bx - 5, by - 12, 10, 5);
      }
      // flag (falls second)
      if (!acc2) {
        ctx.strokeStyle = cfg.accent; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(bx + 5, by - 12); ctx.lineTo(bx + 5, by - 20); ctx.stroke();
        ctx.fillStyle = cfg.color;
        ctx.fillRect(bx + 5, by - 20, 8, 5);
      }
      // wall crumbles (acc3 → body cracks)
      if (acc3 && !shatter) {
        ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(bx - 3, by - 4); ctx.lineTo(bx + 2, by + 4); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bx + 4, by - 2); ctx.lineTo(bx - 1, by + 6); ctx.stroke();
      }
    } else if (pType === 'N') {
      // Knight: a horse head + body
      if (!shatter) {
        // body
        ctx.fillStyle = cfg.color;
        ctx.beginPath(); ctx.ellipse(bx, by + 2, 8, 6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = cfg.accent; ctx.lineWidth = 1;
        ctx.stroke();
      }
      // head (falls as acc2)
      if (!acc2) {
        ctx.fillStyle = cfg.color;
        ctx.beginPath(); ctx.ellipse(bx + 6, by - 8, 6, 5, .3, 0, Math.PI * 2); ctx.fill();
        // eye
        ctx.fillStyle = '#1a0a2e'; ctx.beginPath(); ctx.arc(bx + 8, by - 9, 1.2, 0, Math.PI * 2); ctx.fill();
        // ear
        ctx.fillStyle = cfg.accent;
        ctx.beginPath(); ctx.moveTo(bx + 4, by - 13); ctx.lineTo(bx + 6, by - 17); ctx.lineTo(bx + 8, by - 13); ctx.fill();
      }
      // mane (falls first)
      if (!acc1) {
        ctx.fillStyle = cfg.accent;
        ctx.beginPath(); ctx.moveTo(bx + 2, by - 10); ctx.quadraticCurveTo(bx + 4, by - 16, bx + 8, by - 12); ctx.stroke();
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(bx + 3, by - 9); ctx.quadraticCurveTo(bx + 5, by - 14, bx + 7, by - 11); ctx.stroke();
      }
      // tail (falls third)
      if (!acc3) {
        ctx.strokeStyle = cfg.accent; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(bx - 8, by + 4); ctx.quadraticCurveTo(bx - 14, by + 2, bx - 12, by - 2); ctx.stroke();
      }
      // legs
      if (!arm1) {
        ctx.beginPath(); ctx.moveTo(bx - 3, by + 6); ctx.lineTo(bx - 5, by + 14); ctx.stroke();
      }
      if (!arm2) {
        ctx.beginPath(); ctx.moveTo(bx + 3, by + 6); ctx.lineTo(bx + 5, by + 14); ctx.stroke();
      }
    } else {
      // humanoids: P, B, Q, K — stick figure base with type-specific accessories
      // head
      if (!shatter || p < 0.95) {
        ctx.fillStyle = cfg.color;
        ctx.beginPath(); ctx.arc(bx, by - 14, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1a0a2e';
        ctx.beginPath(); ctx.arc(bx - 1.5, by - 15, 1, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(bx + 1.5, by - 15, 1, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = cfg.color; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(bx, by - 12, 2.5, 0.2, Math.PI - 0.2); ctx.stroke();
      }
      // body
      if (!shatter) {
        ctx.beginPath(); ctx.moveTo(bx, by - 9); ctx.lineTo(bx, by + 2); ctx.stroke();
      }
      // type-specific accessories (fall off in early phases)
      if (pType === 'P') {
        // helmet (acc1), shield (acc2), sword (acc3)
        if (!acc1) {
          ctx.fillStyle = cfg.accent;
          ctx.beginPath(); ctx.arc(bx, by - 16, 6, Math.PI, 0); ctx.fill();
          ctx.fillRect(bx - 6, by - 16, 12, 2);
        }
        if (!acc2) {
          ctx.fillStyle = cfg.accent;
          ctx.beginPath(); ctx.ellipse(bx - 9, by - 2, 4, 5, -.3, 0, Math.PI * 2); ctx.fill();
        }
        if (!acc3) {
          ctx.strokeStyle = cfg.accent; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(bx + 8, by - 4); ctx.lineTo(bx + 8, by + 8); ctx.stroke();
        }
      } else if (pType === 'B') {
        // mitre (acc1), staff (acc2), robe (acc3)
        if (!acc1) {
          ctx.fillStyle = cfg.accent;
          ctx.beginPath(); ctx.moveTo(bx - 4, by - 14); ctx.lineTo(bx, by - 22); ctx.lineTo(bx + 4, by - 14); ctx.fill();
        }
        if (!acc2) {
          ctx.strokeStyle = cfg.accent; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(bx + 7, by - 4); ctx.lineTo(bx + 7, by + 10); ctx.stroke();
        }
        if (!acc3) {
          ctx.fillStyle = cfg.color; ctx.globalAlpha = .4;
          ctx.beginPath(); ctx.moveTo(bx - 6, by - 9); ctx.lineTo(bx - 8, by + 10); ctx.lineTo(bx + 8, by + 10); ctx.lineTo(bx + 6, by - 9); ctx.fill();
          ctx.globalAlpha = 1;
        }
      } else if (pType === 'Q') {
        // crown (acc1), scepter (acc2), cape (acc3)
        if (!acc1) {
          ctx.fillStyle = cfg.accent;
          ctx.beginPath();
          ctx.moveTo(bx - 6, by - 14); ctx.lineTo(bx - 4, by - 20); ctx.lineTo(bx - 2, by - 14);
          ctx.lineTo(bx, by - 21); ctx.lineTo(bx + 2, by - 14); ctx.lineTo(bx + 4, by - 20);
          ctx.lineTo(bx + 6, by - 14); ctx.fill();
        }
        if (!acc2) {
          ctx.strokeStyle = cfg.accent; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(bx + 7, by - 4); ctx.lineTo(bx + 7, by + 10); ctx.stroke();
          ctx.fillStyle = cfg.accent;
          ctx.beginPath(); ctx.arc(bx + 7, by - 5, 2.5, 0, Math.PI * 2); ctx.fill();
        }
        if (!acc3) {
          ctx.fillStyle = cfg.color; ctx.globalAlpha = .35;
          ctx.beginPath(); ctx.moveTo(bx - 7, by - 9); ctx.quadraticCurveTo(bx - 12, by + 4, bx - 8, by + 12);
          ctx.lineTo(bx + 8, by + 12); ctx.quadraticCurveTo(bx + 12, by + 4, bx + 7, by - 9); ctx.fill();
          ctx.globalAlpha = 1;
        }
      } else if (pType === 'K') {
        // crown (acc1), sword (acc2), cape (acc3)
        if (!acc1) {
          ctx.fillStyle = cfg.accent;
          ctx.fillRect(bx - 6, by - 18, 12, 4);
          ctx.fillRect(bx - 1, by - 22, 2, 6);
        }
        if (!acc2) {
          ctx.strokeStyle = cfg.accent; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(bx + 7, by - 4); ctx.lineTo(bx + 7, by + 8); ctx.stroke();
          ctx.fillStyle = cfg.accent;
          ctx.beginPath(); ctx.moveTo(bx + 5, by + 8); ctx.lineTo(bx + 9, by + 8); ctx.lineTo(bx + 7, by + 12); ctx.fill();
        }
        if (!acc3) {
          ctx.fillStyle = cfg.color; ctx.globalAlpha = .35;
          ctx.beginPath(); ctx.moveTo(bx - 7, by - 9); ctx.quadraticCurveTo(bx - 12, by + 4, bx - 8, by + 12);
          ctx.lineTo(bx + 8, by + 12); ctx.quadraticCurveTo(bx + 12, by + 4, bx + 7, by - 9); ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
      // arms (fall off as acc1/acc2 for humanoids, acc1/acc3 for others)
      const armsGone1 = (pType === 'R' || pType === 'N') ? acc2 : arm1;
      const armsGone2 = (pType === 'R' || pType === 'N') ? acc3 : arm2;
      if (!armsGone1) {
        ctx.beginPath(); ctx.moveTo(bx, by - 6); ctx.lineTo(bx - 9, by - 2); ctx.stroke();
      }
      if (!armsGone2) {
        ctx.beginPath(); ctx.moveTo(bx, by - 6); ctx.lineTo(bx + 9, by - 2); ctx.stroke();
      }
      // legs (fall off as leg1/leg2)
      if (!leg1) {
        ctx.beginPath(); ctx.moveTo(bx, by + 2); ctx.lineTo(bx - 5, by + 12); ctx.stroke();
      }
      if (!leg2) {
        ctx.beginPath(); ctx.moveTo(bx, by + 2); ctx.lineTo(bx + 5, by + 12); ctx.stroke();
      }
    }

    // flying severed limbs/accessories
    const limbFly = (startP, ang, col) => {
      const k = Math.min(1, (p - startP) / 0.16);
      if (k <= 0) return;
      const dist = k * 26;
      const lx = bx + Math.cos(ang) * dist, ly = by + Math.sin(ang) * dist;
      ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.globalAlpha = 1 - k * 0.6;
      ctx.beginPath(); ctx.moveTo(lx - 4, ly - 2); ctx.lineTo(lx + 4, ly + 2); ctx.stroke();
      ctx.restore();
    };
    if (pType === 'R') {
      if (acc1) limbFly(0.10, -1.8);
      if (acc2) limbFly(0.26, -0.6);
      if (acc3) limbFly(0.42, 1.2);
    } else if (pType === 'N') {
      if (acc1) limbFly(0.10, -2.0);
      if (acc2) limbFly(0.26, -0.8);
      if (acc3) limbFly(0.42, 1.5);
      if (arm1) limbFly(0.18, -2.2);
      if (leg1) limbFly(0.34, 2.6);
    } else {
      if (acc1) limbFly(0.10, -2.0);
      if (acc2) limbFly(0.26, -0.5);
      if (acc3) limbFly(0.42, 1.2);
      if (arm1) limbFly(0.18, -2.2);
      if (leg1) limbFly(0.34, 2.6);
      if (arm2) limbFly(0.50, -0.9);
      if (leg2) limbFly(0.66, 2.0);
    }

    // Monty Python speech bubbles (per-type quotes)
    const bubble = (txt, phase) => {
      if (p < phase || p > phase + 0.22) return;
      const k = (p - phase) / 0.22;
      const alpha = k < .2 ? k * 5 : (k > .8 ? (1 - k) * 5 : 1);
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.strokeStyle = '#ff4d6d'; ctx.lineWidth = 1.5;
      const bx2 = cx + 30, by2 = cy - 40;
      ctx.beginPath(); ctx.roundRect(bx2 - 4, by2 - 12, 132, 24, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1a0a2e'; ctx.font = '600 9px Inter,sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(txt, bx2 + 62, by2 + 2);
      ctx.restore();
    };
    bubble(cfg.quotes[0], 0.10);
    bubble(cfg.quotes[1], 0.26);
    bubble(cfg.quotes[2], 0.50);
    bubble(cfg.quotes[3], 0.66);

    // clash flash
    if (p > 0.12 && p < 0.72) {
      ctx.fillStyle = 'rgba(255,220,120,' + (1 - Math.abs(p - 0.42) * 2.5) + ')';
      ctx.beginPath(); ctx.arc(cx, cy, 14 + (p - 0.12) * 30, 0, Math.PI * 2); ctx.fill();
    }
    // final shatter
    if (shatter) {
      const sh = (p - 0.82) / 0.18;
      for (let i = 0; i < 18; i++) {
        const ang = (i / 18) * Math.PI * 2 + i * 0.3;
        const dist = sh * (16 + (i % 4) * 8);
        const sx2 = cx + Math.cos(ang) * dist, sy2 = cy + Math.sin(ang) * dist;
        const sz = (1 - sh) * 5 + 1;
        ctx.fillStyle = i % 3 === 0 ? 'rgba(255,255,255,.9)' : (i % 3 === 1 ? 'rgba(200,180,255,.85)' : 'rgba(120,80,200,.7)');
        ctx.beginPath(); ctx.arc(sx2, sy2, sz, 0, Math.PI * 2); ctx.fill();
      }
      if (p > 0.92) {
        ctx.save(); ctx.globalAlpha = (p - 0.92) * 12.5;
        ctx.fillStyle = 'rgba(255,255,255,.95)';
        ctx.font = 'bold 11px Inter,sans-serif'; ctx.textAlign = 'center';
        ctx.fillText("I yield! ...okay, I'm dead.", cx, cy - 30);
        ctx.restore();
      }
    }
  }

  // attacker slides in
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
  if (!board || winner) return;
  if (!soloMode && turn !== mySide) return;
  const r = boardC.getBoundingClientRect();
  const sx = e._sx || (boardC.width / r.width), sy = e._sy || (boardC.height / r.height);
  const x = Math.floor((e.clientX - r.left) * sx / SQ);
  const y = Math.floor((e.clientY - r.top) * sy / SQ);
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
  const p = board[y][x];
  const myColor = soloMode ? (turn === 'white' ? 'w' : 'b') : (mySide === 'white' ? 'w' : 'b');
  if (p && p[0] === myColor) {
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
  const p = board[y][x];
  if (!p) return [];
  const side = p[0], type = p[1];
  const out = [];
  const add = (nx, ny) => { if (nx < 0 || nx > 7 || ny < 0 || ny > 7) return; const t = board[ny][nx]; if (t && t[0] === side) return; out.push({x: nx, y: ny, promo: null}); };
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
      body: JSON.stringify({room: roomId, vid: vid(), from: FILES[fx] + (8 - fy), to: FILES[tx] + (8 - ty), promo})}).then(x => x.json());
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
  roomId = null; mySide = null; board = null; selected = null; legalTargets = []; anim = null; soloMode = false;
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
    else st.textContent = (turn === 'white' ? 'White' : 'Black') + ' to move' + (soloMode ? ' · solo' : (mySide ? ' · you are ' + mySide : ' · spectating'));
  }
}

function showLobby() {
  lobbyEl.style.display = 'block'; boardC.style.display = 'none';
  lobbyEl.innerHTML = `<div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <button id="chCreate" style="padding:8px 14px;border-radius:10px;border:1px solid rgba(242,193,78,.5);background:rgba(242,193,78,.15);color:#f6e7c8;cursor:pointer;font:600 13px Inter">Create a table</button>
      <button id="chSolo" style="padding:8px 14px;border-radius:10px;border:1px solid #4fc0d0;background:rgba(79,192,208,.15);color:#f6e7c8;cursor:pointer;font:600 13px Inter">Solo game</button>
      <button id="chRefresh" style="padding:8px 14px;border-radius:10px;border:1px solid #444;background:#1a1a2e;color:#f6e7c8;cursor:pointer;font:600 13px Inter">Refresh</button></div>
    <div id="chRooms"></div>`;
  lobbyEl.querySelector('#chCreate').onclick = createRoom;
  lobbyEl.querySelector('#chSolo').onclick = createSoloRoom;
  lobbyEl.querySelector('#chRefresh').onclick = listRooms;
  listRooms();
}

async function createRoom() {
  try {
    const r = await fetch('/api/chess/create', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: 'Chess table', vid: vid(), pname: name()})}).then(x => x.json());
    if (!r.ok) throw new Error(r.error);
    roomId = r.id; mySide = r.side; soloMode = false; enterRoom();
  } catch (e) { alert(e.message || 'Could not create.'); }
}
async function createSoloRoom() {
  try {
    const r = await fetch('/api/chess/create', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: 'Solo game', vid: vid(), pname: name(), solo: true})}).then(x => x.json());
    if (!r.ok) throw new Error(r.error);
    roomId = r.id; mySide = 'white'; soloMode = true; enterRoom();
  } catch (e) { alert(e.message || 'Could not create.'); }
}

async function joinRoom(id) {
  try {
    const r = await fetch('/api/chess/join', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({room: id, vid: vid(), pname: name()})}).then(x => x.json());
    if (!r.ok) throw new Error(r.error);
    roomId = id; mySide = r.side || mySide; enterRoom();
  } catch (e) { alert(e.message || 'Could not join.'); }
}

async function listRooms() {
  try {
    const r = await fetch('/api/chess/rooms', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'}).then(x => x.json());
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