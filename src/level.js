// ステージ生成とソルバー
// 生成方法: 先に地形(高さマップ)を作り、スタート地点から「方向×距離」を
// ランダムに選んで経路を伸ばしていく。各マスの数字 = そのジャンプに必要なパワー
// (= 水平距離 + 高低差)。これにより必ず解が存在する。
//
// 段差ルール:
//  - 必要パワー N = 水平距離 d + (着地の高さ - 出発の高さ)。Nは1〜3
//    → 上りは1段ごとに距離-1、下りは1段ごとに距離+1
//  - 出発マスと着地マスの高い方より高い地形が途中にあると飛べない(ブロック)
//  - 高さは地形に固定。マス(ニンジン)が消えても地形は残る

import { mixSeed, mulberry32 } from './rng.js';

export const GRID = 9;
export const MAX_TILES = 30;
export const MAX_HEIGHT = 3; // 高さレベル0〜3(=段差3段)。ここを変えれば引き上げ可能

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// ---------- 難易度カーブ ----------
// 序盤が簡単すぎる問題への対応: 8マスから始めて毎ステージ+2、ステージ12で最大30マス
export function tileCountForStage(stage) {
  return Math.min(8 + 2 * (stage - 1), MAX_TILES);
}

// 段差の解禁: 〜2フラット / 3〜1段 / 7〜2段 / 12〜3段
export function heightCapForStage(stage) {
  if (stage < 3) return 0;
  if (stage < 7) return 1;
  if (stage < 12) return 2;
  return MAX_HEIGHT;
}

// ---------- ステージコード ----------
export function makeCode(seed, stage) {
  return `${String(seed).padStart(4, '0')}-${stage}`;
}

export function parseCode(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d{4})\s*[-ー－]?\s*(\d{1,3})$/);
  if (!m) return null;
  const seed = parseInt(m[1], 10);
  const stage = parseInt(m[2], 10);
  if (stage < 1 || stage > 999) return null;
  return { seed, stage };
}

// ---------- 地形 ----------
// 丘(ひし形の台地)を重ねて段々畑をつくる
function genTerrain(rand, stage, cap) {
  const h = Array.from({ length: GRID }, () => new Array(GRID).fill(0));
  if (cap === 0) return h;
  const hills = Math.min(2 + Math.floor(stage / 4), 7);
  for (let i = 0; i < hills; i++) {
    const cx = Math.floor(rand() * GRID);
    const cy = Math.floor(rand() * GRID);
    const r = 1 + Math.floor(rand() * 2);
    for (let x = 0; x < GRID; x++) {
      for (let y = 0; y < GRID; y++) {
        if (Math.abs(x - cx) + Math.abs(y - cy) <= r) {
          h[x][y] = Math.min(cap, h[x][y] + 1);
        }
      }
    }
  }
  return h;
}

// 出発(x1,y1)→着地(x2,y2)の間に「両端の高い方」より高い地形があるとブロック
export function blockedPath(heights, x1, y1, x2, y2) {
  const top = Math.max(heights[x1][y1], heights[x2][y2]);
  const dx = Math.sign(x2 - x1);
  const dy = Math.sign(y2 - y1);
  let x = x1 + dx;
  let y = y1 + dy;
  while (x !== x2 || y !== y2) {
    if (heights[x][y] > top) return true;
    x += dx;
    y += dy;
  }
  return false;
}

// from(数字value・位置)から(tx,ty)へ飛べるか
function canJump(level, from, tx, ty) {
  const dx = tx - from.x;
  const dy = ty - from.y;
  if (dx !== 0 && dy !== 0) return false;
  const d = Math.abs(dx) + Math.abs(dy);
  if (d === 0) return false;
  const need = d + level.heights[tx][ty] - level.heights[from.x][from.y];
  if (need !== from.value) return false;
  return !blockedPath(level.heights, from.x, from.y, tx, ty);
}

// ---------- 生成 ----------
export function generate(seed, stage) {
  const rand = mulberry32(mixSeed(seed, stage));
  let n = tileCountForStage(stage);
  const cap = heightCapForStage(stage);

  for (let attempt = 0; attempt < 500; attempt++) {
    // 試行ごとに地形も作り直す(乱数列は連続なので決定論は保たれる)
    const heights = genTerrain(rand, stage, cap);
    const level = tryGenerate(rand, n, seed, stage, heights);
    if (level) return level;
    if (attempt > 350 && n > 8) n--;
  }
  throw new Error('stage generation failed');
}

function tryGenerate(rand, n, seed, stage, heights) {
  const occ = new Set();
  const key = (x, y) => x * 16 + y;

  const sx = 2 + Math.floor(rand() * (GRID - 4));
  const sy = 2 + Math.floor(rand() * (GRID - 4));
  const tiles = [{ x: sx, y: sy, value: 0 }];
  occ.add(key(sx, sy));
  let goal = null;

  for (let j = 0; j < n; j++) {
    const cur = tiles[j];
    const h1 = heights[cur.x][cur.y];
    const opts = [];
    for (const [dx, dy] of DIRS) {
      for (let d = 1; d <= 3 + MAX_HEIGHT; d++) {
        const nx = cur.x + dx * d;
        const ny = cur.y + dy * d;
        if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
        if (occ.has(key(nx, ny))) continue;
        const need = d + heights[nx][ny] - h1;
        if (need < 1 || need > 3) continue;
        if (blockedPath(heights, cur.x, cur.y, nx, ny)) continue;
        opts.push({ nx, ny, need });
      }
    }
    if (opts.length === 0) return null;
    const o = opts[Math.floor(rand() * opts.length)];
    cur.value = o.need;
    if (j < n - 1) {
      tiles.push({ x: o.nx, y: o.ny, value: 0 });
      occ.add(key(o.nx, o.ny));
    } else {
      goal = { x: o.nx, y: o.ny };
    }
  }

  return { seed, stage, tiles, goal, heights, count: n };
}

// ---------- 到達判定 ----------
// cur から今行けるマスの一覧を返す。ゴールは「他のマスが全て消えた後」だけ行ける。
export function reachableFrom(level, alive, curIdx) {
  const cur = level.tiles[curIdx];
  const res = [];
  let anyAlive = false;
  for (let i = 0; i < level.tiles.length; i++) {
    if (!alive[i]) continue;
    anyAlive = true;
    const t = level.tiles[i];
    if (canJump(level, cur, t.x, t.y)) res.push(i);
  }
  if (!anyAlive && canJump(level, cur, level.goal.x, level.goal.y)) {
    res.push('goal');
  }
  return res;
}

// 現在の状態から解を探す（ヒント用）。次に踏むべきマスの配列（最後は 'goal'）か null を返す。
export function findSolution(level, alive, curIdx) {
  const n = level.tiles.length;
  let mask = 0;
  for (let i = 0; i < n; i++) if (alive[i]) mask |= 1 << i;

  const failed = new Set();

  function dfs(cur, m) {
    // m は最大30ビットなので、キーは m*32+cur で衝突なし(2^35 < 2^53)
    const memoKey = m * 32 + cur;
    if (failed.has(memoKey)) return null;

    const curTile = level.tiles[cur];

    if (m === 0) {
      if (canJump(level, curTile, level.goal.x, level.goal.y)) return ['goal'];
      failed.add(memoKey);
      return null;
    }

    for (let i = 0; i < n; i++) {
      if (!(m & (1 << i))) continue;
      const t = level.tiles[i];
      if (canJump(level, curTile, t.x, t.y)) {
        const rest = dfs(i, m & ~(1 << i));
        if (rest) return [i, ...rest];
      }
    }
    failed.add(memoKey);
    return null;
  }

  return dfs(curIdx, mask);
}
