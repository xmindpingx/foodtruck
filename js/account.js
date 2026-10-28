// account.js — arcade accounts: the phone number IS the account number (flat file on the server,
// data/accounts.json — no passwords by owner request). SIGN-UP is optimized for phones:
// language first (two big links: English · Español), then a tel-keypad number and a display
// name. The chosen language drives every word of this panel, the chat chips (avatars.js) and
// the assistant's replies. Unsigned visitors queue minigame prize mints locally and they
// flush to the server on sign-in.
const KEY = 'eolAcct';                    // {phone, name} — the remembered sign-in
const QUEUE = 'eolPrizeQueue';            // [{item,label,src}] minted once the visitor signs in
const LANG_KEY = 'eol-lang';
const jget = async u => { const r = await fetch(u); if (!r.ok) throw Object.assign(new Error('http ' + r.status), {status: r.status}); return r.json(); };
const jpost = async (u, b) => { const r = await fetch(u, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(b)}); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || 'http ' + r.status), {status: r.status}); return j; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

export let phone = '';          // '' = not signed in
export let profile = null;      // last /api/account/who payload
let pill, panel, shop = [];
let LANG = 'en';                // last language picked on this browser (sign-up asks FIRST)
try { if (localStorage.getItem(LANG_KEY) === 'es') LANG = 'es'; } catch (e) {}   // read at load so pages that never mount the pill (the lite page) still follow it

const T = {
  en: {
    langHint: 'Pick your language first — the whole site follows it',
    langA: '🇺🇸 English — Sign in / Sign up',
    langB: '🇲🇽 Español — Iniciar sesión / Registrarse',
    head: 'Arcade account',
    info: 'Your <b>phone number</b> is the account — it banks your trivia points, saves every collectible, and puts your display name on the scoreboard. No password needed.',
    phonePh: '10-digit phone number',
    namePh: 'Pick a display name — it shows on the scoreboard!',
    go: 'Sign in / Sign up',
    nameMiss: 'Pick a display name — it shows on the scoreboard!',
    toastIn: 'Signed in — collect away! 🎉',
    collCap: 'Collection', collEmpty: 'No collectibles yet — win games or answer trivia!',
    shopCap: '🏬 Redeem points',
    out: 'Sign out',
    tip: 'Tap a language to switch it any time.',
  },
  es: {
    langHint: 'Elige tu idioma primero — todo el sitio lo sigue',
    langA: '🇺🇸 English — Sign in / Sign up',
    langB: '🇲🇽 Español — Iniciar sesión / Registrarse',
    head: 'Cuenta del arcade',
    info: 'Tu <b>número de teléfono</b> es la cuenta: guarda tus puntos de trivia, cada colección y tu nombre público en la pizarra. Sin contraseñas.',
    phonePh: 'número de 10 dígitos',
    namePh: 'Elige tu nombre público — ¡aparece en la pizarra!',
    go: 'Ingresar / Crear cuenta',
    nameMiss: 'Elige tu nombre público — ¡aparece en la pizarra!',
    toastIn: '¡Ya ingresaste — a coleccionar! 🎉',
    collCap: 'Colección', collEmpty: 'Aún no tienes coleccionables — ¡gana juegos o responde trivia!',
    shopCap: '🏬 Canjear puntos',
    out: 'Cerrar sesión',
    tip: 'Toca el idioma para cambiarlo cuando quieras.',
  },
};
const t = () => T[LANG] || T.en;

export const signed = () => !!phone;
export const name = () => (profile && profile.name) || 'Guest';
export const points = () => (profile && profile.points) || 0;
export const lang = () => ((profile && profile.lang) === 'es' ? 'es' : (profile && profile.lang) === 'en' ? 'en' : LANG);

export function lsParse(k, d) { try { return JSON.parse(localStorage.getItem(k) || '') || d; } catch (e) { return d; } }
function toast(msg) {
  const t2 = document.createElement('div');
  t2.textContent = msg;
  t2.style.cssText = 'position:fixed;left:50%;bottom:86px;transform:translateX(-50%);z-index:60;' +
    'background:#221833;color:#f6e7c8;border:1px solid rgba(255,255,255,.3);border-radius:14px;padding:9px 16px;' +
    'font:600 13px Inter,system-ui,sans-serif;pointer-events:none;transition:opacity .5s;max-width:78vw;text-align:center';
  document.body.appendChild(t2);
  setTimeout(() => { t2.style.opacity = '0'; }, 2600);
  setTimeout(() => t2.remove(), 3200);
}
export function announceUpdate() { dispatchEvent(new Event('eol:account-updated')); }

function bumpLang(l) {
  LANG = l === 'es' ? 'es' : 'en';
  try { localStorage.setItem(LANG_KEY, LANG); } catch (e) {}
  if (signed()) {                          // keep the account's choice current (server-side too)
    jpost('/api/account/lang', {phone, lang: LANG}).then(j => { if (profile) profile.lang = LANG; announceUpdate(); }).catch(() => {});
  }
  render();                                // repaint with the new dictionary
  dispatchEvent(new Event('eol:lang'));    // chips + midway lobby re-paint in that language
}

// ---------- local prize queue for guests ----------
function queueLocal(row) {
  const q = lsParse(QUEUE, []);
  const ex = q.find(e => e.item === row.item);
  if (ex) ex.count = (ex.count || 1) + 1; else q.push({item: row.item, label: row.label, src: row.src || 'game', count: 1});
  try { localStorage.setItem(QUEUE, JSON.stringify(q.slice(-40))); } catch (e) {}
}
async function flushQueue() {
  const q = lsParse(QUEUE, []);
  if (!q.length || !signed()) return;
  const rest = [];
  for (const row of q) {
    try { await award(row.item, row.label, row.src); }
    catch (e) { rest.push(row); }
  }
  try { localStorage.setItem(QUEUE, JSON.stringify(rest)); } catch (e) {}
}

// ---------- server actions ----------
export async function enter(rawPhone, dispName) {
  const j = await jpost('/api/account/enter', {phone: rawPhone, name: dispName, lang: LANG});
  phone = j.phone; profile = j;
  try { localStorage.setItem(KEY, JSON.stringify({phone, name: j.name})); } catch (e) {}
  bumpLang(LANG);                          // pins the picked language on the account itself
  paint();
  announceUpdate();
  flushQueue();
  return j;
}
export async function refresh() {
  if (!phone) { profile = null; return; }
  try { profile = await jget('/api/account/who?phone=' + encodeURIComponent(phone)); }
  catch (e) {
    if (e.status === 404) {                     // the account record is gone server-side (fresh db) → forget
      phone = ''; profile = null;
      try { localStorage.removeItem(KEY); localStorage.removeItem(QUEUE); } catch (e2) {}
    }
  }
  paint();
}
export async function award(item, label, src) {
  if (!signed()) { queueLocal({item, label, src}); return {queued: true}; }
  const j = await jpost('/api/account/prize', {phone, item, label, src: src || 'game'});
  profile = j; paint(); announceUpdate();
  return j;
}
export async function redeem(item) {
  const row = shop.find(e => e.item === item);
  const j = await jpost('/api/account/redeem', {phone, item});
  profile = j; paint(); announceUpdate();
  toast(row ? row.label + ' added to your collection! 🪙 -' + row.cost : 'Collected!');
  return j;
}
export async function loadShop() {
  try { const j = await jget('/api/account/shop'); shop = j.items || []; } catch (e) { shop = []; }
  return shop;
}

// name of the visible phone tail for the pill title
const maskPhone = p => ('' + (p || '')).replace(/^.*(\d{4})$/, '••••$1');

// ---------- UI ----------
function paint() {
  if (!pill) return;
  const p = points();
  pill.textContent = signed() ? '👤 ' + Math.round(p) + ' pts · ⭐' + ((profile && profile.rep) || 0) : '👤 ' + (LANG === 'es' ? 'Ingresar / Crear cuenta' : 'Sign in / Sign up');
  pill.title = signed() ? (t().head + ' — ' + esc(name()) + ' (' + esc(maskPhone(phone)) + ')')
                        : t().info.replace(/<[^>]+>/g, '');
  if (panel && !panel.hidden) render();
}
function langLinks(small) {
  return `<div class="eolLangs">
    <button id="eolLangEn" class="eolLangLink${LANG === 'en' ? ' on' : ''}">${t().langA}</button>
    <button id="eolLangEs" class="eolLangLink${LANG === 'es' ? ' on' : ''}">${t().langB}</button>
  </div><div class="eolAcctTip">${esc(t().tip)}</div>`;
}
function render() {
  if (!panel) return;
  if (!signed()) {
    panel.innerHTML = `
      <div class="eolAcctHead"><b>🎪 ${esc(t().head)}</b><button class="eolAcctX" aria-label="Close">✕</button></div>
      <div class="eolAcctBody">
        ${langLinks()}
        <p class="eolAcctInfo">${t().info}</p>
        <input id="eolAcctPhone" type="tel" inputmode="numeric" pattern="[0-9]*" maxlength="10" autocomplete="tel" placeholder="${esc(t().phonePh)}">
        <input id="eolAcctName" maxlength="40" placeholder="${esc(t().namePh)}">
        <button id="eolAcctGo" class="eolAcctGo">${esc(t().go)}</button>
        <div class="eolAcctMsg" id="eolAcctMsg"></div>
      </div>`;
    panel.querySelector('.eolAcctX').onclick = close;
    const go = panel.querySelector('#eolAcctGo'), msg = panel.querySelector('#eolAcctMsg');
    const ph = panel.querySelector('#eolAcctPhone'), nm = panel.querySelector('#eolAcctName');
    ph.value = (lsParse(KEY, null) || {}).phone || '';
    // phone-keypad friendly: strip everything but digits as they type
    ph.addEventListener('input', () => { ph.value = ph.value.replace(/\D/g, '').slice(0, 10); });
    ph.addEventListener('keydown', e => { if (e.key === 'Enter' && ph.value.length >= 7) { e.preventDefault(); nm.focus(); } });
    nm.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go.click(); } });
    go.onclick = async () => {
      if (!nm.value.trim()) { msg.textContent = t().nameMiss; nm.focus(); return; }
      if (ph.value.length !== 10) { msg.textContent = esc(t().phonePh); ph.focus(); return; }
      msg.textContent = '…';
      go.disabled = true;
      try { await enter(ph.value, nm.value.trim()); toast(t().toastIn); }
      catch (e) { msg.textContent = esc(e.message || 'Could not sign in.'); go.disabled = false; }
    };
  } else {
    const pr = (profile && profile.prizes) || [];
    const wins = (profile && profile.wins) || {};
    const TROPH = {claw: '🦞', bbt: '🎯', tag: '🚩', c4: '🔴', ttt: '⭕', pin: '🪅', trivia: '🤖', hotdog: '🌭'};
    const trophy = Object.entries(wins).filter(([, n]) => n > 0)
      .map(([k, n]) => `<span class="eolAcctTroph">${TROPH[k] || '🏅'} ${esc(k)} ×${n}</span>`).join('');
    const REPL = [0, 5, 15, 35, 70, 120], REPT = ['Newcomer', 'Regular', 'Local', 'Favorite', 'Celebrity', 'Legend'], rp = (profile && profile.rep) || 0;
    const rl = REPL.reduce((l, t, i) => rp >= t ? i : l, 0);
    const AV = window.Avatars || {}, blingAll = (AV.blingCatalog && AV.blingCatalog().items) || [], worn = (AV.wornBling && AV.wornBling()) || [];
    const mine = blingAll.filter(b => pr.some(r => r.item === b.id));
    const wear = mine.length ? mine.map(b => `<button class="eolAcctChip wear${worn.includes(b.id) ? ' on' : ''}" data-wear="${esc(b.id)}">${esc(b.label)}${worn.includes(b.id) ? ' ✓' : ''}</button>`).join('')
      : `<div class="eolAcctEmpty">No bling yet — redeem collectibles with trivia points!</div>`;
    const coll = pr.length ? pr.map(r => `<div class="eolAcctChip"><span class="eolAcctMini">${esc((r.name || '').slice(0, 18))}</span>${r.count > 1 ? `<i>×${r.count}</i>` : ''}</div>`).join('')
      : `<div class="eolAcctEmpty">${esc(t().collEmpty)}</div>`;
    const th = window.__EOL_THEME, rank = e => e.bling ? (e.theme === th ? 1 : 2) : 0;   // everyday items, then this season's collectibles, then the rest
    const shopGrid = shop.length ? [...shop].sort((a, b) => rank(a) - rank(b)).map(e => {
      const can = points() >= e.cost;
      const owned = pr.find(r => r.item === e.item);
      return `<button class="eolAcctShop${can ? ' can' : ''}" ${can ? '' : 'disabled'} data-item="${esc(e.item)}">
        <b>${esc(e.label)}</b><span>🪙 ${e.cost}</span><i>${owned ? '×' + owned.count : ''}</i></button>`;
    }).join('') : '<div class="eolAcctEmpty">…</div>';
    panel.innerHTML = `
      <div class="eolAcctHead"><b>👤 ${esc(name())}</b><span class="eolAcctPts">🪙 ${Math.round(points())} pts</span><span class="eolAcctPts" title="The more Rep, the more the crowd comes over to say hi">⭐ ${rp} · ${REPT[rl]}</span><button class="eolAcctX" aria-label="Close">✕</button></div>
      <div class="eolAcctBody eolAcctScroll">
        ${langLinks()}
        <div class="eolAcctTrophies">${trophy || `<span class="eolAcctEmpty">—</span>`}</div>
        <div class="eolAcctCap">${esc(t().collCap)}</div><div class="eolAcctColl">${coll}</div>
        <div class="eolAcctCap">✨ Wear on your avatar</div><div class="eolAcctColl">${wear}</div>
        <div class="eolAcctCap">${esc(t().shopCap)}</div><div class="eolAcctShopGrid">${shopGrid}</div>
        <button id="eolGiftBtn" class="eolAcctShop can" style="width:100%;margin-top:6px">🌱 Gift a Sprout to a visitor</button>
        <button id="eolAcctOut" class="eolAcctOut">${esc(t().out)}</button>
      </div>`;
    panel.querySelector('.eolAcctX').onclick = close;
    panel.querySelector('#eolAcctOut').onclick = () => { phone = ''; profile = null; try { localStorage.removeItem(KEY); localStorage.removeItem(QUEUE); } catch (e) {} paint(); announceUpdate(); };
    const gfBtn = panel.querySelector('#eolGiftBtn');
    if (gfBtn) gfBtn.onclick = () => { if (window.Avatars && window.Avatars.openGiftPanel) window.Avatars.openGiftPanel(); };
    panel.querySelectorAll('[data-wear]').forEach(b => b.onclick = () => { if (AV.toggleBling) AV.toggleBling(b.dataset.wear); render(); });
    panel.querySelectorAll('.eolAcctShop.can').forEach(b => b.onclick = async () => {
      b.disabled = true;
      try { await redeem(b.dataset.item); } catch (e) { toast(e.message || 'Redeem failed.'); paint(); }
    });
  }
  panel.querySelectorAll('.eolLangLink').forEach(b => b.onclick = () => bumpLang(b.id === 'eolLangEs' ? 'es' : 'en'));
}
function open() { if (!panel) return; panel.hidden = false; render(); loadShop().then(() => { if (!panel.hidden) render(); }); refresh(); }
function close() { if (panel) panel.hidden = true; }

export function init() {
  try { LANG = localStorage.getItem(LANG_KEY) === 'es' ? 'es' : 'en'; } catch (e) {}
  try { const a = lsParse(KEY, null); if (a && a.phone) { phone = a.phone; } } catch (e) {}
  pill = document.createElement('button');
  pill.id = 'eolAcctPill';
  document.body.appendChild(pill);
  panel = document.createElement('div');
  panel.id = 'eolAcct'; panel.hidden = true;
  document.body.appendChild(panel);
  pill.onclick = () => { panel.hidden ? open() : close(); };
  addEventListener('eol:acct-open', () => { if (panel && panel.hidden) open(); });   // arcade profile/sign-in link
  dispatchEvent(new Event('eol:acct-ready'));            // scene.js walk gate reads this panel too
  paint();
  refresh().then(() => { if (!signed()) paint(); });
  // trivia points banked in chat → avatars announces; refresh silently
  addEventListener('eol:account-updated', () => { if (panel && !panel.hidden) render(); });
}
