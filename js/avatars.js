// avatars.js — MMORPG-style live presence. Everyone else currently looking at the site
// shows up as a named avatar wandering the lot in front of the truck, can type short public
// chat messages that show as a speech bubble over their avatar, and (if they pick a name)
// keeps that name on return visits. Plain polling (no websockets) against server.py's
// /api/presence and /api/chat - good enough for a handful of visitors and needs nothing
// extra on the Python http.server side.
//
// NOTE: visitor chat here is live and NOT moderated in real time. The admin "Live chat" tab
// is an after-the-fact audit log, and Settings has an on/off switch if it's ever misused.
import * as THREE from 'three';
import {WX0, WX1, BW, FLOOR} from './truck.js?v=12';
import {CONFIG} from './shop.js?v=8';
import * as Account from './account.js?v=8';   // language picked at sign-up drives chips + docks
import * as People from './people.js?v=8';
import * as Wear from './wear.js?v=1';     // realistic shared-geometry bodies (painted faces, swinging limbs)

const ID_KEY = 'eol-visitor-id', NAME_KEY = 'eol-visitor-name', PROFILE_KEY = 'eol-visitor-profile';
const CAP_STYLES = ['', 'ball', 'cowboy', 'beret', 'cone', 'marge', 'bart', 'lisa', 'homer', 'duff', 'krusty', 'moes', 'flanders'];
const FACE_STYLES = ['', 'smile', 'neutral', 'surprised', 'wink', 'grumpy'];
const SKIN_TONES = [0xd9a978, 0xc78f5e, 0xb07a4e, 0xa8714a, 0x8a5a35, 0x6b4626];
let myId = localStorage.getItem(ID_KEY);
if (!myId) {
  myId = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)) + Date.now().toString(36);
  try { localStorage.setItem(ID_KEY, myId); } catch (e) {}
}
let myName = (() => { try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; } })();
// visitor's own avatar look customization: shirt hue + skin tone + hat style. Kept in
// localStorage and always sent with the presence heartbeat so anyone who joins sees it.
let myProfile = (() => {
  try { const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null') || {}; return {
    hue: Number.isFinite(+p.hue) ? Math.max(0, Math.min(359, +p.hue | 0)) : null,
    sk: Number.isFinite(+p.sk) ? Math.max(0, Math.min(5, +p.sk | 0)) : null,
    cap: CAP_STYLES.includes(p.cap) ? p.cap : '',
    face: FACE_STYLES.includes(p.face) ? p.face : '',
    bling: Array.isArray(p.bling) ? p.bling.filter(x => typeof x === 'string').slice(0, 6) : []}; } catch (e) { return {hue: null, sk: null, cap: '', face: '', bling: []}; }
})();
function saveProfile() {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(myProfile)); } catch (e) {}
  reskinLive();
  heartbeat();
}

// instant restyle of my on-screen avatar (name ball caps, skin, shirt) so the picker feels live
function reskinLive() {
  const a = live.get(myId);
  if (!a) return;
  const hue = selfHue();
  a.group.traverse(o => {
    if (!o.material || !o.userData || !o.userData.custom) return;
    if (o.userData.custom === 'shirt') o.material.color.setHSL(hue / 360, .55, .48);
    else if (o.userData.custom === 'skin') {
      const hex = SKIN_TONES[(myProfile.sk != null ? myProfile.sk : hue) % SKIN_TONES.length];
      if (o.userData.skinFace != null) People.skinHead(o, hex); else o.material.color.setHex(hex);
    }
    else if (o.userData.custom === 'cap') o.material.color.setHSL(hue / 360, .6, .3);
  });
}
function rebuildSelf() {
  const a = live.get(myId);
  if (a) { try { S.remove(a.group); disposeBody(a.group); } catch (e) {} live.delete(myId); }
  const me = spawn(myId, selfHue(), myName, myProfile);
  me.self = true;
  live.set(myId, me);
  const st = myStatus();
  if (st !== 'browsing') setStatus(me, st, myName, true);
}

const live = new Map();   // visitor id -> avatar state
export function liveAvatars() { return [...live.entries()].map(([id, a]) => ({id, group: a.group, name: a.name, self: !!a.self})); }

// ---------- ✨ bling + themed collectibles worn on the avatar (catalog /bling/catalog.json, art /bling/<id>.webp) ----------
let BLING = {items: [], themes: {}}, BLING_BY = {}, npcLister = () => [];
export const setNpcLister = f => { npcLister = f; };
const BLING_SIZE = {hat: .62, collar: .36, chest: .42, shoulderL: .32, shoulderR: .32, shoeL: .28, shoeR: .28};
const BLING_POS = {hat: [0, 1.86, .02], collar: [0, 1.4, .13], chest: [0, 1.2, .19], shoulderL: [-.26, 1.36, .12], shoulderR: [.26, 1.36, .12], shoeL: [-.09, .1, .17], shoeR: [.09, .1, .17]};
const BLING_SPRITE = new WeakSet(), blingMats = new Map(), blingLoader = new THREE.TextureLoader();
function blingMat(id) {
  let m = blingMats.get(id);
  if (!m) {
    const t = blingLoader.load('/bling/' + id + '.webp'); t.colorSpace = THREE.SRGBColorSpace;
    m = new THREE.SpriteMaterial({map: t, transparent: true, depthWrite: false, alphaTest: .02}); blingMats.set(id, m); BLING_SPRITE.add(m);
  }
  return m;
}
export function applyBling(group, ids) {
  const body = group && group.children[0]; if (!body) return;
  for (const sp of group.userData.bling || []) body.remove(sp);
  group.userData.bling = [];
  Wear.apply(group, (ids || []).map(id => BLING_BY[id]).filter(Wear.isWear));   // 3D props on the avatar's sockets
  for (const id of ids || []) {
    const it = BLING_BY[id]; if (!it || it.model || !BLING_POS[it.slot]) continue;
    const sp = new THREE.Sprite(blingMat(id)), sz = (BLING_SIZE[it.slot] || .3) * (it.size || 1);
    sp.position.set(...BLING_POS[it.slot]); sp.scale.set(sz, sz, 1); sp.userData.sz = sz;
    body.add(sp); group.userData.bling.push(sp);
  }
}
fetch('/bling/catalog.json').then(r => r.ok ? r.json() : null).then(j => {
  if (!j) return; BLING = j; BLING_BY = Object.fromEntries((j.items || []).map(i => [i.id, i]));
  for (const a of live.values()) applyBling(a.group, a.blingIds);
  dispatchEvent(new Event('eol:bling-ready'));
}).catch(() => {});
export const blingCatalog = () => BLING;
export const wornBling = () => (myProfile.bling || []).filter(id => BLING_BY[id]);
export function toggleBling(id) {   // one piece per slot; saved in the profile so every browser sees it on your avatar
  const it = BLING_BY[id]; if (!it) return false;
  let cur = (myProfile.bling || []).filter(x => BLING_BY[x]);
  if (cur.includes(id)) cur = cur.filter(x => x !== id);
  else cur = [...cur.filter(x => BLING_BY[x].slot !== it.slot), id].slice(-8);
  myProfile.bling = cur; saveProfile();
  const me = live.get(myId); if (me) { me.blingIds = cur; applyBling(me.group, cur); }
  dispatchEvent(new Event('eol:bling-changed'));
  return cur.includes(id);
}
// a sprout that is only visual and fades on its own (crowd members sharing one)
export function attachSprout(group, slot, ms = 120000) {
  const body = group && group.children[0], pos = SPROUT_SLOTS[slot]; if (!body || !pos) return;
  const m = buildSprout(slot); m.position.set(pos.x, pos.y, pos.z); body.add(m);
  setTimeout(() => { body.remove(m); }, ms);
}
let S = null;
let since = Date.now() / 1000;   // only show chat sent after this page load, not a replay of old messages
const MAX_SHOWN = 14;             // cap render count - the lot should feel alive, not crowded
const BUBBLE_MS = 9000;           // how long a chat bubble stays up
// chat lines starting with this sentinel are hot-dog-contest control traffic: they are peeled
// off here and handed to the contest panel as DOM events, never shown as chat
const HD_TAG = '@hd ';
const HD_EVENT = 'eol:hd';
const PA_TAG = '@pa ';              // midway/arcade control traffic → js/arcade.js (same relay pattern)
const PA_EVENT = 'eol:pa';

// ---------- 🌱 gift a sprout to another visitor ----------
let giftPanel = null, giftBody = null;
export function openGiftPanel(targetId) {
  if (!giftPanel) {
    giftPanel = document.createElement('div');
    giftPanel.id = 'eolGift'; giftPanel.hidden = true;
    giftPanel.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:90;' +
      'width:min(360px,90vw);max-height:70vh;overflow:auto;background:#180f24f5;border:1px solid rgba(83,168,110,.5);' +
      'border-radius:18px;color:#f6e7c8;padding:12px 14px;font:13px/1.4 Inter,sans-serif;box-shadow:0 18px 50px #000c';
    giftPanel.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
      '<b>🌱 Gift a Sprout</b><button id="eolGiftX" style="background:none;border:0;color:#f6e7c8;font-size:16px;cursor:pointer">✕</button></div>' +
      '<div id="eolGiftBody"></div>';
    document.body.appendChild(giftPanel);
    giftBody = giftPanel.querySelector('#eolGiftBody');
    giftPanel.querySelector('#eolGiftX').onclick = () => { giftPanel.hidden = true; };
  }
  giftPanel.hidden = false;
  renderGiftPanel(targetId);
}

function renderGiftPanel(targetId) {
  if (!giftBody) return;
  const signed = Account.signed();
  const sprouts = (Account.profile && Account.profile.prizes || []).filter(p => p.item && p.item.startsWith('sprout-'));
  const visitors = [...live.entries()].filter(([id]) => id !== myId).map(([id, a]) => ({id, name: a.name})).concat(npcLister());
  if (targetId && String(targetId).startsWith('npc:') && !visitors.some(v => v.id === targetId)) visitors.push({id: targetId, name: 'Festival-goer'});
  if (!signed) {
    giftBody.innerHTML = '<p style="opacity:.7">Sign in at the 🎪 Midway first — sprouts live in your collection.</p>';
    return;
  }
  if (!sprouts.length) {
    giftBody.innerHTML = '<p style="opacity:.7">No sprouts in your collection yet — redeem them at the 🏬 shop with trivia points!</p>';
    return;
  }
  const targetOpts = visitors.length
    ? visitors.map(v => '<option value="' + esc(v.id) + '">' + esc(v.name) + '</option>').join('')
    : '<option value="">no other visitors nearby</option>';
  const sproutOpts = sprouts.map(s =>
    '<option value="' + esc(s.item) + '" data-label="' + esc(s.name || s.item) + '" data-slot="' + esc(s.slot || 'collar') + '">' + esc(s.name || s.item) + ' (×' + (s.count || 1) + ')</option>').join('');
  const slots = ['collar','shoeL','shoeR','hat','chest','shoulderL','shoulderR'];
  const slotOpts = slots.map(s => '<option value="' + s + '">' + s + '</option>').join('');
  giftBody.innerHTML =
    '<p style="margin:0 0 8px;opacity:.8;font-size:12px">Clip one of your sprouts onto a nearby visitor — it appears on their avatar and rides their account forever.</p>' +
    '<label style="font-size:12px;opacity:.7">Sprout</label>' +
    '<select id="gfSprout" style="width:100%;margin:2px 0 8px;padding:6px;border-radius:8px;background:#221833;color:#f6e7c8;border:1px solid rgba(255,255,255,.2)">' + sproutOpts + '</select>' +
    '<label style="font-size:12px;opacity:.7">Recipient</label>' +
    '<select id="gfTo" style="width:100%;margin:2px 0 8px;padding:6px;border-radius:8px;background:#221833;color:#f6e7c8;border:1px solid rgba(255,255,255,.2)">' + targetOpts + '</select>' +
    '<label style="font-size:12px;opacity:.7">Clip to</label>' +
    '<select id="gfSlot" style="width:100%;margin:2px 0 8px;padding:6px;border-radius:8px;background:#221833;color:#f6e7c8;border:1px solid rgba(255,255,255,.2)">' + slotOpts + '</select>' +
    '<button id="gfSend" style="width:100%;margin-top:4px;padding:8px;border-radius:10px;border:1px solid rgba(83,168,110,.5);background:rgba(83,168,110,.2);color:#f6e7c8;font:600 13px Inter,sans-serif;cursor:pointer">🌱 Gift it!</button>' +
    '<p id="gfMsg" style="margin:8px 0 0;font-size:12px;opacity:.8"></p>';
  if (targetId) { const sel = giftBody.querySelector('#gfTo'); if (sel) sel.value = targetId; }
  const send = giftBody.querySelector('#gfSend');
  if (send) send.onclick = async () => {
    const sproutSel = giftBody.querySelector('#gfSprout');
    const toSel = giftBody.querySelector('#gfTo');
    const slotSel = giftBody.querySelector('#gfSlot');
    const msg = giftBody.querySelector('#gfMsg');
    const opt = sproutSel && sproutSel.selectedOptions[0];
    const item = sproutSel ? sproutSel.value : '';
    const label = opt ? opt.dataset.label : item;
    const slot = slotSel ? slotSel.value : 'collar';
    const to = toSel ? toSel.value : '';
    if (!item || !to) { msg.textContent = 'Pick a sprout and a recipient.'; return; }
    msg.textContent = 'Gifting…';
    if (to.startsWith('npc:')) {   // a festival-goer: they hug you, tell their friends, and a friend may bring one back (+Rep)
      try {
        const r = await fetch('/api/gift-npc', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({phone: Account.phone, item, slot})});
        const j = await r.json();
        if (!r.ok) { msg.textContent = j.error || 'Gift failed.'; return; }
        msg.textContent = '🌱 ' + (j.gifted || item) + ' given — +3 Rep! Watch for a hug.';
        dispatchEvent(new CustomEvent('eol:npc-gift', {detail: {npc: +to.slice(4), slot, cost: 0}}));
        Account.refresh().then(() => renderGiftPanel(targetId)).catch(() => {});
        setTimeout(() => { if (giftPanel) giftPanel.hidden = true; }, 1600);
      } catch (e) { msg.textContent = 'Network hiccup — try again.'; }
      return;
    }
    try {
      const r = await fetch('/api/gift', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({fromPhone: Account.phone, toVisitor: to, item, slot})});
      const j = await r.json();
      if (!r.ok) { msg.textContent = j.error || 'Gift failed.'; return; }
      msg.textContent = '🌱 ' + (j.gifted || item) + ' clipped onto them! (they will see it on their avatar shortly)';
      Account.refresh().then(() => renderGiftPanel(targetId)).catch(() => {});
    } catch (e) { msg.textContent = 'Network hiccup — try again.'; }
  };
}

export function init(scene) {
  S = scene;
  buildDock();
  heartbeat();
  setInterval(heartbeat, 7000);
  poll();
  setInterval(poll, 3000);
  // menu/order state → avatar staging: browsing the menu = your avatar queues at the window;
  // placed an order = it walks over and takes a seat at a lunch table until the glow fades.
  addEventListener('eol:order-placed', () => { menuOpen = false; ordered = true;
    setTimeout(() => { ordered = false; }, 22000);
    heartbeat(true); });
  addEventListener('eol:menu-open', () => { menuOpen = true; heartbeat(); });
  addEventListener('eol:menu-close', () => { menuOpen = false; heartbeat(); });
}
let menuOpen = false, ordered = false;

function myStatus() {
  if (ordered) return 'ordering';
  if (menuOpen) return 'menu';
  return 'browsing';
}

async function heartbeat(ordered) {
  try {
    const r = await fetch('/api/presence', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({id: myId, ordered: !!ordered, menu: menuOpen, name: myName, profile: myProfile}),
    });
    const j = await r.json().catch(() => null);
    if (j && j.name) updateDockName(j.name);
  } catch (e) {}
}

async function sendChat(text) {
  text = text.trim().slice(0, 140);
  if (!text) return;
  let acctPhone = '';
  try { const a = JSON.parse(localStorage.getItem('eolAcct') || 'null'); if (a && a.phone) acctPhone = a.phone; } catch (e) {}
  try {
    const r = await fetch('/api/chat', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({id: myId, text, phone: acctPhone}),   // phone links correct trivia guesses to points
    });
    if (!r.ok) { const j = await r.json().catch(() => ({})); logLine('system', j.error || 'Message not sent.'); }
    else {
      if (!text.startsWith(HD_TAG) && !text.startsWith(PA_TAG)) logLine(myName || 'You', text, true);
      const j = await r.json().catch(() => ({}));
      if (j.gained > 0) logLine('system', '🎉 Trivia! +' + j.gained + ' points — redeem them in your profile.');
      else if (j.gained === 0) logLine('system', 'Correct! But only signed-in visitors bank points — sign in at 🎪 Midway.');
    }
  } catch (e) { logLine('system', 'Message not sent — connection issue.'); }
}

// broadcast-only line for the contest: no local echo (the contest panel logs its own events)
export function announce(text) {
  try { fetch('/api/chat', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({id: myId, text})}); } catch (e) {}
}

// server-clock offset + current name, shared with the hot-dog contest so every browser's
// countdown aims at the same moment regardless of how skewed each device's clock is
export async function clockNow() {
  try {
    const j = await fetch(`/api/presence?id=${encodeURIComponent(myId)}&since=${since}`).then(r => r.ok ? r.json() : null);
    if (j && j.now) return j.now * 1000;
  } catch (e) {}
  return Date.now();
}
// "panels that would cover this chat dock" helper: a bottom offset in px that always clears
// the dock's LIVE height (the log is resizable) — Midway, jukebox and friends sit above it
export function aboveDock(pad = 10) {
  const d = document.getElementById('eolDock');
  if (!d) return pad + 'px';
  return Math.max(pad, Math.round(innerHeight - d.getBoundingClientRect().top + 10)) + 'px';
}
export function visitorName() { return myName || 'Guest'; }
export const HD = {TAG: HD_TAG, EVENT: HD_EVENT};

// AI order-taking assistant - same dock, different mode. Private to this visitor (never
// broadcast like public chat); the backend is the only thing that can actually touch the menu
// or place an order, so whatever the model says, it can't invent items or prices.
async function sendToAssistant(text) {
  text = text.trim().slice(0, 400);
  if (!text) return;
  logLine(myName || 'You', text, true);
  try {
    const r = await fetch('/api/assistant', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({id: myId, text, lang: Account.lang(), phone: Account.phone || ''}),   // lang picked at sign-up + account phone
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { logLine('system', j.error || (Account.lang() === 'es' ? 'El asistente no está disponible ahorita.' : 'Assistant is unavailable right now.')); return; }
    logLine('Assistant', j.reply || '…');
  } catch (e) { logLine('system', Account.lang() === 'es' ? 'El asistente no está disponible — problema de conexión.' : 'Assistant is unavailable — connection issue.'); }
}

// ---------- suggested chat chips (contextual to the visitor's order stage) ----------
// shop.js fires 'eol:order-stage' on every order-status poll; the assistant then answers the
// tapped chip with the REAL order state (server-side deterministic paths). Fully localized.
let chipsBox = null, orderStage = '';
const CHIPS = {
  none: {
    en: ["What is the status of my order?", "What's on the menu today?", "How long is the wait?", "Do you take cards?"],
    es: ["¿Cuál es el estado de mi pedido?", "¿Qué hay en el menú hoy?", "¿Cuánto tarda el pedido?", "¿Aceptan tarjeta?"],
  },
  new: {
    en: ["What is the status of my order?", "Can I change my order?", "Cancel my order"],
    es: ["¿Cuál es el estado de mi pedido?", "¿Puedo cambiar mi pedido?", "Cancelar mi pedido"],
  },
  ready: {
    en: ["What is the status of my order?", "Something is wrong with what I received!", "I didn't get my full order", "Can I request a refund?"],
    es: ["¿Cuál es el estado de mi pedido?", "¡Hay algo malo con lo que recibí!", "Me faltó algo de mi pedido", "¿Puedo pedir un reembolso?"],
  },
  picked: {
    en: ["Something is wrong with what I received!", "I didn't get my full order", "Can I request a refund?"],
    es: ["¡Hay algo malo con lo que recibí!", "Me faltó algo de mi pedido", "¿Puedo pedir un reembolso?"],
  },
};
CHIPS.cooking = CHIPS.new;
const chipStage = s => (s === 'new' || s === 'cooking' || s === 'ready') ? s
  : (s && s !== 'none' ? 'picked' : 'none');
function paintChips() {
  if (!chipsBox) return;
  const ai = mode === 'ai';
  chipsBox.style.display = ai ? '' : 'none';
  if (!ai) return;
  if (!orderStage) { try { orderStage = chipStage((JSON.parse(localStorage.getItem('eol-last-order') || 'null') || {}).status); } catch (e) {} }
  const list = ((CHIPS[chipStage(orderStage) || 'none'] || CHIPS.none)[Account.lang() || 'en']) || CHIPS.none.en;
  chipsBox.innerHTML = list.map(c => `<button class="eolChip">${esc(c)}</button>`).join('');
  chipsBox.querySelectorAll('.eolChip').forEach(b => b.onclick = () => sendToAssistant(b.textContent));
}
const aiHint = () => Account.lang() === 'es'
  ? 'Pregunta por el menú, o di lo que quieres — puede crear tu pedido.'
  : 'Ask about the menu, or say what you want — it can place the order.';
addEventListener('eol:order-stage', e => { orderStage = chipStage((e.detail || {}).status || ''); paintChips(); });
addEventListener('eol:lang', () => { if (mode === 'ai') logLine('system', aiHint()); paintChips(); });
addEventListener('eol:acct-ready', () => paintChips());
addEventListener('eol:account-updated', () => {
  if (Account.profile && Array.isArray(Account.profile.sprouts)) {
    myProfile = myProfile || {hue: null, sk: null, cap: '', sprouts: []};
    myProfile.sprouts = Account.profile.sprouts;
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(myProfile)); } catch (e) {}
  }
});
addEventListener('eol:account-updated', () => paintChips());   // account lang lands server-side async — repaint then

async function poll() {
  if (!S) return;
  let j;
  try { j = await fetch(`/api/presence?id=${encodeURIComponent(myId)}&since=${since}`).then(r => r.ok ? r.json() : null); }
  catch (e) { j = null; }
  if (!j) return;
  if (j.now) since = j.now;

  const seen = new Set();
  // claim any pending sprout gifts addressed to us
  if (j.gifts && j.gifts.length && Account.signed()) {
    try {
      const r = await fetch('/api/gift/claim', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({phone: Account.phone || '', visitor: myId})});
      const cj = await r.json();
      if (cj && cj.claimed > 0) {
        myProfile = myProfile || {hue: null, sk: null, cap: '', sprouts: []};
        myProfile.sprouts = cj.sprouts ? [...(myProfile.sprouts || []), ...cj.sprouts] : myProfile.sprouts;
        const seen = new Set();
        myProfile.sprouts = myProfile.sprouts.filter(s => { if (seen.has(s.slot)) return false; seen.add(s.slot); return true; });
        try { localStorage.setItem(PROFILE_KEY, JSON.stringify(myProfile)); } catch (e) {}
        Account.refresh().catch(() => {});
        logLine('system', '🌱 Someone clipped a sprout onto you!');
      }
    } catch (e) {}
  }

  for (const o of (j.others || []).slice(0, MAX_SHOWN)) {
    seen.add(o.id);
    let a = live.get(o.id);
    if (!a) { a = spawn(o.id, o.hue, o.name, o.profile); live.set(o.id, a); }
    setStatus(a, o.status, o.name);
    const bk = JSON.stringify((o.profile && o.profile.bling) || []);
    if (bk !== JSON.stringify(a.blingIds || [])) { a.blingIds = (o.profile && o.profile.bling) || []; applyBling(a.group, a.blingIds); }
  }
  for (const [id, a] of live) { if (!seen.has(id) && id !== myId) { despawn(a); live.delete(id); } }

  // my own avatar: invisible while just wandering, but staged the second I open the menu
  // (joins the window line) or place an order (walks to a lunch table and sits)
  const st = myStatus();
  if (st !== 'browsing') {
    let me = live.get(myId);
    if (!me) { me = spawn(myId, selfHue(), myName, myProfile); live.set(myId, me); }
    me.self = true;
    setStatus(me, st, myName, true);
  } else if (live.get(myId)) { despawn(live.get(myId)); live.delete(myId); }

  for (const m of (j.chat || [])) {
    if (m.id === myId) continue;              // we already echoed our own line locally
    if (String(m.text || '').startsWith(PA_TAG)) {   // arcade control traffic → midway panel
      dispatchEvent(new CustomEvent(PA_EVENT, {detail: {id: m.id, name: m.name, text: m.text.slice(PA_TAG.length)}}));
      continue;
    }
    if (String(m.text || '').startsWith(HD_TAG)) {   // contest control traffic → hot-dog panel
      dispatchEvent(new CustomEvent(HD_EVENT, {detail: {id: m.id, name: m.name, text: m.text.slice(HD_TAG.length)}}));
      continue;
    }
    logLine(m.name, m.text);
    const a = live.get(m.id);
    if (a && !chatQuiet) showBubble(a, m.text);   // quiet mode trims social bubbles too
  }
}

function randSpot() {   // a point on the lawn behind the truck facing the service window
  const x = WX0 + Math.random() * (WX1 - WX0);
  const z = BW / 2 + 4 + Math.random() * 4;
  return new THREE.Vector3(x, FLOOR, z);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// The cartoon hats/hair below were authored for a 1.06 m body with the head centre at y .92; ACC_S maps them onto
// the 1.72 m person (head centre y 1.6) so every existing cap style, recolour and sprout keeps working.
const ACC_S = .86;
export function makeBody(hue, prof = {}) {
  const skIdx = prof.sk != null ? (+prof.sk % SKIN_TONES.length) : hue % SKIN_TONES.length;
  const root = People.buildAvatar(hue, {...prof, skinHex: SKIN_TONES[skIdx], face: prof.face === 'neutral' ? '' : prof.face}, -FLOOR);   // feet on the lawn
  const body = root.children[0];
  const cap = new THREE.MeshStandardMaterial({color: new THREE.Color().setHSL((prof.hue ?? hue) / 360, .6, .3), roughness: .7});
  const g = new THREE.Group(); g.scale.setScalar(ACC_S); g.position.y = 1.6 - .92 * ACC_S; root.userData.headRig.add(g);   // g = cartoon accessories, on the neck pivot so they turn with the head (same body-space metres)
  const style = prof.cap || '';
  const hatY = 1.12;
  if (style === 'ball') {
    const hat = new THREE.Mesh(new THREE.ConeGeometry(.15, .12, 16), cap);
    hat.position.y = hatY; hat.userData.custom = 'cap'; g.add(hat);
  } else if (style === 'cowboy') {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(.23, .24, .015, 16), cap);
    brim.position.y = hatY; brim.userData.custom = 'cap'; g.add(brim);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(.09, .11, .12, 12), cap);
    crown.position.y = hatY + .07; crown.userData.custom = 'cap'; g.add(crown);
  } else if (style === 'beret') {
    const b = new THREE.Mesh(new THREE.SphereGeometry(.17, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), cap);
    b.position.y = hatY - .04; b.scale.y = .5; b.rotation.x = .18;
    b.userData.custom = 'cap'; g.add(b);
  } else if (style === 'cone') {
    const party = new THREE.MeshStandardMaterial({color: 0xff8a3c, roughness: .5});
    const c = new THREE.Mesh(new THREE.ConeGeometry(.09, .26, 12), party);
    c.position.y = hatY + .08; c.castShadow = true; g.add(c);
  } else if (style === 'marge') {
    const hair = new THREE.MeshStandardMaterial({color: 0x2a6fb0, roughness: .6});
    const beehive = new THREE.Mesh(new THREE.CylinderGeometry(.1, .16, .45, 12), hair);
    beehive.position.y = hatY + .18; beehive.userData.custom = 'cap'; g.add(beehive);
    const top = new THREE.Mesh(new THREE.SphereGeometry(.11, 12, 8), hair);
    top.position.y = hatY + .42; top.userData.custom = 'cap'; g.add(top);
  } else if (style === 'bart') {
    const hair = new THREE.MeshStandardMaterial({color: 0xf2c14e, roughness: .7});
    for (let i = 0; i < 7; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(.03, .18, 6), hair);
      spike.position.set(Math.cos(i / 7 * Math.PI * 2) * .09, hatY + .05, Math.sin(i / 7 * Math.PI * 2) * .09);
      spike.rotation.z = Math.cos(i / 7 * Math.PI * 2) * .3;
      spike.userData.custom = 'cap'; g.add(spike);
    }
  } else if (style === 'lisa') {
    const hair = new THREE.MeshStandardMaterial({color: 0xf2c14e, roughness: .7});
    const spikes = 9;
    for (let i = 0; i < spikes; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(.025, .22, 6), hair);
      const a = (i / spikes) * Math.PI * 2;
      spike.position.set(Math.cos(a) * .1, hatY + .08, Math.sin(a) * .1);
      spike.rotation.x = Math.sin(a) * .4;
      spike.rotation.z = -Math.cos(a) * .4;
      spike.userData.custom = 'cap'; g.add(spike);
    }
  } else if (style === 'homer') {
    const hair = new THREE.MeshStandardMaterial({color: 0x1a1a1a, roughness: .8});
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.13, .02, 6, 12), hair);
    ring.position.y = hatY - .02; ring.rotation.x = Math.PI / 2; ring.userData.custom = 'cap'; g.add(ring);
  } else if (style === 'duff') {
    const capM = new THREE.MeshStandardMaterial({color: 0x1a3a8a, roughness: .6});
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(.22, .23, .02, 16), capM);
    brim.position.y = hatY; brim.userData.custom = 'cap'; g.add(brim);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(.1, .12, .14, 12), capM);
    crown.position.y = hatY + .08; crown.userData.custom = 'cap'; g.add(crown);
    const logo = new THREE.Mesh(new THREE.CircleGeometry(.05, 12), new THREE.MeshStandardMaterial({color: 0xffd700}));
    logo.position.set(0, hatY + .09, .12); logo.rotation.y = 0; logo.userData.custom = 'cap'; g.add(logo);
  } else if (style === 'krusty') {
    const hair = new THREE.MeshStandardMaterial({color: 0x3a8a3a, roughness: .7});
    for (let i = 0; i < 6; i++) {
      const tuft = new THREE.Mesh(new THREE.SphereGeometry(.06, 8, 6), hair);
      const a = (i / 6) * Math.PI * 2;
      tuft.position.set(Math.cos(a) * .12, hatY + .05, Math.sin(a) * .12);
      tuft.userData.custom = 'cap'; g.add(tuft);
    }
    const top = new THREE.Mesh(new THREE.SphereGeometry(.1, 8, 6), hair);
    top.position.y = hatY + .12; top.userData.custom = 'cap'; g.add(top);
  } else if (style === 'moes') {
    const apron = new THREE.MeshStandardMaterial({color: 0x5a3a1f, roughness: .8});
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(.14, .16, .06, 12), apron);
    hat.position.y = hatY; hat.userData.custom = 'cap'; g.add(hat);
  } else if (style === 'flanders') {
    const mustache = new THREE.MeshStandardMaterial({color: 0x6b4a2a, roughness: .8});
    const m = new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, .02, 12), mustache);
    m.position.y = hatY - .12; m.rotation.x = Math.PI / 2; m.userData.custom = 'cap'; g.add(m);
    const hat = new THREE.Mesh(new THREE.ConeGeometry(.12, .1, 12), new THREE.MeshStandardMaterial({color: 0x2a6b35}));
    hat.position.y = hatY + .05; hat.userData.custom = 'cap'; g.add(hat);
  }
  People.mergeStatic(g);   // a 'bart' is 7 cones, a 'lisa' 9: one mesh per material, the 'cap' recolour tag survives the merge
  // 🌱 render any sprouts clipped to this avatar (gifted by other visitors)
  const sprouts = (prof && Array.isArray(prof.sprouts)) ? prof.sprouts : [];
  for (const sp of sprouts) {
    const slot = sp.slot || 'collar';
    const pos = SPROUT_SLOTS[slot];
    if (!pos) continue;
    const sproutMesh = buildSprout(slot);
    sproutMesh.position.set(pos.x, pos.y, pos.z);
    sproutMesh.userData.sprout = sp.item;
    sproutMesh.userData.sproutFrom = sp.from;
    body.add(sproutMesh);
  }
  return root;
}

// 🌱 highly detailed festival sprout meshes, one per attachment slot on an avatar.
// Each sprout is a small plant: stem + leaves + optional flower, in a slot-specific size.
function buildSprout(slot) {
  const g = new THREE.Group();
  const stemM = new THREE.MeshStandardMaterial({color: 0x3a6b35, roughness: .7});
  const leafM = new THREE.MeshStandardMaterial({color: 0x53a86e, roughness: .6});
  const flowerM = new THREE.MeshStandardMaterial({color: 0xff6b8a, roughness: .5});
  const potM = new THREE.MeshStandardMaterial({color: 0x8a6b3f, roughness: .8});
  // stem
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(.012, .015, .12, 6), stemM);
  stem.position.y = .06; g.add(stem);
  // leaves (2-3, angled)
  for (let i = 0; i < 3; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(.035, 8, 6), leafM);
    leaf.scale.set(1.2, .3, .8);
    leaf.position.set(Math.cos(i * 2.1) * .04, .08 + i * .025, Math.sin(i * 2.1) * .04);
    leaf.rotation.set(Math.random() * .5, i * 2.1, Math.random() * .3);
    g.add(leaf);
  }
  // flower on top
  const flower = new THREE.Mesh(new THREE.SphereGeometry(.025, 8, 6), flowerM);
  flower.position.y = .13; g.add(flower);
  // slot-specific scaling/rotation
  if (slot === 'hat') { g.scale.set(1.2, 1.2, 1.2); g.position.y = .05; }
  else if (slot === 'collar') { g.scale.set(.9, .9, .9); g.rotation.x = .3; }
  else if (slot === 'shoeL' || slot === 'shoeR') { g.scale.set(.7, .7, .7); g.rotation.x = Math.PI / 2; }
  else if (slot === 'chest') { g.scale.set(1, 1, 1); g.rotation.x = .2; }
  else if (slot === 'shoulderL' || slot === 'shoulderR') { g.scale.set(.8, .8, .8); g.rotation.z = slot === 'shoulderL' ? .3 : -.3; }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// attachment point offsets in avatar local space
const SPROUT_SLOTS = {
  hat:       {x: 0,     y: 1.8,  z: 0},
  collar:    {x: 0,     y: 1.46, z: 0.1},
  chest:     {x: 0,     y: 1.2,  z: 0.17},
  shoulderL: {x: -0.23, y: 1.4,  z: 0},
  shoulderR: {x: 0.23,  y: 1.4,  z: 0},
  shoeL:     {x: -0.088, y: 0.05, z: 0.09},
  shoeR:     {x: 0.088,  y: 0.05, z: 0.09},
};

// one text->sprite helper, reused for both the nameplate (small, always on) and the chat/order
// bubble (bigger, shown briefly) so there's only one canvas-drawing routine to keep correct.
function textSprite({text, font, fg, bg, stroke, pad = 10, w = 256, h = 72}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (bg) { ctx.fillStyle = bg; roundRect(ctx, 2, 2, w - 4, h - 4, 14); ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 3; roundRect(ctx, 2, 2, w - 4, h - 4, 14); ctx.stroke(); }
  ctx.fillStyle = fg; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  wrapText(ctx, text, w / 2, h / 2, w - pad * 2, h < 90 ? h : 26);
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({map: tex, transparent: true, depthTest: false}));
  spr.renderOrder = 999;
  return spr;
}
function wrapText(ctx, text, cx, cy, maxW, lineH) {
  const words = String(text).split(' ');
  let line = '', lines = [];
  for (const wd of words) {
    const test = line ? line + ' ' + wd : wd;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = wd; } else line = test;
  }
  lines.push(line);
  lines = lines.slice(0, 3);
  const top = cy - ((lines.length - 1) * lineH) / 2;
  lines.forEach((l, i) => ctx.fillText(l, cx, top + i * lineH));
}

function selfHue() {
  if (myProfile && myProfile.hue !== null) return myProfile.hue;
  let h = 0; for (const c of myId) h = (h + c.charCodeAt(0) * 7) % 360;
  return h;
}

function queueSpot(k) {   // a numbered spot in the walk-up line at the service window
  const x = WX1 - .45 - (k % 6) * .62, z = -(BW / 2 + 1.5 + Math.floor(k / 6) * 1.1);   // the serving window is on the truck's -z side
  return new THREE.Vector3(x, FLOOR, z);
}
function seatSpot(id) {   // a lunch-table seat on the lawn (world coords, drag-corrected live)
  const seats = window.__EOL_SEATS && window.__EOL_SEATS() || [];
  if (!seats.length) return randSpot();
  let h = 0; for (const c of String(id)) h = (h + c.charCodeAt(0) * 13) % 997;
  const st = seats[h % seats.length];
  return new THREE.Vector3(st.x * 1 + Math.cos(h) * .12, FLOOR, st.z * 1 + Math.sin(h) * .12);
}

function spawn(id, hue, name, prof) {
  const group = makeBody(hue, prof);
  group.position.copy(randSpot());
  const nameSpr = textSprite({text: name || 'Guest', font: 'bold 26px Inter, sans-serif', fg: '#fff',
    bg: 'rgba(10,8,5,.55)', w: 220, h: 56});
  nameSpr.scale.set(.85, .22, 1); nameSpr.position.y = 1.28; group.add(nameSpr);
  const bubbleAnchor = new THREE.Group(); bubbleAnchor.position.y = 1.55; group.add(bubbleAnchor);
  // "ordered" glow = the shirt's own emissive (a PointLight per avatar recompiled every lit shader on join/leave)
  let glow = null; group.traverse(o => { if (!glow && o.isMesh && o.userData.custom === 'shirt') glow = o.material; });
  if (glow) { glow.emissive = new THREE.Color().setHSL(hue / 360, .8, .5); glow.emissiveIntensity = 0; }
  S.add(group); applyBling(group, (prof && prof.bling) || []);
  return {id, group, nameSpr, bubbleAnchor, bubble: null, bubbleUntil: 0, glow, name,
    target: randSpot(), wait: 1 + Math.random() * 3, status: 'browsing', phase: Math.random() * 10, blingIds: (prof && prof.bling) || []};
}

// free an avatar's GPU memory: its merged geometries, per-avatar materials and sprite canvases. Cached people.js
// materials (faces, palette colours) and bling sprite materials are shared, so they stay.
export function disposeBody(grp) {
  grp.traverse(o => {
    if (o.isSprite) { if (o.material && !BLING_SPRITE.has(o.material)) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } return; }
    if (!o.isMesh) return;
    if (o.geometry && !o.userData.shared) o.geometry.dispose();   // worn 3D props share one geometry across wearers
    if (o.userData.custom && !o.userData.skinFace && o.material) o.material.dispose();
  });
}
function despawn(a) { S.remove(a.group); disposeBody(a.group); }

function setStatus(a, status, name, self) {
  if (name && name !== a.name) { a.name = name; a.group.remove(a.nameSpr); a.nameSpr.material.map.dispose(); a.nameSpr.material.dispose();
    a.nameSpr = textSprite({text: name, font: 'bold 26px Inter, sans-serif', fg: '#fff', bg: 'rgba(10,8,5,.55)', w: 220, h: 56});
    a.nameSpr.scale.set(.85, .22, 1); a.nameSpr.position.y = 1.28; a.group.add(a.nameSpr);
  }
  if (a.status === status) return;
  a.status = status;
  if (status === 'menu') {         // browsing the menu: hop into the walk-up line at the window
    let h = 0; for (const c of a.id || '') h = (h + c.charCodeAt(0) * 3) % 6;
    a.target = queueSpot(self ? 0 : h);
    showBubble(a, 'In line for food…', 7000);
  } else if (status === 'ordering') {   // order placed: grab a seat at a lawn table
    a.target = seatSpot(a.id || myId);
    showBubble(a, 'Ordered! Grabbing a table 🌭', 7000);
  }
}

function showBubble(a, text, ms = BUBBLE_MS) {
  if (a.bubble) { a.bubbleAnchor.remove(a.bubble); a.bubble.material.map.dispose(); a.bubble.material.dispose(); }
  a.bubble = textSprite({text, font: 'bold 24px Inter, sans-serif', fg: '#f3e4b8', bg: 'rgba(20,16,10,.9)', stroke: 'rgba(224,178,0,.9)', w: 280, h: 88});
  a.bubble.scale.set(1.15, .36, 1);
  a.bubbleAnchor.add(a.bubble);
  a.bubbleUntil = performance.now() + ms;
}

export function tick(t, dt) {
  const now = performance.now();
  for (const a of live.values()) {
    const g = a.group;
    if (g.userData.bling) for (let i = 0; i < g.userData.bling.length; i++) { const sp = g.userData.bling[i], k = sp.userData.sz * (1 + Math.sin(t * 3 + i * 1.7) * .07); sp.scale.set(k, k, 1); }
    const d = a.target.clone().sub(g.position); d.y = 0;
    const dist = d.length();
    const moving = dist > 0.08;
    if (moving) {
      d.normalize(); g.position.addScaledVector(d, Math.min(dist, dt * 0.9));
      g.rotation.y = Math.atan2(d.x, d.z);
      g.position.y = FLOOR + Math.abs(Math.sin(t * 6 + a.phase)) * 0.03;   // walk bob
      const swing = Math.sin(t * 8 + a.phase) * 0.6;
      const arms = g.userData.arms || [];
      const legs = g.userData.legs || [];
      if (arms[0]) arms[0].rotation.x = swing;
      if (arms[1]) arms[1].rotation.x = -swing;
      if (legs[0]) legs[0].rotation.x = -swing * 0.5;
      if (legs[1]) legs[1].rotation.x = swing * 0.5;
    } else {
      a.wait -= dt;
      g.position.y = FLOOR + Math.sin(t * 1.6 + a.phase) * 0.01;   // idle breathing
      if (a.wait <= 0 && a.status !== 'ordering') { a.target = randSpot(); a.wait = 2 + Math.random() * 3; }
      const arms = g.userData.arms || [];
      const legs = g.userData.legs || [];
      if (arms[0]) arms[0].rotation.x = 0;
      if (arms[1]) arms[1].rotation.x = 0;
      if (legs[0]) legs[0].rotation.x = 0;
      if (legs[1]) legs[1].rotation.x = 0;
    }
    if (a.glow) { const gt = a.status === 'ordering' ? .55 : 0; a.glow.emissiveIntensity += (gt - a.glow.emissiveIntensity) * Math.min(1, dt * 4); }
    if (a.bubble && now > a.bubbleUntil) { a.bubbleAnchor.remove(a.bubble); a.bubble.material.map.dispose(); a.bubble.material.dispose(); a.bubble = null; }
  }
}

// ---------- 2D overlay: name picker, chat input, recent-messages ticker ----------
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])); }

let logEl, dockNameBtn, chatIn;
// ---------- quiet chat mode (order messages only) ----------
// Festival-crowd chat gets loud; this visitor-side toggle hides every social line and 3D bubble
// except Assistant (order-taking) + system lines. Persisted in localStorage.
let chatQuiet = false;
try { chatQuiet = localStorage.getItem('eol-chat-quiet') === '1'; } catch (e) {}
let quietBtn = null;
function setChatQuiet(q) {
  chatQuiet = !!q;
  try { localStorage.setItem('eol-chat-quiet', chatQuiet ? '1' : '0'); } catch (e) {}
  if (quietBtn) {
    quietBtn.textContent = chatQuiet ? '🔇' : '💬';
    quietBtn.title = chatQuiet ? 'Chat is quiet — only order messages show. Tap to unmute.'
                               : 'Quiet the social chat (order updates only)';
  }
}
function logLine(name, text, mine) {
  if (!logEl) return;
  if (chatQuiet && name !== 'system' && name !== 'Assistant' && name !== 'TriviaBot pts') return;
  const row = document.createElement('div');
  row.style.cssText = 'margin-top:3px;opacity:.95';
  row.innerHTML = name === 'system'
    ? `<span style="opacity:.7;font-style:italic">${esc(text)}</span>`
    : `<b style="color:${mine ? '#f2c14e' : '#bcd4ff'}">${esc(name)}:</b> ${esc(text)}`;
  logEl.appendChild(row);
  while (logEl.children.length > 10) logEl.removeChild(logEl.firstChild);   // 10 rows: makes an expanded (resized) log actually worth scrolling back through
  logEl.scrollTop = logEl.scrollHeight;
}

function updateDockName(resolvedName) {
  if (dockNameBtn) dockNameBtn.textContent = resolvedName;
}

function askName() {
  const v = prompt('Pick a name other visitors will see above your avatar (max 24 characters):', myName || '');
  if (v === null) return;
  myName = v.trim().slice(0, 24);
  try { localStorage.setItem(NAME_KEY, myName); } catch (e) {}
  updateDockName(myName || '…');
  heartbeat();
}

let mode = 'chat';   // 'chat' = public avatar chat, 'ai' = private order-taking assistant - same dock either way
function buildDock() {
  const chatOn = !CONFIG || CONFIG.avatarChatEnabled !== false;
  const aiOn = !!(CONFIG && CONFIG.aiAssistantEnabled);
  if (!chatOn && !aiOn) return;   // owner turned both off
  mode = chatOn ? 'chat' : 'ai';
  const wrap = document.createElement('div');
  wrap.id = 'eolDock';
  wrap.innerHTML = `
    <div id="eolChatLog"></div>
    <div id="eolChatGrip" title="Drag to resize the chat box"></div>
    <div id="eolDockRow">
      <button id="eolNameBtn" title="Change your name"></button>
      <button id="eolLookBtn" title="Customize your avatar">🎨</button>
      ${chatOn && aiOn ? `<button id="eolModeBtn" title="Switch between public chat and ordering">🤖</button>` : ''}
      ${chatOn ? `<button id="eolQuietBtn" title="Quiet the social chat (order updates only)">${chatQuiet ? '🔇' : '💬'}</button>` : ''}
      <input id="eolChatIn" maxlength="400" placeholder="${mode === 'ai' ? esc(Account.lang() === 'es' ? 'Menú o pedidos — pregunta…' : 'Ask about the menu or order…') : 'Say something…'}" autocomplete="off">
      <button id="eolChatSend" aria-label="Send">&#10148;</button>
    </div>
    <div id="eolLook" hidden>
      <div class="eolLookRow"><b>Customize your avatar</b><button id="eolLookX" aria-label="Close">✕</button></div>
      <div class="eolLookCap">Shirt</div><div id="eolLookShirt" class="eolLookSw"></div>
      <div class="eolLookCap">Skin tone</div><div id="eolLookSkin" class="eolLookSw"></div>
      <div class="eolLookCap">Hat</div><div id="eolLookCap" class="eolLookChips"></div>
      <div class="eolLookCap">Face</div><div id="eolLookFace" class="eolLookChips"></div>
      <button id="eolLookSave" class="eolLookSave">Save look</button>
    </div>`;
  document.body.appendChild(wrap);
  logEl = wrap.querySelector('#eolChatLog');
  const grip = wrap.querySelector('#eolChatGrip');
  let savedH = 0;
  try { savedH = parseInt(localStorage.getItem('eolChatLogH') || '', 10) || 0; } catch (e) {}
  if (savedH >= 40) logEl.style.maxHeight = Math.min(savedH, 340) + 'px';   // remembered size beats the 110px default
  grip.addEventListener('pointerdown', e => {
    e.preventDefault();
    const startY = e.clientY, startH = logEl.getBoundingClientRect().height;
    try { grip.setPointerCapture(e.pointerId); } catch (err) { /* synthetic/no active pointer */ }
    const move = ev => {
      const nh = Math.max(40, Math.min(340, Math.round(startH + ev.clientY - startY)));
      logEl.style.maxHeight = nh + 'px';
    };
    const up = ev => {
      move(ev);
      try { localStorage.setItem('eolChatLogH', '' + Math.round(logEl.getBoundingClientRect().height)); } catch (err) {}
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
  dockNameBtn = wrap.querySelector('#eolNameBtn');
  chatIn = wrap.querySelector('#eolChatIn');
  chipsBox = document.createElement('div');           // suggested replies, context-driven
  chipsBox.id = 'eolChips';
  wrap.insertBefore(chipsBox, wrap.querySelector('#eolDockRow'));
  paintChips();
  dockNameBtn.textContent = myName || 'Set name';
  dockNameBtn.onclick = askName;
  quietBtn = wrap.querySelector('#eolQuietBtn');
  if (quietBtn) {
    setChatQuiet(chatQuiet);                    // paints initial glyph
    quietBtn.onclick = () => setChatQuiet(!chatQuiet);
  }
  // avatar-customization popover: swatch clicks restyle YOUR avatar live, Save look persists
  // it and pushes to everyone else's screen on the next 7-second presence heartbeat.
  const lookBtn = wrap.querySelector('#eolLookBtn'), lookPanel = wrap.querySelector('#eolLook');
  const swWrap = (el, colors, key) => {
    if (key === 'sk' && myProfile.sk == null) { myProfile.sk = selfHue() % 6; }
    colors.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'eolLookSwBtn' + ((key === 'sk' ? myProfile.sk === i : (typeof c === 'number' && myProfile.hue === c)) ? ' on' : '');
      b.style.background = key === 'hue'
        ? '#' + new THREE.Color().setHSL(c / 360, .55, .48).getHexString()
        : '#' + new THREE.Color(c).getHexString();
      b.onclick = () => {
        if (key === 'hue') myProfile.hue = c;
        else myProfile.sk = i;
        el.querySelectorAll('.eolLookSwBtn.on').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        saveProfile(); reskinLive();
      };
      el.appendChild(b);
    });
  };
  const HUES = [...Array(12)].map((_, i) => i * 30 + 8);
  swWrap(wrap.querySelector('#eolLookShirt'), HUES, 'hue');
  swWrap(wrap.querySelector('#eolLookSkin'), SKIN_TONES, 'sk');
  wrap.querySelector('#eolLookCap').innerHTML = CAP_STYLES.map(c =>
    `<button class="eolLookChip${myProfile.cap === c ? ' on' : ''}" data-cap="${c}">${c === '' ? 'None' : c[0].toUpperCase() + c.slice(1)}</button>`).join('');
  wrap.querySelectorAll('.eolLookChip').forEach(b => b.onclick = () => {
    myProfile.cap = b.dataset.cap;
    wrap.querySelectorAll('.eolLookChip').forEach(x => x.classList.remove('on')); b.classList.add('on');
    saveProfile();
    rebuildSelf();
  });
  wrap.querySelector('#eolLookFace').innerHTML = FACE_STYLES.map(c =>
    `<button class="eolLookChip${myProfile.face === c ? ' on' : ''}" data-face="${c}">${c === '' ? 'Default' : c[0].toUpperCase() + c.slice(1)}</button>`).join('');
  wrap.querySelectorAll('#eolLookFace .eolLookChip').forEach(b => b.onclick = () => {
    myProfile.face = b.dataset.face;
    wrap.querySelectorAll('#eolLookFace .eolLookChip').forEach(x => x.classList.remove('on')); b.classList.add('on');
    saveProfile();
    rebuildSelf();
  });
  lookBtn.onclick = () => { lookPanel.hidden = !lookPanel.hidden; };
  wrap.querySelector('#eolLookX').onclick = () => { lookPanel.hidden = true; };
  wrap.querySelector('#eolLookSave').onclick = () => { saveProfile(); lookPanel.hidden = true; };
  const modeBtn = wrap.querySelector('#eolModeBtn');
  if (modeBtn) modeBtn.onclick = () => {
    mode = mode === 'chat' ? 'ai' : 'chat';
    modeBtn.textContent = mode === 'chat' ? '🤖' : '💬';
    chatIn.placeholder = mode === 'ai' ? (Account.lang() === 'es' ? 'Menú o pedidos — pregunta…' : 'Ask about the menu or order…') : 'Say something…';
    if (mode === 'ai') logLine('system', aiHint());
    paintChips();
  };
  const send = () => {
    const v = chatIn.value;
    if (mode === 'ai') sendToAssistant(v); else sendChat(v);
    chatIn.value = '';
  };
  wrap.querySelector('#eolChatSend').onclick = send;
  chatIn.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  if (mode === 'ai') logLine('system', aiHint());
  else if (!myName) logLine('system', 'Tap the name button to pick a name others will see.');
}

// expose for cross-module use (account.js gift button, scene.js avatar clicks)
window.Avatars = { openGiftPanel, liveAvatars, toggleBling, wornBling, blingCatalog, applyBling, attachSprout, setNpcLister };
