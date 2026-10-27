// jukebox.js — 💿 the jukebox by the lawn: visitors spend arcade POINTS to play a song FOR
// THE WHOLE LOT (tapping the jukebox prop in the 3D scene opens this panel). A paid play
// takes the stage or joins a short queue; every visitor's page polls /api/jukebox so the
// same song plays everywhere, seeked to the same moment (server-clock sync — the hot-dog
// contest trick). Browsers block autoplay without a recent tap, so a 💿 chip offers the
// start; the payer's own click counts as that tap. Songs + point costs are admin rows
// (Settings → Jukebox); points deduct server-side on the phone account, exactly like the
// 🏬 collectible shop — the payer can never tip themselves.
import {CONFIG} from './shop.js?v=7';
import {clockNow, aboveDock} from './avatars.js?v=11';
import * as Account from './account.js?v=7';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fmt = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

let panel, body, chip, audio, pollT = 0, clockSkew = 0;
let cur = null;          // {file, at} — what THIS page is playing (at = server seconds)
let catalog = [], queueN = 0, left = 0, note = '', menuOpen = false, panelWasOpen = false;

function init() {
  if (!CONFIG || CONFIG.jukeboxOn === false) return;   // owner switched the jukebox off: no chip, no panel, no tap response
  clockNow().then(n => { clockSkew = n - Date.now(); }).catch(() => {});
  audio = document.createElement('audio');
  audio.preload = 'auto';
  audio.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.appendChild(audio);

  chip = document.createElement('button');            // 💿 chip: start playback when the browser blocked it
  chip.id = 'eolJbChip'; chip.hidden = true; chip.textContent = '💿 Listen';
  chip.title = 'A song is playing on the lot — tap to listen in';
  chip.style.cssText = 'position:fixed;right:110px;bottom:10px;z-index:6;font:600 13px Inter,system-ui,sans-serif;' +
    'padding:8px 12px;border-radius:999px;border:1px solid rgba(242,193,78,.55);background:rgba(20,16,26,.82);' +
    'color:#f6e7c8;cursor:pointer';
  chip.onclick = () => audio.play().then(() => { chip.hidden = true; }).catch(() => {});
  document.body.appendChild(chip);

  panel = document.createElement('div');
  panel.id = 'eolJuke'; panel.hidden = true;
  panel.style.cssText = 'position:fixed;left:12px;bottom:94px;z-index:7;width:min(320px,88vw);max-height:70vh;overflow:auto;' +
    'border:1px solid rgba(242,193,78,.5);border-radius:16px;background:rgba(16,10,22,.95);color:#f6e7c8;' +
    'font:13px/1.4 Inter,system-ui,sans-serif;padding:10px 12px;box-shadow:0 8px 30px rgba(0,0,0,.5)';
  panel.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:15px">
      <b>💿 Jukebox</b><button id="eolJukeX" aria-label="Close" style="background:none;border:0;color:#f6e7c8;font-size:14px;cursor:pointer">✕</button></div>
    <div id="eolJukeBody"></div>`;
  document.body.appendChild(panel);
  body = panel.querySelector('#eolJukeBody');
  panel.querySelector('#eolJukeX').onclick = () => { panel.hidden = true; };

  addEventListener('eol:juke-open', () => { if (menuOpen) return; panel.hidden = false; lift(); poll(); });
  // the ordering menu is a full-screen overlay: tuck the jukebox chip + panel out of the way
  // while it's up, restore on close (same dance as the hot-dog contest panel).
  addEventListener('eol:menu-open', () => { menuOpen = true; panelWasOpen = !panel.hidden; chip.hidden = true; panel.hidden = true; });
  addEventListener('eol:menu-close', () => {
    menuOpen = false; panel.hidden = panelWasOpen;
    if (!panel.hidden) { lift(); poll(); } else if (cur && audio.paused) chip.hidden = false;
  });
  addEventListener('eol:account-updated', () => { if (panel && !panel.hidden) paint(); });
  // the chat dock below is resizable: the panel + chip ride above its live top edge
  const lift = () => {
    if (panel && !panel.hidden) panel.style.bottom = aboveDock(94);
    if (chip && !chip.hidden) chip.style.bottom = aboveDock(54);
  };
  addEventListener('pointerup', lift);
  addEventListener('resize', lift);

  pollT = setInterval(poll, 6000);   // the lot-wide sync: everyone joins the same song at the same moment
  poll();
}

async function poll() {
  try {
    const r = await fetch('/api/jukebox');
    const j = await r.json();
    if (!j || j.on === false) return;
    catalog = j.songs || []; queueN = j.queue || 0; left = (j.now && j.now.left) || 0;
    const now = j.now;
    if (now && (!cur || cur.file !== now.file || cur.at !== now.at)) {   // new song (or restart) → swap in, seeked
      cur = {file: now.file, at: now.at, title: now.title, by: now.by};
      audio.src = '/media/' + encodeURIComponent(now.file);
      audio.onloadedmetadata = () => {
        const off = (Date.now() + clockSkew) / 1000 - cur.at;            // join mid-song, synced to the payer's start
        try {
          if (off > 1 && isFinite(audio.duration) && audio.duration > 0)
            audio.currentTime = Math.min(Math.max(0, off), Math.max(0, audio.duration - .5));
          audio.play().then(() => { chip.hidden = true; }).catch(() => { chip.hidden = false; });
        } catch (e) { chip.hidden = false; }
      };
      audio.load();
    } else if (!now && cur) {                                             // the window passed: silence for everyone
      cur = null; audio.pause();
    }
    if (panel && !panel.hidden) paint();
    if (!cur || audio.paused) { if (cur && !menuOpen) chip.hidden = false; } else chip.hidden = true;
  } catch (e) { /* transient poll failure: next tick retries */ }
}

function paint() {
  if (!body) return;
  const signed = Account.signed();
  const pts = Math.round(Account.points());
  const nowLine = cur
    ? `<p style="margin:4px 0;opacity:.9">▶ <b>${esc(cur.title || 'Song')}</b>${cur.by ? ' · picked by ' + esc(cur.by) : ''}` +
      `${left ? ' · ' + fmt(left) + ' left' : ''}${queueN ? ' · ' + queueN + ' queued' : ''}</p>`
    : `<p style="margin:4px 0;opacity:.75;italic">Nothing playing — be the first to pick one!</p>`;
  const rows = catalog.map((s, i) => {
    const afford = signed && pts >= (s.cost || 0);
    return `<button class="eolJbRow" data-i="${i}" ${afford ? '' : 'disabled'} style="display:flex;gap:8px;align-items:center;` +
      `justify-content:space-between;width:100%;margin:3px 0;padding:6px 10px;border-radius:10px;border:1px solid ` +
      `${afford ? 'rgba(242,193,78,.45)' : 'rgba(255,255,255,.12)'};background:rgba(30,22,40,.8);color:#f6e7c8;` +
      `cursor:${afford ? 'pointer' : 'not-allowed'};font:600 13px Inter,system-ui,sans-serif;${afford ? '' : 'opacity:.45'}">` +
      `<span>▶ ${esc(s.title || 'Song')}</span><span style="font-weight:400;opacity:.8">🪙 ${s.cost || 0} pts</span></button>`;
  }).join('');
  body.innerHTML = nowLine +
    (signed ? `<p style="margin:4px 0 2px;opacity:.75;font-size:12px">Playing as <b>${esc(Account.name())}</b> · 🪙 ${pts} pts</p>`
           : `<p style="margin:4px 0 2px;opacity:.75;font-size:12px">Sign in at the 🎪 Midway to play songs — points come from trivia + games!</p>`) +
    (rows || '<p style="opacity:.6">The owner hasn\'t loaded any songs yet.</p>') +
    (note ? `<p style="margin:6px 0 0;color:#f2c14e;font-size:12px">${note}</p>` : '');
  body.querySelectorAll('.eolJbRow').forEach(b => {
    b.onclick = () => play(catalog[+b.dataset.i]);
  });
}

async function play(song) {
  if (!song) return;
  if (!Account.signed()) {
    note = 'Sign in at the 🎪 Midway first — songs cost points (trivia in chat banks them!).';
    paint(); return;
  }
  try {
    const r = await fetch('/api/jukebox/play', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({file: song.file, phone: Account.phone, name: Account.name()})});
    const j = await r.json();
    if (!r.ok) { note = j.error || 'Could not start the song.'; paint(); return; }
    note = j.queued ? 'Queued — it starts when the current song finishes its run.' : '🎤 Now playing for the whole lot!';
    Account.refresh().then(() => paint()).catch(() => {});   // points changed server-side
    poll();                                                   // apply immediately; the payer's click is the autoplay gesture
  } catch (e) { note = 'Network hiccup — try again.'; paint(); }
}

init();
