// pacman.js — 🟡 Pac-Man, the arcade cabinet on the lot. A faithful recreation of the
// 1980 original: the real 28×31 maze, four ghosts with their distinct personalities
// (Blinky chases, Pinky ambushes, Inky flanks, Clyde shies away), scatter/chase/frightened
// modes with the real timing, power pellets, fruit by level, the doubling ghost scores,
// lives, level speed scaling, the tunnel wrap and the intermission. Tap the cabinet (or the
// 🟡 pill) to open it; swipe or use the D-pad; high scores feed the 🏆 board by the truck.
// Points come from the arcade economy: a level clear banks a mini collectible + points.
import {CONFIG} from './shop.js?v=7';
import {clockNow} from './avatars.js?v=11';
import * as Account from './account.js?v=7';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

// ---------- the classic maze (28 wide × 31 tall) ----------
const MAZE = [
"############################",
"#............##............#",
"#.####.#####.##.#####.####.#",
"#o####.#####.##.#####.####o#",
"#.####.#####.##.#####.####.#",
"#..........................#",
"#.####.##.########.##.####.#",
"#.####.##.########.##.####.#",
"#......##....##....##......#",
"######.##### ## #####.######",
"     #.##### ## #####.#     ",
"     #.##          ##.#     ",
"     #.## ###--### ##.#     ",
"######.## #      # ##.######",
"      .   #      #   .      ",
"######.## #      # ##.######",
"     #.## ######## ##.#     ",
"     #.##          ##.#     ",
"     #.##### ## #####.#     ",
"######.##### ## #####.######",
"#............##............#",
"#.####.#####.##.#####.####.#",
"#.####.#####.##.#####.####.#",
"#o..##.......  .......##..o#",
"###.##.##.########.##.##.###",
"###.##.##.########.##.##.###",
"#......##....##....##......#",
"#.##########.##.##########.#",
"#.##########.##.##########.#",
"#..........................#",
"############################",
];
const COLS = 28, ROWS = 31, TILE = 8;
const MAZE_W = COLS * TILE, MAZE_H = ROWS * TILE;   // 224 × 248
const CANVAS_W = 224, CANVAS_H = 288;               // classic 224×288 with HUD bands
const MAZE_Y = 20;                                  // maze drawn 20 px down (score band above)
const DIRS = {left:{x:-1,y:0}, right:{x:1,y:0}, up:{x:0,y:-1}, down:{x:0,y:1}};
const OPP = {left:'right', right:'left', up:'down', down:'up'};

function isWall(tx, ty, ghost) {
  if (ty < 0 || ty >= ROWS) return true;
  if (tx < 0 || tx >= COLS) {
    // tunnel wrap only on the middle row (14)
    if (ty === 14) return false;   // wrap handled by the movement code
    return true;
  }
  const ch = MAZE[ty][tx];
  if (ch === '#') return true;
  if (ch === '-') return !ghost;          // ghost door: ghosts only
  if (ch === ' ') {
    if (ghost) return false;
    // Pac-Man: tunnel row and open corridors walkable; ghost-house interior and side out-of-bounds blocked
    if (ty === 14) return false;
    if (ty >= 11 && ty <= 13 && tx >= 9 && tx <= 18) return true;
    if (tx < 5 || tx > 22) return true;
    return false;
  }
  return false;   // '.', 'o', 'E' and anything else are walkable
}

// ---------- state ----------
let panel, body, canvas, ctx, chip;
let running = false, paused = false, gameOver = false, level = 1, score = 0, highScore = 0, lives = 3;
let dotsLeft = 0, totalDots = 0;
let pac = null;          // {tx,ty,dir,nextDir,progress,speed,anim,dead,deadT}
let ghosts = [];         // {id,name,color,tx,ty,dir,nextDir,progress,speed,mode,modeTimer,houseTimer,frightenedT,scatterTarget}
let mode = 'scatter';    // global scatter/chase
let modeTimer = 7;
let modeCycle = 0;       // how many mode switches have happened
let frightenedTimer = 0;
let frightenedCount = 0;  // for doubling ghost scores
let fruit = null;        // {type, tile, timer, score}
let fruitTimer = 0;      // countdown to fruit appearance
let fruitActive = false;
let levelClearing = false, readyT = 0, streak = 0, newHighScore = false;
let extraLifeGiven = false;
let raf = 0, lastT = 0;
let audioCtx = null;
let soundOn = true;
let menuOpen = false, panelWasOpen = false;
let touchStart = null;
let awardedPrize = false;

const GHOST_COLORS = {blinky: '#ff0000', pinky: '#ffb8ff', inky: '#00ffff', clyde: '#ffb852'};
const GHOST_NAMES = {blinky: 'Blinky', pinky: 'Pinky', inky: 'Inky', clyde: 'Clyde'};
const SCATTER_TARGETS = {blinky: {x: 25, y: 0}, pinky: {x: 2, y: 0}, inky: {x: 25, y: 29}, clyde: {x: 2, y: 29}};

const FRUITS = [
  {name: 'Cherry', score: 100, color: '#e5534a', levels: [1, 2]},
  {name: 'Strawberry', score: 300, color: '#ff6b8a', levels: [3, 4]},
  {name: 'Orange', score: 500, color: '#ff9f1c', levels: [5, 6]},
  {name: 'Apple', score: 700, color: '#53a86e', levels: [7, 8]},
  {name: 'Melon', score: 1000, color: '#74dbe6', levels: [9, 10]},
  {name: 'Galaxian', score: 2000, color: '#4f76e5', levels: [11, 12]},
  {name: 'Bell', score: 3000, color: '#f2c14e', levels: [13, 14]},
  {name: 'Key', score: 5000, color: '#d77bd0', levels: [15, 99]},
];

function fruitForLevel(lv) {
  for (const f of FRUITS) if (lv >= f.levels[0] && lv <= f.levels[1]) return f;
  return FRUITS[FRUITS.length - 1];
}

// ---------- sound (Web Audio) ----------
function audio() {
  if (audioCtx) return audioCtx;
  try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audioCtx = null; }
  return audioCtx;
}
function beep(freq, dur, type = 'square', vol = 0.06, slide = 0) {
  if (!soundOn) return;
  const ac = audio(); if (!ac) return;
  try {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = freq;
    if (slide) o.frequency.linearRampToValueAtTime(freq + slide, ac.currentTime + dur);
    g.gain.setValueAtTime(vol, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(); o.stop(ac.currentTime + dur);
  } catch (e) {}
}
function sfxWaka() { beep(Math.random() > .5 ? 440 : 330, .06, 'square', .05); }
function sfxPower() { beep(220, .12, 'sawtooth', .07, 440); }
function sfxEatGhost() { beep(880, .15, 'square', .08, -440); }
function sfxDeath() {
  if (!soundOn) return;
  const ac = audio(); if (!ac) return;
  let t = ac.currentTime;
  for (let i = 0; i < 8; i++) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sawtooth'; o.frequency.value = 660 - i * 60;
    g.gain.setValueAtTime(.07, t + i * .08);
    g.gain.exponentialRampToValueAtTime(.0001, t + (i + 1) * .08);
    o.connect(g); g.connect(ac.destination);
    o.start(t + i * .08); o.stop(t + (i + 1) * .08);
  }
}
function sfxFruit() { beep(660, .08, 'triangle', .07, 220); setTimeout(() => beep(880, .1, 'triangle', .07), 90); }
function sfxStart() {
  if (!soundOn) return;
  const ac = audio(); if (!ac) return;
  const notes = [330, 330, 392, 523, 523, 392, 330, 262, 262, 330, 392, 330];
  let t = ac.currentTime;
  notes.forEach((n, i) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'square'; o.frequency.value = n;
    g.gain.setValueAtTime(.06, t + i * .12);
    g.gain.exponentialRampToValueAtTime(.0001, t + (i + 1) * .12);
    o.connect(g); g.connect(ac.destination);
    o.start(t + i * .12); o.stop(t + (i + 1) * .12);
  });
}
function sfxExtraLife() { beep(523, .1, 'square', .07); setTimeout(() => beep(659, .1, 'square', .07), 110); setTimeout(() => beep(784, .15, 'square', .07), 220); }

// ---------- maze helpers ----------
function tileAt(tx, ty) {
  if (ty < 0 || ty >= ROWS) return '#';
  if (tx < 0 || tx >= COLS) return (ty === 14 ? ' ' : '#');
  return MAZE[ty][tx];
}
function isWallTile(tx, ty, ghost) {
  if (ty < 0 || ty >= ROWS) return true;
  if (tx < 0 || tx >= COLS) return ty !== 14;   // tunnel wrap: walkable only on the middle row
  const ch = MAZE[ty][tx];
  if (ch === '#') return true;
  if (ch === '-') return !ghost;
  if (ch === ' ') {
    if (ghost) return false;
    if (ty === 14) return false;
    if (ty >= 11 && ty <= 13 && tx >= 9 && tx <= 18) return true;
    if (tx < 5 || tx > 22) return true;
    return false;
  }
  return false;
}
function isWalkable(tx, ty, ghost) { return !isWallTile(tx, ty, ghost); }

function frightenedDuration(lv) {
  if (lv >= 19) return 0;
  if (lv >= 17) return 2;
  if (lv >= 13) return 3;
  if (lv >= 9) return 3;
  if (lv >= 5) return 3;
  if (lv === 4) return 4;
  if (lv === 3) return 4;
  if (lv === 2) return 5;
  return 6;
}
function ghostSpeed(lv, ghost, frightened, eyes) {
  if (eyes) return 4.0;
  if (frightened) return 1.2;
  // base speeds (tiles/s): blinky slightly faster
  let base = (ghost === 'blinky') ? 1.75 : 1.6;
  if (lv >= 21) base += 0.5;
  else if (lv >= 5) base += 0.25;
  if (lv >= 2) base += 0.05;
  return base;
}
function pacSpeed(lv) {
  let v = 1.8;
  if (lv >= 5) v = 1.9;
  if (lv >= 21) v = 2.0;
  return v;
}
function modeSequence(lv) {
  if (lv >= 21) return [];   // chase forever
  if (lv >= 5) return [{m: 'scatter', t: 5}, {m: 'chase', t: 20}, {m: 'scatter', t: 5}];
  if (lv >= 2) return [{m: 'scatter', t: 7}, {m: 'chase', t: 20}, {m: 'scatter', t: 5}, {m: 'chase', t: 20}, {m: 'scatter', t: 5}];
  return [{m: 'scatter', t: 7}, {m: 'chase', t: 20}, {m: 'scatter', t: 7}, {m: 'chase', t: 20}, {m: 'scatter', t: 5}, {m: 'chase', t: 20}, {m: 'scatter', t: 5}];
}

// ---------- entity helpers ----------
function makePac() {
  return {tx: 13, ty: 23, dir: {x: 0, y: 0}, nextDir: {x: 0, y: 0}, progress: 0, speed: pacSpeed(level),
          mouth: 0, mouthDir: 1, dead: false, deadT: 0, anim: 0};
}
function makeGhost(id) {
  const house = {x: 13.5, y: 14};
  const start = {blinky: {tx: 13, ty: 11, out: 0}, pinky: {tx: 13, ty: 14, out: 4},
                 inky: {tx: 11, ty: 14, out: 8}, clyde: {tx: 15, ty: 14, out: 12}}[id];
  return {id, name: GHOST_NAMES[id], color: GHOST_COLORS[id],
          tx: start.tx, ty: start.ty, dir: {x: 0, y: -1}, nextDir: {x: 0, y: -1}, progress: 0,
          speed: ghostSpeed(level, id, false, false), mode: 'house', modeTimer: start.out,
          frightenedT: 0, eyes: false, eaten: false, target: {x: 13, y: 11}};
}

function ghostTarget(g) {
  if (g.eyes) return {x: 13.5, y: 14};
  if (g.mode === 'frightened') return null;   // random
  if (mode === 'scatter') return SCATTER_TARGETS[g.id];
  // chase
  const px = pac.tx, py = pac.ty;
  const pdx = pac.dir.x, pdy = pac.dir.y;
  if (g.id === 'blinky') return {x: px, y: py};
  if (g.id === 'pinky') return {x: px + pdx * 4, y: py + pdy * 4};
  if (g.id === 'inky') {
    const blinky = ghosts.find(gg => gg.id === 'blinky');
    const ax = px + pdx * 2, ay = py + pdy * 2;
    return {x: ax * 2 - blinky.tx, y: ay * 2 - blinky.ty};
  }
  // clyde: chase if far, else scatter
  const dist = Math.abs(g.tx - px) + Math.abs(g.ty - py);
  return dist > 8 ? {x: px, y: py} : SCATTER_TARGETS.clyde;
}

function ghostDecide(g) {
  // apply queued turn
  if (g.nextDir && (g.nextDir.x !== g.dir.x || g.nextDir.y !== g.dir.y)) {
    if (isWalkable(g.tx + g.nextDir.x, g.ty + g.nextDir.y, true)) g.dir = g.nextDir;
  }
  // if blocked, pick any available direction (not reverse)
  if (!isWalkable(g.tx + g.dir.x, g.ty + g.dir.y, true)) {
    const opts = [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}].filter(d =>
      !(d.x === -g.dir.x && d.y === -g.dir.y) && isWalkable(g.tx + d.x, g.ty + d.y, true));
    if (opts.length) g.dir = opts[Math.floor(Math.random() * opts.length)];
    else g.dir = {x: 0, y: 0};
  }
  // at a junction, choose direction toward target (or random if frightened)
  const avail = [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}].filter(d =>
    !(d.x === -g.dir.x && d.y === -g.dir.y) && isWalkable(g.tx + d.x, g.ty + d.y, true));
  if (avail.length >= 2 || (g.dir.x === 0 && g.dir.y === 0)) {
    if (g.mode === 'frightened' || g.frightenedT > 0) {
      const pick = avail[Math.floor(Math.random() * avail.length)];
      if (pick) g.dir = pick;
    } else {
      const t = ghostTarget(g);
      if (t) {
        let best = null, bestD = Infinity;
        for (const d of avail) {
          const nx = g.tx + d.x, ny = g.ty + d.y;
          const dd = Math.abs(nx - t.x) + Math.abs(ny - t.y);
          if (dd < bestD) { bestD = dd; best = d; }
        }
        if (best) g.dir = best;
      }
    }
  }
}

function ghostStep(g, dt) {
  if (g.progress < 1e-9) g.progress = 0;
  if (g.mode === 'house') {
    g.modeTimer -= dt;
    if (g.modeTimer <= 0) { g.mode = 'exiting'; }
    return;
  }
  if (g.mode === 'exiting') {
    // move up to the door row, then out
    if (g.ty > 11) {
      g.ty -= dt * 2; if (g.ty < 11) g.ty = 11;
      return;
    }
    g.mode = (mode === 'frightened') ? 'frightened' : 'chase';
    g.dir = {x: 0, y: -1}; g.nextDir = {x: 0, y: -1}; g.progress = 0;
    g.frightenedT = 0;
    return;
  }
  // pick direction at tile centers
  if (g.progress === 0) ghostDecide(g);
  // frightened timer
  if (g.frightenedT > 0) {
    g.frightenedT -= dt;
    if (g.frightenedT <= 0) { g.frightenedT = 0; g.mode = (mode === 'scatter' ? 'scatter' : 'chase'); g.eyes = false; }
  }
  // move
  if (g.dir.x === 0 && g.dir.y === 0) return;
  g.progress += g.speed * dt;
  while (g.progress >= 1) {
    // at a tile center: decide direction before stepping
    ghostDecide(g);
    if (g.dir.x === 0 && g.dir.y === 0) { g.progress = 0; break; }
    if (!isWalkable(g.tx + g.dir.x, g.ty + g.dir.y, true)) { g.progress = 0; break; }
    g.tx += g.dir.x; g.ty += g.dir.y;
    if (g.ty === 14) { if (g.tx < 0) g.tx = COLS - 1; if (g.tx >= COLS) g.tx = 0; }
    // eyes reached house → respawn
    if (g.eyes && g.tx === 13 && (g.ty === 13 || g.ty === 14)) {
      g.eyes = false; g.mode = 'house'; g.modeTimer = 3; g.frightenedT = 0;
      g.tx = 13; g.ty = 14;
    }
    g.progress -= 1;
    if (g.progress < 1e-9) g.progress = 0;
  }
  g.speed = ghostSpeed(level, g.id, g.frightenedT > 0, g.eyes);
}

function updatePac(dt) {
  if (pac.dead) { pac.deadT += dt; return; }
  if (pac.progress < 1e-9) pac.progress = 0;
  // turn attempt at tile centers
  if (pac.progress === 0) {
    if (pac.nextDir && (pac.nextDir.x !== pac.dir.x || pac.nextDir.y !== pac.dir.y)) {
      if (isWalkable(pac.tx + pac.nextDir.x, pac.ty + pac.nextDir.y, false)) {
        pac.dir = pac.nextDir;
      }
    }
    if (pac.dir.x !== 0 || pac.dir.y !== 0) {
      if (!isWalkable(pac.tx + pac.dir.x, pac.ty + pac.dir.y, false)) {
        pac.dir = {x: 0, y: 0};
      }
    }
  }
  if (pac.dir.x === 0 && pac.dir.y === 0) {
    pac.mouth += dt * 8 * pac.mouthDir;
    if (pac.mouth > 1) { pac.mouth = 1; pac.mouthDir = -1; }
    if (pac.mouth < 0) { pac.mouth = 0; pac.mouthDir = 1; }
    return;
  }
  pac.progress += pac.speed * dt;
  while (pac.progress >= 1) {
    // at a tile center: apply queued turn, then validate current direction
    if (pac.nextDir && (pac.nextDir.x !== pac.dir.x || pac.nextDir.y !== pac.dir.y)) {
      if (isWalkable(pac.tx + pac.nextDir.x, pac.ty + pac.nextDir.y, false)) pac.dir = pac.nextDir;
    }
    if (pac.dir.x !== 0 || pac.dir.y !== 0) {
      if (!isWalkable(pac.tx + pac.dir.x, pac.ty + pac.dir.y, false)) {
        pac.dir = {x: 0, y: 0}; pac.progress = 0; break;
      }
    } else {
      pac.progress = 0; break;
    }
    pac.tx += pac.dir.x; pac.ty += pac.dir.y;
    if (pac.ty === 14) { if (pac.tx < 0) pac.tx = COLS - 1; if (pac.tx >= COLS) pac.tx = 0; }
    pac.progress -= 1;
    if (pac.progress < 1e-9) pac.progress = 0;
    // eat
    const ch = tileAt(pac.tx, pac.ty);
    if (ch === '.') {
      MAZE[pac.ty] = MAZE[pac.ty].substring(0, pac.tx) + 'E' + MAZE[pac.ty].substring(pac.tx + 1);
      score += 10; dotsLeft--; streak++;
      sfxWaka();
      if (dotsLeft === 0) { levelClear(); }
    } else if (ch === 'o') {
      MAZE[pac.ty] = MAZE[pac.ty].substring(0, pac.tx) + 'E' + MAZE[pac.ty].substring(pac.tx + 1);
      score += 50; dotsLeft--; streak++;
      sfxPower();
      const fd = frightenedDuration(level);
      if (fd > 0) {
        frightenedCount = 0;
        for (const g of ghosts) {
          if (g.mode !== 'house' && !g.eyes) {
            g.frightenedT = fd;
            g.mode = 'frightened';
            // reverse direction
            const rx = -g.dir.x, ry = -g.dir.y;
            g.dir = {x: rx, y: ry};
            g.nextDir = {x: rx, y: ry};
            g.progress = 1 - g.progress;
          }
        }
      }
    }
    // fruit
    if (fruitActive && fruit && fruit.tx === pac.tx && fruit.ty === pac.ty) {
      score += fruit.score; sfxFruit();
      fruitActive = false; fruit = null;
    }
  }
  pac.mouth += dt * 12 * pac.mouthDir;
  if (pac.mouth > 1) { pac.mouth = 1; pac.mouthDir = -1; }
  if (pac.mouth < 0) { pac.mouth = 0; pac.mouthDir = 1; }
  // extra life
  if (score >= 10000 && !extraLifeGiven) { extraLifeGiven = true; lives++; sfxExtraLife(); }
}

function levelClear() {
  levelClearing = true;
  // award prize on first clear
  if (level === 1 && !awardedPrize && Account.signed()) {
    awardedPrize = true;
    Account.award('mini-pacman', 'Mini Pac-Man', 'pacman').catch(() => {});
  }
  // report score
  reportScore();
  setTimeout(() => {
    level++;
    resetLevel();
    levelClearing = false;
  }, 2000);
}

function resetLevel() {
  // rebuild maze from original
  for (let i = 0; i < MAZE.length; i++) MAZE[i] = MAZE_ORIGINAL[i];
  dotsLeft = totalDots;
  pac = makePac();
  ghosts = ['blinky', 'pinky', 'inky', 'clyde'].map(makeGhost);
  mode = 'scatter';
  const seq = modeSequence(level);
  modeCycle = 0;
  readyT = 2;
  if (seq.length) { mode = seq[0].m; modeTimer = seq[0].t; modeCycle = 0; }
  else { mode = 'chase'; modeTimer = 999; }
  frightenedTimer = 0;
  fruitActive = false; fruit = null; fruitTimer = 0;
  // fruit spawn schedule
  fruitTimer = 0;
}

const MAZE_ORIGINAL = MAZE.map(r => r);

function initLevel1() {
  totalDots = MAZE.join('').split('.').length + MAZE.join('').split('o').length - 2;
  // actually count: 240 dots + 4 power
  totalDots = 244;
  dotsLeft = totalDots;
  pac = makePac();
  ghosts = ['blinky', 'pinky', 'inky', 'clyde'].map(makeGhost);
  mode = 'scatter';
  const seq = modeSequence(level);
  if (seq.length) { mode = seq[0].m; modeTimer = seq[0].t; readyT = 2; }
  else { mode = 'chase'; modeTimer = 999; readyT = 2; }
}

// ---------- mode timer ----------
function updateMode(dt) {
  if (mode === 'chase' && modeCycle >= 100) return;   // chase forever
  modeTimer -= dt;
  if (modeTimer <= 0) {
    const seq = modeSequence(level);
    modeCycle++;
    if (modeCycle < seq.length) {
      mode = seq[modeCycle].m;
      modeTimer = seq[modeCycle].t;
    } else {
      mode = 'chase';
      modeTimer = 999;
      modeCycle = 100;
    }
    // switch ghost modes (except frightened/eyes/house)
    for (const g of ghosts) {
      if (g.mode !== 'house' && g.mode !== 'exiting' && g.frightenedT <= 0 && !g.eyes) {
        g.mode = mode;
        // reverse direction on mode switch
        const rx = -g.dir.x, ry = -g.dir.y;
        g.dir = {x: rx, y: ry};
        g.nextDir = {x: rx, y: ry};
        g.progress = 1 - g.progress;
      }
    }
  }
}

// ---------- fruit spawn ----------
function updateFruit(dt) {
  if (fruitActive) {
    fruit.timer -= dt;
    if (fruit.timer <= 0) { fruitActive = false; fruit = null; }
    return;
  }
  if (dotsLeft === 170 || dotsLeft === 70) {
    // spawn fruit at the center below the ghost house
    const f = fruitForLevel(level);
    fruit = {tx: 13, ty: 17, timer: 9, score: f.score, name: f.name, color: f.color};
    fruitActive = true;
    sfxFruit();
    // consume the trigger (only once per threshold)
    // mark by setting dotsLeft to ... we use a flag via fruitTimer
  }
}

// ---------- collision: pac vs ghosts ----------
function checkCollisions() {
  if (pac.dead || levelClearing) return;
  for (const g of ghosts) {
    if (g.mode === 'house' || g.mode === 'exiting') continue;
    if (g.tx === pac.tx && g.ty === pac.ty) {
      if (g.frightenedT > 0) {
        // eat ghost
        g.eyes = true;
        g.frightenedT = 0;
        g.mode = 'eyes';
        const pts = 200 * Math.pow(2, frightenedCount);
        frightenedCount++;
        score += pts;
        sfxEatGhost();
        // flash score popup (handled in draw)
        g.scorePopup = {pts, t: 1.2};
      } else if (!g.eyes) {
        // pac dies
        pacDie();
        return;
      }
    }
  }
}

function pacDie() {
  pac.dead = true;
  pac.deadT = 0;
  streak = 0;
  sfxDeath();
  lives--;
  if (lives <= 0) {
    setTimeout(() => {
      gameOver = true; newHighScore = (score > (highScore || 0)); if (newHighScore) highScore = score; reportScore();
      // breaking the high score earns a collectible
      fetch('/api/scores').then(r => r.json()).then(j => {
        const hs = (j && j.pacman && j.pacman.best) ? (j.pacman.best.value || 0) : (highScore || 0);
        if (score > hs) {
          highScore = score;
          const prizes = [
            {item: 'mini-power-pellet', label: 'Mini Power Pellet'},
            {item: 'mini-pacman', label: 'Mini Pac-Man'},
            {item: 'mini-ghost', label: 'Mini Ghost'},
          ];
          const p = prizes[Math.floor(Math.random() * prizes.length)];
          Account.award(p.item, p.label, 'pacman').catch(() => {});
        }
      }).catch(() => {});
    }, 1500);
  } else {
    setTimeout(() => { resetAfterDeath(); }, 1500);
  }
}

function resetAfterDeath() {
  pac = makePac();
  ghosts = ['blinky', 'pinky', 'inky', 'clyde'].map(makeGhost);
  mode = 'scatter';
  const seq = modeSequence(level);
  if (seq.length) { mode = seq[0].m; modeTimer = seq[0].t; modeCycle = 0; readyT = 2; }
  else { mode = 'chase'; modeTimer = 999; readyT = 2; }
  frightenedTimer = 0;
  fruitActive = false; fruit = null;
}

// ---------- drawing ----------
const COLORS = {wall: '#1a2a8a', dot: '#ffb897', power: '#ffb897', pac: '#ffff00',
  tunnel: '#000'};

function draw() {
  if (!ctx) return;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  // score band
  ctx.fillStyle = '#fff'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'left';
  ctx.fillText('SCORE ' + score, 4, 12);
  ctx.textAlign = 'right';
  ctx.fillText('HIGH ' + highScore, CANVAS_W - 4, 12);
  ctx.textAlign = 'center';
  ctx.fillText('LEVEL ' + level, CANVAS_W / 2, 12);
  if (frightenedCount > 0 && ghosts.some(g => g.frightenedT > 0)) {
    ctx.textAlign = 'right'; ctx.fillStyle = '#00ffff'; ctx.font = 'bold 10px monospace';
    ctx.fillText('COMBO x' + Math.pow(2, frightenedCount - 1), CANVAS_W - 4, 24);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px monospace';
  }
  if (streak > 5) { ctx.textAlign = 'left'; ctx.fillStyle = '#f2c14e'; ctx.fillText('x' + streak, 4, 24); ctx.fillStyle = '#fff'; }

  // maze
  ctx.save();
  ctx.translate(0, MAZE_Y);
  for (let ty = 0; ty < ROWS; ty++) {
    for (let tx = 0; tx < COLS; tx++) {
      const ch = (MAZE[ty] || '')[tx] || '#';
      const x = tx * TILE, y = ty * TILE;
      if (ch === '#') {
        ctx.fillStyle = COLORS.wall;
        ctx.fillRect(x, y, TILE, TILE);
      } else if (ch === '.') {
        ctx.fillStyle = COLORS.dot;
        ctx.beginPath(); ctx.arc(x + TILE / 2, y + TILE / 2, 1.5, 0, Math.PI * 2); ctx.fill();
      } else if (ch === 'o') {
        ctx.fillStyle = COLORS.power;
        ctx.beginPath(); ctx.arc(x + TILE / 2, y + TILE / 2, 3.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  // fruit
  if (fruitActive && fruit) {
    const f = fruitForLevel(level);
    ctx.fillStyle = f.color;
    ctx.beginPath(); ctx.arc(fruit.tx * TILE + TILE / 2, fruit.ty * TILE + TILE / 2, 5, 0, Math.PI * 2); ctx.fill();
  }
  // pac
  if (!pac.dead) {
    const px = pac.tx * TILE + pac.progress * pac.dir.x * TILE + TILE / 2;
    const py = pac.ty * TILE + pac.progress * pac.dir.y * TILE + TILE / 2;
    const angle = pac.dir.x === 1 ? 0 : pac.dir.x === -1 ? Math.PI : pac.dir.y === 1 ? Math.PI / 2 : pac.dir.y === -1 ? -Math.PI / 2 : 0;
    const mouth = pac.mouth * 0.7;
    ctx.fillStyle = '#ffff00';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, TILE / 2 - 1, angle + mouth, angle + Math.PI * 2 - mouth);
    ctx.closePath(); ctx.fill();
  } else {
    // death spin
    const k = Math.min(1, pac.deadT / 1.5);
    const px = pac.tx * TILE + TILE / 2, py = pac.ty * TILE + TILE / 2;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(k * Math.PI * 2);
    ctx.scale(1 - k, 1 - k);
    ctx.fillStyle = '#ffff00';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, TILE / 2 - 1, 0.3, Math.PI * 2 - 0.3);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // ghosts
  for (const g of ghosts) {
    if (g.mode === 'house' || g.mode === 'exiting') {
      // draw in house
      const gx = g.tx * TILE + TILE / 2, gy = g.ty * TILE + TILE / 2;
      drawGhost(g, gx, gy);
      continue;
    }
    const gx = g.tx * TILE + g.progress * g.dir.x * TILE + TILE / 2;
    const gy = g.ty * TILE + g.progress * g.dir.y * TILE + TILE / 2;
    drawGhost(g, gx, gy);
    if (g.scorePopup) {
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
      ctx.fillText(g.scorePopup.pts, gx, gy - 14);
    }
  }
  ctx.restore();
  // lives
  ctx.fillStyle = '#ffff00';
  for (let i = 0; i < lives; i++) {
    ctx.beginPath(); ctx.arc(8 + i * 16, CANVAS_H - 8, 5, 0.3, Math.PI * 2 - 0.3); ctx.fill();
  }
  // fruit score popup (none needed)
  // level clear overlay
  if (readyT > 0) {
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#f2c14e'; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center';
    ctx.fillText('READY!', CANVAS_W / 2, CANVAS_H / 2);
  }
  if (levelClearing) {
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#f2c14e'; ctx.font = 'bold 16px monospace'; ctx.textAlign = 'center';
    ctx.fillText('LEVEL ' + level + ' CLEAR!', CANVAS_W / 2, CANVAS_H / 2);
  }
  if (paused && !gameOver) {
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center';
    ctx.fillText('PAUSED', CANVAS_W / 2, CANVAS_H / 2);
    ctx.font = '12px monospace';
    ctx.fillText('Press space to resume', CANVAS_W / 2, CANVAS_H / 2 + 20);
  }
  if (gameOver) {
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#ff4d6d'; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', CANVAS_W / 2, CANVAS_H / 2 - 10);
    ctx.fillStyle = '#fff'; ctx.font = '12px monospace';
    ctx.fillText('Score: ' + score, CANVAS_W / 2, CANVAS_H / 2 + 10);
    ctx.fillText('Tap to play again', CANVAS_W / 2, CANVAS_H / 2 + 30);
    if (newHighScore) { ctx.fillStyle = '#f2c14e'; ctx.font = 'bold 14px monospace'; ctx.fillText('NEW HIGH SCORE!', CANVAS_W / 2, CANVAS_H / 2 + 50); }
  }
}

function drawGhost(g, gx, gy) {
  const frightened = g.frightenedT > 0;
  const flashing = frightened && g.frightenedT < 2;
  const bodyColor = g.eyes ? '#fff' : (frightened ? (flashing && Math.floor(Date.now() / 200) % 2 ? '#fff' : '#2121de') : g.color);
  // body
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.arc(gx, gy - 2, 7, Math.PI, 0);
  ctx.lineTo(gx + 7, gy + 7);
  // wavy bottom
  for (let i = 0; i < 3; i++) {
    ctx.lineTo(gx + 7 - (i + 1) * (14 / 3), gy + 4 + (i % 2 ? 2 : -1));
  }
  ctx.lineTo(gx - 7, gy + 7);
  ctx.closePath(); ctx.fill();
  // eyes
  if (g.eyes) {
    // just eyes (no body) — white with blue pupils pointing in direction
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(gx - 3, gy - 2, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(gx + 3, gy - 2, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#00f';
    ctx.beginPath(); ctx.arc(gx - 3 + g.dir.x * 1.5, gy - 2 + g.dir.y * 1.5, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(gx + 3 + g.dir.x * 1.5, gy - 2 + g.dir.y * 1.5, 1.5, 0, Math.PI * 2); ctx.fill();
  } else if (frightened) {
    // simple eyes
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(gx - 3, gy - 2, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(gx + 3, gy - 2, 2, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(gx - 3, gy - 2, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(gx + 3, gy - 2, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#00f';
    const px = g.dir.x * 1.5, py = g.dir.y * 1.5;
    ctx.beginPath(); ctx.arc(gx - 3 + px, gy - 2 + py, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(gx + 3 + px, gy - 2 + py, 1.5, 0, Math.PI * 2); ctx.fill();
  }
  if (g.scorePopup) {
    ctx.fillStyle = '#fff'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
    ctx.fillText(g.scorePopup.pts, gx, gy - 16);
  }
}

// ---------- game loop ----------
function update(dt) {
  if (paused || gameOver || levelClearing) return;
  if (pac.dead) { pac.deadT += dt; return; }
  if (readyT > 0) { readyT -= dt; return; }
  // mode timer
  updateMode(dt);
  // frightened timer handled per-ghost in ghostStep
  // fruit
  updateFruit(dt);
  // pac
  updatePac(dt);
  // ghosts
  for (const g of ghosts) ghostStep(g, dt);
  // collisions
  checkCollisions();
  // score popups decay
  for (const g of ghosts) if (g.scorePopup) { g.scorePopup.t -= dt; if (g.scorePopup.t <= 0) g.scorePopup = null; }
}

function loop(t) {
  if (!running) return;
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
  lastT = t;
  if (!paused && !gameOver) update(dt);
  draw();
  raf = requestAnimationFrame(loop);
}

// ---------- input ----------
function setDir(d) {
  if (pac && !pac.dead && !gameOver && !levelClearing) pac.nextDir = DIRS[d];
}
function handleKey(e) {
  if (e.key === 'ArrowLeft') { setDir('left'); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { setDir('right'); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { setDir('up'); e.preventDefault(); }
  else if (e.key === 'ArrowDown') { setDir('down'); e.preventDefault(); }
  else if (e.key === ' ' || e.key === 'p' || e.key === 'P') { paused = !paused; e.preventDefault(); }
}

// ---------- lifecycle ----------
function startGame() {
  score = 0; level = 1; lives = 3; extraLifeGiven = false; awardedPrize = false;
  gameOver = false; paused = false; levelClearing = false; newHighScore = false;
  initLevel1();
  highScore = highScore || 0;
  fetch('/api/scores').then(r => r.json()).then(j => { if (j && j.pacman && j.pacman.best) highScore = j.pacman.best.value || 0; }).catch(() => {});
  sfxStart();
  running = true; lastT = performance.now();
  raf = requestAnimationFrame(loop);
}

function resetGame() {
  if (raf) cancelAnimationFrame(raf); raf = 0;
  running = false;
  startGame();
}

function reportScore() {
  let phone = '';
  try { const a = JSON.parse(localStorage.getItem('eolAcct') || 'null'); if (a && a.phone) phone = a.phone; } catch (e) {}
  try {
    fetch('/api/score', {method: 'POST', headers: {'Content-Type': 'application/json'},
      keepalive: true, body: JSON.stringify({game: 'pacman', value: score, name: (localStorage.getItem('eol-visitor-name') || 'Player'), phone})}).catch(() => {});
  } catch (e) {}
}

// ---------- UI ----------
function buildUI() {
  panel = document.createElement('div');
  panel.id = 'eolPac'; panel.hidden = true;
  panel.style.cssText = 'position:fixed;inset:0;z-index:80;display:none;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,.92);backdrop-filter:blur(4px)';
  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;color:#fff;font:700 14px Inter,sans-serif">
      <b>🟡 PAC-MAN</b>
      <span style="opacity:.7;font-size:12px">swipe or use the D-pad · space pause</span>
      <button id="eolPacX" aria-label="Close" style="margin-left:auto;background:none;border:0;color:#fff;font-size:18px;cursor:pointer">✕</button>
    </div>
    <canvas id="eolPacC" width="${CANVAS_W}" height="${CANVAS_H}" style="image-rendering:pixelated;border:2px solid #222;border-radius:4px;touch-action:none;max-width:90vw;max-height:70vh"></canvas>
    <div style="display:flex;gap:8px;margin-top:10px;align-items:center">
      <button class="eolPacD" data-d="up" style="width:44px;height:44px;border-radius:10px;border:1px solid #444;background:#1a1a2e;color:#fff;font-size:18px;cursor:pointer">▲</button>
      <div style="display:flex;flex-direction:column;gap:4px">
        <div style="display:flex;gap:4px">
          <button class="eolPacD" data-d="left" style="width:44px;height:44px;border-radius:10px;border:1px solid #444;background:#1a1a2e;color:#fff;font-size:18px;cursor:pointer">◀</button>
          <button class="eolPacD" data-d="down" style="width:44px;height:44px;border-radius:10px;border:1px solid #444;background:#1a1a2e;color:#fff;font-size:18px;cursor:pointer">▼</button>
          <button class="eolPacD" data-d="right" style="width:44px;height:44px;border-radius:10px;border:1px solid #444;background:#1a1a2e;color:#fff;font-size:18px;cursor:pointer">▶</button>
        </div>
      </div>
      <button id="eolPacPause" style="margin-left:8px;padding:8px 12px;border-radius:10px;border:1px solid #444;background:#1a1a2e;color:#fff;font-size:12px;cursor:pointer">⏸</button>
      <button id="eolPacSound" style="margin-left:8px;padding:8px 12px;border-radius:10px;border:1px solid #444;background:#1a1a2e;color:#fff;font-size:12px;cursor:pointer">🔊</button>
    </div>`;
  document.body.appendChild(panel);
  canvas = panel.querySelector('#eolPacC');
  ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  panel.querySelector('#eolPacX').onclick = () => { close(); };
  panel.querySelectorAll('.eolPacD').forEach(b => {
    b.onpointerdown = (e) => { e.preventDefault(); setDir(b.dataset.d); };
  });
  panel.querySelector('#eolPacPause').onclick = () => { paused = !paused; panel.querySelector('#eolPacPause').textContent = paused ? '▶' : '⏸'; };
  panel.querySelector('#eolPacSound').onclick = () => {
    soundOn = !soundOn;
    panel.querySelector('#eolPacSound').textContent = soundOn ? '🔊' : '🔇';
  };

  // swipe on canvas
  let sx = 0, sy = 0, swiping = false;
  canvas.addEventListener('pointerdown', e => { swiping = true; sx = e.clientX; sy = e.clientY; });
  canvas.addEventListener('pointerup', e => {
    if (!swiping) return; swiping = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
    if (Math.abs(dx) > Math.abs(dy)) setDir(dx > 0 ? 'right' : 'left');
    else setDir(dy > 0 ? 'down' : 'up');
  });
  // tap to (re)start
  canvas.addEventListener('click', () => {
    if (gameOver) resetGame();
    else if (!running) startGame();
  });

  addEventListener('keydown', handleKey);
}

function open() {
  if (!panel) buildUI();
  panel.hidden = false;
  panel.style.display = 'flex';
  if (menuOpen) { panelWasOpen = true; }
  if (!running && !gameOver) startGame();
  else if (gameOver) { /* wait for tap */ }
}

function close() {
  panel.style.display = 'none';
  panel.hidden = true;
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  running = false;
  reportScore();
}

// menu overlay tuck-away (same dance as hotdog/jukebox)
// (registered in init after panel exists)

let inited = false;
function init() {
  if (inited) return; inited = true;
  if (window.__EOL_LITE) return;   // lite mode: skip heavy game
  if (!CONFIG || CONFIG.gamePacmanOn === false) return;   // owner switched Pac-Man off
  buildUI();
  addEventListener('eol:pac-open', () => { if (menuOpen) return; panel.hidden = false; panel.style.display = 'flex'; if (!running && !gameOver) startGame(); });
  addEventListener('eol:menu-open', () => { menuOpen = true; panelWasOpen = !panel.hidden && panel.style.display !== 'none'; panel.style.display = 'none'; panel.hidden = true; if (raf) { cancelAnimationFrame(raf); raf = 0; running = false; } });
  addEventListener('eol:menu-close', () => { menuOpen = false; panel.hidden = !panelWasOpen; panel.style.display = panelWasOpen ? 'flex' : 'none'; if (!panel.hidden && !running && !gameOver) { running = true; lastT = performance.now(); raf = requestAnimationFrame(loop); } });
  addEventListener('eol:account-updated', () => { /* points display could refresh; HUD shows score only */ });
}

// fetch high score on first open
function ensureHighScore() {
  if (highScore) return;
  fetch('/api/scores').then(r => r.json()).then(j => { if (j && j.pacman && j.pacman.best) highScore = j.pacman.best.value || 0; }).catch(() => {});
}

init();
// expose open for the pill
window.__EOL_PAC_OPEN = () => { if (!panel) buildUI(); panel.hidden = false; panel.style.display = 'flex'; if (!running && !gameOver) { ensureHighScore(); startGame(); } };