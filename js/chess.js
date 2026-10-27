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
  const skin = isW ? '#f0d8b8' : '#c8a080';
  const skinSh = isW ? '#d8c0a0' : '#a88060';
  const cloth = isW ? '#e8f0ff' : '#6a4a8a';
  const clothD = isW ? '#b8c8e8' : '#4a2a6a';
  const accent = isW ? '#ffd24d' : '#ff4d6d';
  const hair = isW ? '#d9b23a' : '#2a1040';
  const r = SQ * 0.42;
  const headR = r * 0.42;
  const bodyW = r * 0.5, bodyH = r * 0.55;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
  // body
  ctx.fillStyle = cloth;
  ctx.beginPath(); ctx.ellipse(cx, cy + r*0.15, bodyW, bodyH, 0, 0, Math.PI*2); ctx.fill();
  const bodyGrad = ctx.createLinearGradient(cx - bodyW, cy, cx + bodyW, cy);
  bodyGrad.addColorStop(0, clothD); bodyGrad.addColorStop(0.5, cloth); bodyGrad.addColorStop(1, clothD);
  ctx.fillStyle = bodyGrad;
  ctx.beginPath(); ctx.ellipse(cx, cy + r*0.15, bodyW*0.9, bodyH*0.9, 0, 0, Math.PI*2); ctx.fill();
  // legs
  ctx.fillStyle = clothD;
  ctx.fillRect(cx - bodyW*0.5, cy + r*0.35, bodyW*0.4, r*0.35);
  ctx.fillRect(cx + bodyW*0.1, cy + r*0.35, bodyW*0.4, r*0.35);
  // shoes
  ctx.fillStyle = isW ? '#8a6b3f' : '#2b1b3a';
  ctx.fillRect(cx - bodyW*0.55, cy + r*0.65, bodyW*0.5, r*0.12);
  ctx.fillRect(cx + bodyW*0.05, cy + r*0.65, bodyW*0.5, r*0.12);
  // arms
  ctx.fillStyle = cloth;
  ctx.fillRect(cx - bodyW - r*0.12, cy - r*0.05, r*0.18, r*0.45);
  ctx.fillRect(cx + bodyW - r*0.06, cy - r*0.05, r*0.18, r*0.45);
  // hands
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(cx - bodyW - r*0.03, cy + r*0.42, r*0.09, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + bodyW + r*0.03, cy + r*0.42, r*0.09, 0, Math.PI*2); ctx.fill();
  // head
  const hx = cx, hy = cy - r*0.55;
  ctx.fillStyle = hair;
  ctx.beginPath(); ctx.arc(hx, hy - headR*0.1, headR*1.05, Math.PI, 0); ctx.fill();
  ctx.fillRect(hx - headR*0.9, hy - headR*0.1, headR*1.8, headR*0.35);
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(hx, hy, headR, 0, Math.PI*2); ctx.fill();
  const faceGrad = ctx.createRadialGradient(hx - headR*0.2, hy - headR*0.2, headR*0.1, hx, hy, headR);
  faceGrad.addColorStop(0, skin); faceGrad.addColorStop(1, skinSh);
  ctx.fillStyle = faceGrad;
  ctx.beginPath(); ctx.arc(hx, hy, headR*0.95, 0, Math.PI*2); ctx.fill();
  // eyes (big Sims eyes)
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.ellipse(hx - headR*0.3, hy - headR*0.05, headR*0.22, headR*0.25, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(hx + headR*0.3, hy - headR*0.05, headR*0.22, headR*0.25, 0, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = isW ? '#4a6fb5' : '#8a4bd1';
  ctx.beginPath(); ctx.arc(hx - headR*0.3, hy - headR*0.05, headR*0.13, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(hx + headR*0.3, hy - headR*0.05, headR*0.13, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath(); ctx.arc(hx - headR*0.3, hy - headR*0.05, headR*0.07, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(hx + headR*0.3, hy - headR*0.05, headR*0.07, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.8)';
  ctx.beginPath(); ctx.arc(hx - headR*0.25, hy - headR*0.12, headR*0.05, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(hx + headR*0.35, hy - headR*0.12, headR*0.05, 0, Math.PI*2); ctx.fill();
  // eyebrows
  ctx.strokeStyle = hair; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(hx - headR*0.45, hy - headR*0.22); ctx.lineTo(hx - headR*0.15, hy - headR*0.28); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(hx + headR*0.45, hy - headR*0.22); ctx.lineTo(hx + headR*0.15, hy - headR*0.28); ctx.stroke();
  // nose
  ctx.fillStyle = skinSh;
  ctx.beginPath(); ctx.arc(hx, hy + headR*0.1, headR*0.08, 0, Math.PI*2); ctx.fill();
  // mouth
  ctx.strokeStyle = '#b05050'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(hx, hy + headR*0.25, headR*0.18, 0.2, Math.PI - 0.2); ctx.stroke();
  // ears
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.ellipse(hx - headR*0.95, hy, headR*0.12, headR*0.18, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(hx + headR*0.95, hy, headR*0.12, headR*0.18, 0, 0, Math.PI*2); ctx.fill();
  ctx.restore();
  // ---- role-specific accessories (mythical god features) ----
  if (type === 'K') {
    ctx.fillStyle = accent;
    ctx.fillRect(hx - headR*0.7, hy - headR*1.15, headR*1.4, headR*0.25);
    for (let i = 0; i < 5; i++) {
      const px = hx - headR*0.6 + i * headR*0.3;
      ctx.beginPath(); ctx.moveTo(px, hy - headR*1.15); ctx.lineTo(px + headR*0.1, hy - headR*1.4); ctx.lineTo(px + headR*0.2, hy - headR*1.15); ctx.fill();
    }
    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx + bodyW + r*0.1, cy - r*0.05); ctx.lineTo(cx + bodyW + r*0.1, cy - r*0.9); ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(cx + bodyW + r*0.1, cy - r*0.95, r*0.12, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = accent; ctx.font = 'bold 10px Inter'; ctx.textAlign = 'center';
    ctx.fillText('⚡', cx, cy + r*0.05);
  } else if (type === 'Q') {
    ctx.fillStyle = accent;
    ctx.fillRect(hx - headR*0.7, hy - headR*1.15, headR*1.4, headR*0.2);
    for (let i = 0; i < 3; i++) {
      const px = hx - headR*0.5 + i * headR*0.5;
      ctx.beginPath(); ctx.arc(px, hy - headR*1.25, headR*0.1, 0, Math.PI*2); ctx.fill();
    }
    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx + bodyW + r*0.1, cy - r*0.05); ctx.lineTo(cx + bodyW + r*0.1, cy - r*0.9); ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(cx + bodyW + r*0.1, cy - r*0.95, r*0.1, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = clothD; ctx.globalAlpha = .4;
    ctx.beginPath(); ctx.moveTo(cx - bodyW, cy + r*0.3); ctx.lineTo(cx - bodyW*1.3, cy + r*0.8); ctx.lineTo(cx + bodyW*1.3, cy + r*0.8); ctx.lineTo(cx + bodyW, cy + r*0.3); ctx.fill();
    ctx.globalAlpha = 1;
  } else if (type === 'R') {
    ctx.fillStyle = accent;
    ctx.fillRect(hx - headR*0.8, hy - headR*1.0, headR*1.6, headR*0.3);
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(hx - headR*0.7 + i * headR*0.35, hy - headR*1.25, headR*0.25, headR*0.25);
    }
    ctx.fillStyle = accent; ctx.globalAlpha = .6;
    ctx.beginPath(); ctx.ellipse(cx - bodyW - r*0.15, cy + r*0.1, r*0.15, r*0.2, 0, 0, Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx + bodyW + r*0.1, cy - r*0.05); ctx.lineTo(cx + bodyW + r*0.1, cy - r*0.9); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + bodyW + r*0.1 - r*0.08, cy - r*0.85); ctx.lineTo(cx + bodyW + r*0.1, cy - r*0.95); ctx.lineTo(cx + bodyW + r*0.1 + r*0.08, cy - r*0.85); ctx.stroke();
  } else if (type === 'B') {
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.moveTo(hx, hy - headR*1.5); ctx.lineTo(hx - headR*0.5, hy - headR*0.6); ctx.lineTo(hx + headR*0.5, hy - headR*0.6); ctx.fill();
    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx + bodyW + r*0.1, cy - r*0.05); ctx.lineTo(cx + bodyW + r*0.1, cy - r*0.9); ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(cx + bodyW + r*0.1, cy - r*0.95, r*0.08, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = accent; ctx.font = 'bold 10px Inter'; ctx.textAlign = 'center';
    ctx.fillText('\\u2600', cx, cy + r*0.05);
  } else if (type === 'N') {
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(hx, hy - headR*0.1, headR*1.1, Math.PI*0.7, Math.PI*2.3); ctx.fill();
    ctx.fillStyle = isW ? '#ff4d6d' : '#ffd24d';
    ctx.beginPath(); ctx.moveTo(hx, hy - headR*1.1); ctx.quadraticCurveTo(hx + headR*0.3, hy - headR*1.5, hx + headR*0.1, hy - headR*1.3); ctx.fill();
    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx + bodyW + r*0.1, cy - r*0.05); ctx.lineTo(cx + bodyW + r*0.1, cy - r*0.9); ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.moveTo(cx + bodyW + r*0.1 - r*0.06, cy - r*0.85); ctx.lineTo(cx + bodyW + r*0.1, cy - r*0.95); ctx.lineTo(cx + bodyW + r*0.1 + r*0.06, cy - r*0.85); ctx.fill();
  } else {
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(hx, hy - headR*0.1, headR*0.9, Math.PI, 0); ctx.fill();
    ctx.fillRect(hx - headR*0.9, hy - headR*0.1, headR*1.8, headR*0.2);
    ctx.strokeStyle = accent; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx + bodyW + r*0.1, cy - r*0.05); ctx.lineTo(cx + bodyW + r*0.1, cy - r*0.9); ctx.stroke();
  }
  // specular highlight
  ctx.fillStyle = isW ? 'rgba(255,255,255,.45)' : 'rgba(200,180,255,.25)';
  ctx.beginPath(); ctx.ellipse(cx - r*0.15, cy - r*0.2, r*0.2, r*0.12, -.4, 0, Math.PI*2); ctx.fill();
}
function startBattleAnim(mv) {
  if (!mv) return;
  const from = mv.from, to = mv.to;
  const fx = from.charCodeAt(0) - 97, fy = parseInt(from[1]) - 1;
  const tx = to.charCodeAt(0) - 97, ty = parseInt(to[1]) - 1;
  const captured = mv.captured;
  anim = {from: {x: fx, y: fy}, to: {x: tx, y: ty},
          captured: captured ? {x: tx, y: ty, piece: captured} : null,
          phase: 0, t0: performance.now(), dur: captured ? 2100 : 320};
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
  const e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  const ax = sx + (ex - sx) * (p < .4 ? e * .6 : .6 + (p - .4) * .67);
  const ay = sy + (ey - sy) * (p < .4 ? e * .6 : .6 + (p - .4) * .67);
  const cx = ex, cy = ey;

  // determine captured piece type
  const capturedPiece = (anim.captured && anim.captured.piece) ? anim.captured.piece : '';
  const pType = capturedPiece.length >= 2 ? capturedPiece[1] : 'P';
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