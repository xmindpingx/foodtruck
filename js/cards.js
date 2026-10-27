// cards.js — 🃏 Card Games table on the lot. Multiple classic card games with themed animations.
import {CONFIG} from './shop.js?v=7';
import * as Account from './account.js?v=7';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

let panel, body, ctx, canvas;
let game = 'menu'; // 'menu' | 'gofish' | 'war' | 'crazy8' | 'slapjack' | 'speed' | 'president'

function buildUI() {
  panel = document.createElement('div');
  panel.id = 'eolCards'; panel.hidden = true; panel.style.display = 'none';
  panel.style.cssText = 'position:fixed;inset:0;z-index:80;display:none;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,.92);backdrop-filter:blur(4px);font:13px/1.4 Inter,sans-serif;color:#f6e7c8';
  panel.innerHTML = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <b style="font-size:16px">🃏 Card Games</b>
      <span id="cardsStatus" style="opacity:.7;font-size:12px"></span>
      <button id="cardsX" style="margin-left:auto;background:none;border:0;color:#f6e7c8;font-size:18px;cursor:pointer">✕</button></div>
    <div id="cardsBody" style="width:min(92vw,600px);background:#141021;border:1px solid rgba(242,193,78,.3);border-radius:14px;padding:14px;max-height:78vh;overflow:auto"></div>`;
  document.body.appendChild(panel);
  body = panel.querySelector('#cardsBody');
  panel.querySelector('#cardsX').onclick = () => { panel.style.display = 'none'; panel.hidden = true; };
  showMenu();
}

function showMenu() {
  game = 'menu';
  body.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
    <button class="cardBtn" data-g="gofish">🎣 Go Fish</button>
    <button class="cardBtn" data-g="war">💥 War</button>
    <button class="cardBtn" data-g="crazy8">8️⃣ Crazy Eights</button>
    <button class="cardBtn" data-g="slapjack">✋ Slapjack</button>
    <button class="cardBtn" data-g="speed">⚡ Speed</button>
    <button class="cardBtn" data-g="president">👑 President</button>
  </div>
  <p style="opacity:.6;font-size:11px;margin-top:10px">Tap a game to play. (Animations are themed per game.)</p>`;
  body.querySelectorAll('.cardBtn').forEach(b => b.onclick = () => startGame(b.dataset.g));
  body.querySelectorAll('.cardBtn').forEach(b => b.style.cssText = 'padding:12px;border-radius:10px;border:1px solid rgba(242,193,78,.4);background:rgba(242,193,78,.12);color:#f6e7c8;cursor:pointer;font:600 13px Inter');
}

// ---------- Go Fish ----------
function startGame(g) {
  game = g;
  if (g === 'gofish') startGoFish();
  else if (g === 'war') startWar();
  else startStub(g);
}

function startStub(g) {
  body.innerHTML = `<p>🎮 ${g} — coming soon.</p><button onclick="showMenu()" style="padding:8px 14px;border-radius:10px;border:1px solid #444;background:#1a1a2e;color:#f6e7c8;cursor:pointer">← Back</button>`;
  body.querySelector('button').onclick = showMenu;
}

// Go Fish: simple 1v1 vs AI
function startGoFish() {
  const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const suits = ['♠','♥','♦','♣'];
  let deck = [];
  for (const r of ranks) for (const s of suits) deck.push(r + s);
  // shuffle
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  const hand = deck.splice(0, 7);
  const aiHand = deck.splice(0, 7);
  let books = 0, aiBooks = 0;
  let turn = 'player';
  let msg = 'Your turn. Ask for a rank.';

  function render() {
    body.innerHTML = `
      <div style="margin-bottom:6px">You: ${hand.join(' ')} · Books: ${books}</div>
      <div style="margin-bottom:6px">AI: ${aiHand.length} cards · Books: ${aiBooks}</div>
      <div style="margin-bottom:8px;color:#f2c14e">${msg}</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px">
        ${ranks.map(r => `<button class="askBtn" data-r="${r}" style="padding:4px 8px;border-radius:8px;border:1px solid #444;background:#1a1a2e;color:#f6e7c8;cursor:pointer">${r}</button>`).join('')}
      </div>
      <button id="gfBack" style="padding:8px 14px;border-radius:10px;border:1px solid #444;background:#1a1a2e;color:#f6e7c8;cursor:pointer">← Back</button>`;
    body.querySelector('#gfBack').onclick = showMenu;
    body.querySelectorAll('.askBtn').forEach(b => b.onclick = () => ask(b.dataset.r));
  }

  function ask(rank) {
    if (turn !== 'player') return;
    const matches = aiHand.filter(c => c.startsWith(rank));
    if (matches.length) {
      // fishing animation
      msg = `Got ${matches.length} ${rank}(s)!`;
      hand.push(...matches);
      aiHand.splice(0, aiHand.length, ...aiHand.filter(c => !c.startsWith(rank)));
      turn = 'player';
    } else {
      msg = 'Go fish!';
      if (deck.length) { hand.push(deck.pop()); }
      turn = 'ai';
    }
    checkBooks();
    render();
    if (turn === 'ai') setTimeout(aiTurn, 800);
  }

  function aiTurn() {
    if (turn !== 'ai') return;
    const r = ranks[Math.floor(Math.random() * ranks.length)];
    const matches = hand.filter(c => c.startsWith(r));
    if (matches.length) {
      msg = `AI took ${matches.length} ${r}(s)!`;
      aiHand.push(...matches);
      hand.splice(0, hand.length, ...hand.filter(c => !c.startsWith(r)));
    } else {
      msg = 'AI goes fish!';
      if (deck.length) aiHand.push(deck.pop());
    }
    checkBooks();
    turn = 'player';
    render();
  }

  function checkBooks() {
    for (const r of ranks) {
      const ph = hand.filter(c => c.startsWith(r));
      if (ph.length === 4) { books++; hand.splice(0, hand.length, ...hand.filter(c => !c.startsWith(r))); }
      const ah = aiHand.filter(c => c.startsWith(r));
      if (ah.length === 4) { aiBooks++; aiHand.splice(0, aiHand.length, ...aiHand.filter(c => !c.startsWith(r))); }
    }
    if (hand.length === 0 && deck.length === 0) {
      msg = books > aiBooks ? 'You win!' : books < aiBooks ? 'AI wins!' : 'Draw!';
      turn = 'done';
    }
  }

  render();
}

// War: simple 1v1
function startWar() {
  const ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const suits = ['♠','♥','♦','♣'];
  let deck = [];
  for (const r of ranks) for (const s of suits) deck.push(r + s);
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  const pH = deck.splice(0, 26);
  const aH = deck.splice(0, 26);
  let msg = 'Tap "Battle" to flip cards.';
  let pHCard = null, aHCard = null;

  function rankValue(c) { return ranks.indexOf(c.slice(0, -1)); }

  function render() {
    body.innerHTML = `
      <div style="margin-bottom:6px">You: ${pH.length} cards · ${pHCard ? pHCard : ''}</div>
      <div style="margin-bottom:6px">AI: ${aH.length} cards · ${aHCard ? aHCard : ''}</div>
      <div style="margin-bottom:8px;color:#f2c14e">${msg}</div>
      <button id="warBattle" style="padding:8px 14px;border-radius:10px;border:1px solid #43a047;background:rgba(67,160,71,.2);color:#f6e7c8;cursor:pointer;font:600 12px Inter;margin-right:6px">Battle</button>
      <button id="warBack" style="padding:8px 14px;border-radius:10px;border:1px solid #444;background:#1a1a2e;color:#f6e7c8;cursor:pointer;font:600 12px Inter">← Back</button>`;
    body.querySelector('#warBack').onclick = showMenu;
    body.querySelector('#warBattle').onclick = battle;
  }

  function battle() {
    if (!pH.length || !aH.length) { msg = pH.length ? 'You win!' : 'AI wins!'; render(); return; }
    pHCard = pH.shift(); aHCard = aH.shift();
    const pv = rankValue(pHCard), av = rankValue(aHCard);
    if (pv > av) { msg = 'You win the battle!'; pH.push(pHCard, aHCard); }
    else if (av > pv) { msg = 'AI wins the battle!'; aH.push(pHCard, aHCard); }
    else { msg = 'War!'; // simplified: split
      pH.push(pHCard); aH.push(aHCard);
    }
    pHCard = null; aHCard = null;
    render();
  }

  render();
}

function init() {
  if (window.__EOL_LITE) return;
  buildUI();
  addEventListener('eol:cards-open', () => { panel.hidden = false; panel.style.display = 'flex'; if (!body) buildUI(); });
  addEventListener('eol:menu-open', () => { if (panel) { panel.style.display = 'none'; panel.hidden = true; } });
}

init();
window.__EOL_CARDS_OPEN = () => {
  if (!panel) buildUI();
  panel.hidden = false; panel.style.display = 'flex';
  showMenu();
};