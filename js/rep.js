// rep.js — Rep: the festival's goodwill score. Gained by answering greetings, giving sprouts to the crowd
// and finishing quests; the more you have, the more the crowd comes over to say hi. Signed-in visitors keep it
// on their account (server.py rate-limits every source); guests keep a local count in this browser.
import * as Account from './account.js?v=8';

export const LEVELS = [0, 5, 15, 35, 70, 120];
export const TITLES = ['Newcomer', 'Regular', 'Local', 'Favorite', 'Celebrity', 'Legend'];
const KEY = 'eol-rep';
const local = () => { try { return Math.max(0, parseInt(localStorage.getItem(KEY) || '0', 10) || 0); } catch (e) { return 0; } };
export const points = () => Account.signed() ? ((Account.profile && Account.profile.rep) || 0) : local();
export const levelOf = n => { let l = 0; LEVELS.forEach((t, i) => { if (n >= t) l = i; }); return l; };
export const level = () => levelOf(points());
export const title = () => TITLES[level()];
const note = (msg) => dispatchEvent(new CustomEvent('eol:rep', {detail: {msg, points: points(), level: level()}}));

// kind: 'react' (answered a greeting, +1) | 'quest' (+amount, server clamps 1..5) — returns the new total
export async function add(kind, amount = 1) {
  if (!Account.signed()) {
    const n = local() + (kind === 'quest' ? Math.max(1, Math.min(5, amount)) : 1);
    try { localStorage.setItem(KEY, String(n)); } catch (e) {}
    note('+Rep'); return n;
  }
  try {
    const r = await fetch('/api/rep', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({phone: Account.phone, kind, amount})});
    const j = await r.json();
    await Account.refresh();
    note(j && j.limited ? 'Rep: a little too fast — slow down!' : '+Rep');
    return j && j.rep;
  } catch (e) { return points(); }
}
