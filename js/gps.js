// gps.js — 📱 the geocaching app: an iPhone-style GPS for the lot. Visitors hide caches
// (optionally stashing one of THEIR collectibles inside) and hunt each other's — pins are
// fuzzed ±2m, so you navigate to the area on the map, then search on foot with the arrow
// keys. Finds bank points on your phone account (+12 first / +6 after, +4 with a prize
// inside); a stashed collectible transfers to the first finder and that cache retires.
// The map is a live top-down of the 3D lot (truck, stage, tables, props — whatever #layout
// did to them), with the iOS-blue "you" dot riding your walking position. position via
// scene.js' __EOL_WALK hook; props via __EOL_PROPS; tables via __EOL_SEATS.
import {CONFIG} from './shop.js?v=7';
import * as Account from './account.js?v=7';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const LOT = {x0: -62, x1: 62, z0: -60, z1: 34};        // walkable lot bounds (walkCollide's clamp)

let pill, phone, screen, mapC, mapX, sheet, noteEl;
let caches = [], selected = null, geoOn = true;
let pollT = 0, drawT = 0, hideOpen = false, note = '';

// ---------- iPhone scaffolding ----------
function init() {
  if (!CONFIG || CONFIG.geocacheOn === false) return;   // owner switched geocaching off (Settings → Games)

  const st = document.createElement('style');          // one-time styles for the phone frame + iOS bits
  st.textContent = `
#eolGpsPill{position:fixed;right:230px;bottom:10px;z-index:6;font:600 13px Inter,system-ui,sans-serif;padding:8px 12px;
 border-radius:999px;border:1px solid rgba(74,169,255,.6);background:rgba(16,20,30,.85);color:#e8f2ff;cursor:pointer}
#eolGpsPill:hover{background:rgba(24,44,74,.9)}
#eolGps{position:fixed;right:14px;top:calc(126px + env(safe-area-inset-top,0px));z-index:58;width:284px;max-height:78vh;
 background:#0b0b10;border-radius:46px;padding:10px;box-shadow:0 24px 60px #000d, inset 0 0 0 2px #2a2a35;
 display:flex;flex-direction:column}
#eolGps[hidden]{display:none}
#eolGpsScreen{position:relative;flex:1;min-height:0;border-radius:37px;overflow:hidden;background:#f6f5f8;
 display:flex;flex-direction:column;color:#1c1c1e;font:13px/1.35 -apple-system,'Segoe UI',Inter,system-ui,sans-serif}
#eolGpsIsland{position:absolute;top:9px;left:50%;transform:translateX(-50%);width:86px;height:25px;background:#0b0b10;
 border-radius:14px;z-index:4}
#eolGpsStatus{display:flex;justify-content:space-between;padding:13px 24px 4px;font:600 12.5px -apple-system,Inter,sans-serif;color:#111}
#eolGpsMapWrap{position:relative;flex:1;min-height:170px}
#eolGpsMap{position:absolute;inset:0;width:100%;height:100%;touch-action:none}
#eolGpsSearch{position:absolute;top:8px;left:10px;right:10px;z-index:3;background:#fff;border-radius:11px;
 box-shadow:0 2px 10px rgba(0,0,0,.18);padding:7px 10px;text-align:center;font:600 12.5px -apple-system,Inter,sans-serif;color:#1c1c1e}
#eolGpsSheet{background:#fff;border-top:1px solid rgba(0,0,0,.12);max-height:46%;overflow-y:auto;
 padding:10px 12px calc(8px + 6px);box-shadow:0 -8px 24px rgba(0,0,0,.12)}
#eolGpsSheet::-webkit-scrollbar{display:none}
.gRow{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 0;border-bottom:1px solid rgba(0,0,0,.07)}
.gRow:last-child{border-bottom:0}
.gBtn{background:#007aff;color:#fff;border:0;border-radius:999px;padding:7px 13px;font:600 12.5px -apple-system,Inter,sans-serif;
 cursor:pointer;box-shadow:0 2px 6px rgba(0,122,255,.35)}
.gBtn.sec{background:#e5e5ea;color:#1c1c1e;box-shadow:none}
.gBtn:disabled{opacity:.4;cursor:default}
.gItem{flex:1;min-width:130px;border:1px solid rgba(0,0,0,.12);border-radius:10px;padding:6px 8px;font:12.5px -apple-system,Inter,sans-serif}
.gListRow{display:flex;gap:8px;align-items:center;width:100%;background:none;border:0;border-radius:10px;padding:7px 8px;
 cursor:pointer;font:12.5px -apple-system,Inter,sans-serif;color:#1c1c1e;text-align:left}
.gListRow:hover,.gListRow.on{background:rgba(0,122,255,.1)}
.gDist{margin-left:auto;font-weight:600;color:#007aff;white-space:nowrap}
.gNote{margin:6px 0 0;color:#0a7a2f;font:600 12px -apple-system,Inter,sans-serif}`;
  document.head.appendChild(st);

  pill = document.createElement('button');
  pill.id = 'eolGpsPill'; pill.textContent = '📱 GPS · Cache';
  pill.title = 'Geocaching — hide caches with your collectibles, hunt everyone else’s';
  pill.onclick = () => { phone.hidden = !phone.hidden; if (!phone.hidden) open(); };
  document.body.appendChild(pill);

  phone = document.createElement('div');
  phone.id = 'eolGps'; phone.hidden = true;
  phone.innerHTML = `
    <div id="eolGpsScreen">
      <div id="eolGpsIsland"></div>
      <div id="eolGpsStatus"><span>9:41</span><span>●●●●&nbsp;&nbsp;🔋87%</span></div>
      <div id="eolGpsMapWrap">
        <canvas id="eolGpsMap"></canvas>
        <div id="eolGpsSearch">Geocaches — loading…</div>
      </div>
      <div id="eolGpsSheet"></div>
    </div>`;
  document.body.appendChild(phone);
  screen = phone.querySelector('#eolGpsScreen');
  mapC = phone.querySelector('#eolGpsMap');
  mapX = mapC.getContext('2d');
  sheet = phone.querySelector('#eolGpsSheet');
  phone.querySelector('#eolGpsSearch').onclick = () => { sheet.scrollTop = 0; };
  mapC.addEventListener('click', e => {              // tap a pin to select it
    const r = mapC.getBoundingClientRect();
    const p = mapPos({x: (e.clientX - r.left), y: (e.clientY - r.top)});
    let best = null, bd = 22;
    for (const c of caches) {
      const q = mapXY(c.x, c.z);
      const d = Math.hypot(q[0] - p.x, q[1] - p.y);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) { selected = best.id; paintSheet(); }
  });
  addEventListener('resize', sizeMap);
  sizeMap();
  pollT = setInterval(poll, 12000);
  drawT = setInterval(drawMap, 500);
  poll();
}

function open() { sizeMap(); poll(); }

function sizeMap() {
  if (!mapC || phone.hidden) return;
  const r = mapC.getBoundingClientRect();
  mapC.width = Math.max(160, Math.round(r.width));
  mapC.height = Math.max(150, Math.round(r.height));
  drawMap();
}

// ---------- data ----------
async function poll() {
  try {
    const q = Account.phone ? '?phone=' + encodeURIComponent(Account.phone) : '';
    const j = await fetch('/api/caches' + q).then(r => r.json());
    geoOn = j.on !== false;
    caches = j.caches || [];
    if (selected && !caches.find(c => c.id === selected)) selected = null;   // it retired with its prize
    const sr = phone.querySelector('#eolGpsSearch');
    sr.textContent = geoOn
      ? `Geocaches — ${caches.length} hidden on the lot`
      : 'Geocaching is turned off right now';
    paintSheet();
    drawMap();
  } catch (e) { /* transient poll failure: next tick retries */ }
}

// "you": your walking position when you walk; where you're looking (the orbit pivot) when
// you don't — so the blue dot is always somewhere sensible, never a stale (0,0)
const me = () => {
  try {
    const w = window.__EOL_WALK ? window.__EOL_WALK() : null;
    if (w && w.on) return w;
    const l = window.__EOL_LOOK ? window.__EOL_LOOK() : null;
    return l ? {x: l.x, z: l.z, on: false, yaw: 0} : null;
  } catch (e) { return null; }
};
const distTo = c => {
  const w = me();
  return w ? Math.hypot(c.x - w.x, c.z - w.z) : Infinity;
};

// ---------- map drawing: a FOLLOW-CAM, like a real phone GPS ----------
// The map centers on YOU at navigation zoom (ZOOM px/m) and the world slides past as you walk
// — the old whole-lot overview made 4 m of walking worth ~6 invisible pixels. North stays up
// (your heading shows as the blue cone); the selected pin gets a dashed bearing line and an
// Apple-Maps-style edge chevron when it's off-screen.
const ZOOM = 7;                     // px per meter — ~37×24 m of lot in the phone's map window
function mapXY(x, z, ctr) {         // world → canvas px, centered on "you" (ctr = cached follow pos)
  const c = ctr || me();
  return [mapC.width / 2 + (x - c.x) * ZOOM, mapC.height / 2 + (z - c.z) * ZOOM];
}
function mapPos(px) {               // canvas px → world (pin taps)
  const c = me();
  return {x: c.x + (px.x - mapC.width / 2) / ZOOM, y: c.z + (px.y - mapC.height / 2) / ZOOM};
}
function drawMap() {
  if (!mapX || phone.hidden) return;
  const W = mapC.width, H = mapC.height, X = mapX, t = Date.now() / 1000;
  const ctr = me();                 // ONE follow position per frame — the world slides under it
  if (!ctr) return;
  X.clearRect(0, 0, W, H);
  X.fillStyle = '#efe9dd'; X.fillRect(0, 0, W, H);
  // world bounds visible in this window (grid + culling far props)
  const vx0 = ctr.x - W / 2 / ZOOM - 1, vx1 = ctr.x + W / 2 / ZOOM + 1;
  const vz0 = ctr.z - H / 2 / ZOOM - 1, vz1 = ctr.z + H / 2 / ZOOM + 1;
  const inView = (x, z, pad) => x > vx0 - pad && x < vx1 + pad && z > vz0 - pad && z < vz1 + pad;
  // 5 m survey grid — the lines sliding past are what sells "you are moving"
  X.strokeStyle = '#e3ddd0'; X.lineWidth = 1;
  for (let gx = Math.floor(vx0 / 5) * 5; gx <= vx1; gx += 5) {
    const p = mapXY(gx, 0, ctr); X.beginPath(); X.moveTo(p[0], 0); X.lineTo(p[0], H); X.stroke();
  }
  for (let gz = Math.floor(vz0 / 5) * 5; gz <= vz1; gz += 5) {
    const p = mapXY(0, gz, ctr); X.beginPath(); X.moveTo(0, p[1]); X.lineTo(W, p[1]); X.stroke();
  }
  // lot edge + stage deck (mostly off-window — they slide in as you approach them)
  const lot = [mapXY(LOT.x0, LOT.z0, ctr), mapXY(LOT.x1, LOT.z1, ctr)];
  X.strokeStyle = '#b3cfad'; X.lineWidth = 2.5;
  X.strokeRect(lot[0][0], lot[0][1], lot[1][0] - lot[0][0], lot[1][1] - lot[0][1]);
  const st = [mapXY(-9, -54.2, ctr), mapXY(25.2, -39.9, ctr)];
  X.fillStyle = '#ddd6ec';
  X.fillRect(st[0][0], st[0][1], st[1][0] - st[0][0], st[1][1] - st[0][1]);
  X.fillStyle = '#7d7796'; X.font = '700 8px Inter,sans-serif'; X.textAlign = 'center';
  if (inView(8, -47, 30)) X.fillText('STAGE', ...mapXY(8, -47, ctr));
  // the truck (wherever #layout left it)
  const to = CONFIG || {};
  const tx = to.truckOffsetX || 0, tz = to.truckOffsetZ || 0;
  X.save();
  const tr = mapXY(tx, tz, ctr);
  X.translate(tr[0], tr[1]); X.rotate((to.truckRotation || 0) * Math.PI / 180);
  X.fillStyle = '#e8896f';
  X.fillRect(-2.7 * ZOOM, -1.15 * ZOOM, 5.4 * ZOOM, 2.3 * ZOOM);
  X.restore();
  if (inView(tx, tz, 8)) X.fillText('TRUCK', ...mapXY(tx, tz - 2.8, ctr));
  // picnic tables + movable props near you (live positions from the 3D scene)
  try {
    const seats = window.__EOL_SEATS ? window.__EOL_SEATS() : [];
    X.fillStyle = '#8f7fd8';
    for (const s of seats) {
      if (!inView(s.x, s.z, 2)) continue;
      const p = mapXY(s.x, s.z, ctr);
      X.beginPath(); X.arc(p[0], p[1], 4.5, 0, 7); X.fill();
    }
    const props = window.__EOL_PROPS ? window.__EOL_PROPS() : [];
    X.font = '13px Inter,sans-serif'; X.textAlign = 'center';
    for (const pr of props) {
      if (!inView(pr.x, pr.z, 3)) continue;
      const p = mapXY(pr.x, pr.z, ctr);
      X.fillText({claw: '🦞', bbt0: '🎯', bbt1: '🎯', tag: '🚩', scores: '🏆', jukebox: '💿', impala: '🚗'}[pr.id] || '•', p[0], p[1] + 4);
    }
  } catch (e) {}
  // pins: nearby ones drawn; the selected one always gets its bearing line + edge chevron
  const cc = [W / 2, H / 2];
  for (const c of caches) {
    const p = mapXY(c.x, c.z, ctr), sel = c.id === selected;
    const off = p[0] < -8 || p[0] > W + 8 || p[1] < -8 || p[1] > H + 8;
    if (off && !sel) continue;
    if (!off) {
      X.fillStyle = c.mine ? '#f2a100' : (c.iFound ? '#9e9ea6' : '#ff3b30');
      X.beginPath(); X.arc(p[0], p[1] - 6, sel ? 7 : 6, 0, 7); X.fill();
      X.beginPath(); X.moveTo(p[0] - 4, p[1] - 4); X.lineTo(p[0] + 4, p[1] - 4); X.lineTo(p[0], p[1] + 6); X.fill();
      if (c.prize) { X.fillStyle = '#fff'; X.font = '700 8px Inter'; X.fillText('🎁', p[0], p[1] - 3); }
      if (sel) { X.strokeStyle = '#007aff'; X.lineWidth = 2; X.beginPath(); X.arc(p[0], p[1] - 4, 12 + Math.sin(t * 4) * 2.5, 0, 7); X.stroke(); }
    }
    if (sel) {   // dashed bearing line from you, clipped at the edge, chevron pointing onward
      const dx = p[0] - cc[0], dy = p[1] - cc[1];
      const k = Math.min(1, (Math.min(W, H) / 2 - 16) / (Math.hypot(dx, dy) || 1));
      const ex = cc[0] + dx * k, ey = cc[1] + dy * k;
      X.strokeStyle = '#007aff'; X.lineWidth = 1.5; X.setLineDash([4, 4]);
      X.beginPath(); X.moveTo(cc[0], cc[1]); X.lineTo(ex, ey); X.stroke(); X.setLineDash([]);
      if (k < 1) {
        X.save(); X.translate(ex, ey); X.rotate(Math.atan2(dy, dx));
        X.fillStyle = '#007aff'; X.beginPath();
        X.moveTo(9, 0); X.lineTo(-4, -5.5); X.lineTo(-4, 5.5); X.fill(); X.restore();
      }
    }
  }
  // "you" — always dead-center (the world slides, the dot doesn't): iOS blue + pulse + heading
  if (!ctr.on) X.globalAlpha = .7;
  X.strokeStyle = 'rgba(0,122,255,.25)'; X.lineWidth = 1.2;
  X.beginPath(); X.arc(cc[0], cc[1], 12 + Math.sin(t * 2.2) * 4, 0, 7); X.stroke();
  if (ctr.on && ctr.yaw) {   // heading cone: walk yaw is atan2(x,z) → canvas angle is π/2 − yaw
    const a = Math.PI / 2 - ctr.yaw;
    X.fillStyle = 'rgba(0,122,255,.3)';
    X.beginPath(); X.moveTo(cc[0], cc[1]);
    X.arc(cc[0], cc[1], 26, a - .45, a + .45); X.fill();
  }
  X.fillStyle = '#fff'; X.beginPath(); X.arc(cc[0], cc[1], 7, 0, 7); X.fill();
  X.fillStyle = '#007aff'; X.beginPath(); X.arc(cc[0], cc[1], 5.5, 0, 7); X.fill();
  X.globalAlpha = 1;
  X.fillStyle = '#6b6b74'; X.font = '700 8px Inter'; X.textAlign = 'left';
  X.fillText('N↑', 6, 12);
}

// ---------- sheet ----------
function paintSheet() {
  if (!sheet || phone.hidden) return;
  const w = me(), signed = Account.signed();
  const sel = caches.find(c => c.id === selected);
  const selD = sel ? distTo(sel) : Infinity;
  const iFoundN = caches.filter(c => c.iFound).length;
  const mineN = caches.filter(c => c.mine).length;
  const canDig = signed && sel && !sel.iFound && selD <= 5 && w && w.on;
  const hideBtn = signed && w && w.on;

  sheet.innerHTML = `
    <div class="gRow"><b>👤 ${esc(signed ? Account.name() : 'Guest')}</b>
      <span style="color:#007aff;font-weight:600">🪙 ${Math.round(Account.points())} pts</span>
      <span style="opacity:.65">🗺 ${iFoundN} found · 📦 ${mineN} hidden</span></div>
    ${hideOpen ? `
    <div class="gRow">
      <input class="gItem" id="gNote" maxlength="80" placeholder="note for hunters (80 chars)" value="${esc(note)}">
      <select class="gItem" id="gStash" style="min-width:150px">
        <option value="">🎁 stash: nothing (points cache)</option>
        ${(Account.profile && Account.profile.prizes || []).filter(p => (p.count || 1) > 0)
          .map(p => `<option value="${esc(p.item)}" data-label="${esc(p.name || p.item)}">🎁 stash: ${esc(p.name || p.item)} ×${p.count}</option>`).join('')}
      </select>
      <button class="gBtn" id="gBury">Bury it 📦</button>
      <button class="gBtn sec" id="gCancelHide">✕</button>
    </div>` : `
    <div class="gRow">
      <button class="gBtn sec" id="gHide" ${hideBtn ? '' : 'disabled'}>＋ Hide one here</button>
      <span style="opacity:.6;font-size:11.5px">${hideBtn ? 'your current walking spot' : (signed ? 'walk with ◀ ▲ ▼ ▶ keys first' : 'sign in to hide caches')}</span>
    </div>`}
    ${sel ? `
    <div class="gRow">
      <div class="gItem" style="flex:2">
        <b>${esc(sel.note || 'no note')}</b> <span style="opacity:.6">by ${esc(sel.by)}</span>
        <div style="font-size:11.5px;opacity:.8">${sel.prize ? '🎁 ' + esc(sel.prize) + ' inside!' : ''} ${sel.found ? '· first found by ' + esc(sel.first || 'someone') : ''}</div>
      </div>
      <button class="gBtn" id="gDig" ${canDig ? '' : 'disabled'}>🔍 Search here</button>
      <span style="opacity:.6;font-size:11.5px;width:100%">${selD === Infinity ? '' : selD.toFixed(0) + ' m away' + (canDig ? '' : (sel.iFound ? ' · you logged this one' : ' · get within ~5 m of the pin'))}</span>
    </div>` : `
    <div class="gRow"><span style="opacity:.6">tap a pin (or a row below) to navigate to it</span></div>`}
    <div class="gRow" style="display:block;padding:2px 0">
      ${caches.length ? caches.map(c => `
        <button class="gListRow${c.id === selected ? ' on' : ''}" data-id="${c.id}">
          <span>${c.mine ? '📦' : c.iFound ? '✅' : '📍'} ${esc(c.note || 'no note')}</span>
          ${c.prize ? ' <span style="opacity:.8">🎁</span>' : ''}
          <span class="gDist">${distTo(c) === Infinity ? '' : distTo(c).toFixed(0) + ' m'}</span>
        </button>`).join('') : '<span style="opacity:.6;padding:8px;display:inline-block">No caches hidden yet — hide the first one!</span>'}
    </div>
    ${note ? `<div class="gNote">${note}</div>` : ''}`;

  const hide = sheet.querySelector('#gHide');
  if (hide) hide.onclick = () => { hideOpen = true; note = ''; paintSheet(); };
  const cancel = sheet.querySelector('#gCancelHide');
  if (cancel) cancel.onclick = () => { hideOpen = false; paintSheet(); };
  const noteIn = sheet.querySelector('#gNote');
  if (noteIn) noteIn.oninput = () => { note = noteIn.value; };
  const bury = sheet.querySelector('#gBury');
  if (bury) bury.onclick = () => buryCache();
  const dig = sheet.querySelector('#gDig');
  if (dig) dig.onclick = () => digCache(sel);
  sheet.querySelectorAll('.gListRow').forEach(b => {
    b.onclick = () => { selected = b.dataset.id; paintSheet(); };
  });
}

// ---------- actions ----------
async function buryCache() {
  if (!Account.signed()) { note = 'Sign in at the 🎪 Midway first — hides ride your account.'; paintSheet(); return; }
  const w = me();
  if (!w || !w.on) { note = 'Start walking (◀ ▲ ▼ ▶ keys) — you bury where you stand.'; paintSheet(); return; }
  const stash = sheet.querySelector('#gStash');
  const opt = stash && stash.selectedOptions[0];
  const prize = opt && opt.value ? {item: opt.value, label: opt.dataset.label || opt.value} : null;
  try {
    const r = await fetch('/api/caches/place', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({x: w.x, z: w.z, note: note || '', phone: Account.phone,
                             name: Account.name(), prize})});
    const j = await r.json();
    if (!r.ok) { note = j.error || 'Could not bury it.'; paintSheet(); return; }
    hideOpen = false;
    note = prize ? '📦 Buried — your ' + (prize.label) + ' waits inside. First finder keeps it!' : '📦 Buried — hunters get points at your spot!';
    Account.refresh().catch(() => {});                 // the stash left your collection
    poll();
  } catch (e) { note = 'Network hiccup — try again.'; paintSheet(); }
}

async function digCache(sel) {
  if (!sel || !Account.signed()) return;
  const w = me();
  if (!w) return;
  try {
    const r = await fetch('/api/caches/found', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({id: sel.id, x: w.x, z: w.z, phone: Account.phone, name: Account.name()})});
    const j = await r.json();
    if (!r.ok) { note = j.error || 'Nothing here…'; paintSheet(); return; }
    note = '⛏ Found it! +' + j.points + ' pts' + (j.prize ? ' — and the 🎁 ' + esc(j.prize) + ' inside is yours now!' : '');
    Account.refresh().catch(() => {});                 // points (+ maybe the prize) landed
    poll();
  } catch (e) { note = 'Network hiccup — try again.'; paintSheet(); }
}

init();
