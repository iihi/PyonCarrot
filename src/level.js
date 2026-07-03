// ステージ生成とソルバー
// 生成方法: スタート地点から「方向×距離(1〜3)」をランダムに選んで経路を伸ばしていく。
// 各マスの数字 = そのマスから実際にジャンプした距離。これにより必ず解が存在する。

import { mixSeed, mulberry32 } from './rng.js';

export const GRID = 9;
export const MAX_TILES = 30;

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function tileCountForStage(stage) {
  return Math.min(3 + stage, MAX_TILES);
}

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

export function generate(seed, stage) {
  const rand = mulberry32(mixSeed(seed, stage));
  let n = tileCountForStage(stage);

  for (let attempt = 0; attempt < 400; attempt++) {
    const level = tryGenerate(rand, n, seed, stage);
    if (level) {
      addPickups(level, rand, stage);
      return level;
    }
    // どうしても置けない場合は少しだけ規模を落として再試行(ほぼ発生しない)
    if (attempt > 300 && n > 6) n--;
  }
  throw new Error('stage generation failed');
}

function tryGenerate(rand, n, seed, stage) {
  const occ = new Set();
  const key = (x, y) => x * 16 + y;

  const sx = 2 + Math.floor(rand() * (GRID - 4));
  const sy = 2 + Math.floor(rand() * (GRID - 4));
  const tiles = [{ x: sx, y: sy, value: 0, pickup: null }];
  occ.add(key(sx, sy));
  let goal = null;

  for (let j = 0; j < n; j++) {
    const cur = tiles[j];
    const opts = [];
    for (const [dx, dy] of DIRS) {
      for (let d = 1; d <= 3; d++) {
        const nx = cur.x + dx * d;
        const ny = cur.y + dy * d;
        if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
        if (occ.has(key(nx, ny))) continue;
        opts.push({ nx, ny, d });
      }
    }
    if (opts.length === 0) return null;
    const o = opts[Math.floor(rand() * opts.length)];
    cur.value = o.d;
    if (j < n - 1) {
      tiles.push({ x: o.nx, y: o.ny, value: 0, pickup: null });
      occ.add(key(o.nx, o.ny));
    } else {
      goal = { x: o.nx, y: o.ny };
    }
  }

  return { seed, stage, tiles, goal, count: n };
}

function addPickups(level, rand, stage) {
  if (stage < 3) return;
  const nPick = Math.min(1 + (stage >= 8 ? 1 : 0), level.tiles.length - 2);
  const candidates = [];
  for (let i = 1; i < level.tiles.length; i++) candidates.push(i);
  for (let p = 0; p < nPick && candidates.length; p++) {
    const ci = Math.floor(rand() * candidates.length);
    const idx = candidates.splice(ci, 1)[0];
    level.tiles[idx].pickup = rand() < 0.5 ? 'rewind' : 'hint';
  }
}

// cur から今行けるマスの一覧を返す。ゴールは「他の葉(土マス)が全て消えた後」だけ行ける。
export function reachableFrom(level, alive, curIdx) {
  const cur = level.tiles[curIdx];
  const v = cur.value;
  const res = [];
  let anyAlive = false;
  for (let i = 0; i < level.tiles.length; i++) {
    if (!alive[i]) continue;
    anyAlive = true;
    const t = level.tiles[i];
    const dx = t.x - cur.x;
    const dy = t.y - cur.y;
    if ((dx === 0 && Math.abs(dy) === v) || (dy === 0 && Math.abs(dx) === v)) {
      res.push(i);
    }
  }
  if (!anyAlive) {
    const gx = level.goal.x - cur.x;
    const gy = level.goal.y - cur.y;
    if ((gx === 0 && Math.abs(gy) === v) || (gy === 0 && Math.abs(gx) === v)) {
      res.push('goal');
    }
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
    const v = curTile.value;

    if (m === 0) {
      const gx = level.goal.x - curTile.x;
      const gy = level.goal.y - curTile.y;
      if ((gx === 0 && Math.abs(gy) === v) || (gy === 0 && Math.abs(gx) === v)) {
        return ['goal'];
      }
      failed.add(memoKey);
      return null;
    }

    for (let i = 0; i < n; i++) {
      if (!(m & (1 << i))) continue;
      const t = level.tiles[i];
      const dx = t.x - curTile.x;
      const dy = t.y - curTile.y;
      if ((dx === 0 && Math.abs(dy) === v) || (dy === 0 && Math.abs(dx) === v)) {
        const rest = dfs(i, m & ~(1 << i));
        if (rest) return [i, ...rest];
      }
    }
    failed.add(memoKey);
    return null;
  }

  return dfs(curIdx, mask);
}
