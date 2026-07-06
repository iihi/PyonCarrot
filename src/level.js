// ステージ生成とソルバー (v3: 自由ルート)
//
// ルール:
//  - 必要パワー N = 水平距離 d + (着地の高さ - 出発の高さ)。Nは1〜3
//  - 出発マスと着地マスの高い方より高い地形が途中にあると飛べない(ブロック)
//  - ゴールはいつでも入れる(全マス踏破は不要)。好きなだけニンジンを集めてゴールへ
//  - 生成は「全マスを巡る経路」を構築するので、パーフェクト(全回収)ルートが必ず存在する
//
// ギミック:
//  - ジャンプ台(spring): そのマスから飛ぶときパワー+2
//  - 氷(ice): 着地すると進行方向の次のマスまで滑る(滑ったマスも食べる)。氷が続く限り滑る
//  - 大ニンジン(golden): 食べるとニンジン5本分

import { mixSeed, mulberry32 } from './rng.js';

export const GRID = 9;
export const MAX_TILES = 30;
export const MAX_HEIGHT = 3; // 高さレベル0〜3(=段差3段)

export const SPRING_BONUS = 2; // ジャンプ台で伸びる距離
export const GOLD_MULT = 5; // 大ニンジンは1本で5本分(獲得 = 本数 × 5)

// ギミックの解禁ステージと出現率・上限
const GOLD_STAGE = 3;
const SPRING_STAGE = 4;
const ICE_STAGE = 6;
const P_GOLD = 0.08;
const P_SPRING = 0.1;
const P_ICE = 0.15;
const MAX_GOLD = 2;
const MAX_SPRING = 3;
const MAX_ICE_CHAINS = 3;

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// ---------- 難易度カーブ ----------
export function tileCountForStage(stage) {
  return Math.min(8 + 2 * (stage - 1), MAX_TILES);
}

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

// マスの実効パワー(ジャンプ台なら+2)
export function tilePower(tile) {
  return tile.value + (tile.spring ? SPRING_BONUS : 0);
}

// from(マス)から(tx,ty)へ飛べるか
function canJump(level, from, tx, ty) {
  const dx = tx - from.x;
  const dy = ty - from.y;
  if (dx !== 0 && dy !== 0) return false;
  const d = Math.abs(dx) + Math.abs(dy);
  if (d === 0) return false;
  const need = d + level.heights[tx][ty] - level.heights[from.x][from.y];
  if (need !== tilePower(from)) return false;
  return !blockedPath(level.heights, from.x, from.y, tx, ty);
}

// ---------- 着地の解決(氷スライド) ----------
// targetIdx に着地したあと、氷なら進行方向の次のマスへ滑り続ける。
// 返り値: { finalIdx, eaten } eatenは触れた順のマスindex(先頭=target)。全て消費される。
function resolveMoveM(level, mask, fromIdx, targetIdx) {
  const from = level.tiles[fromIdx];
  const to = level.tiles[targetIdx];
  const sx = Math.sign(to.x - from.x);
  const sy = Math.sign(to.y - from.y);
  const eaten = [targetIdx];
  let cur = targetIdx;
  let guard = 0;
  while (level.tiles[cur].ice && guard++ < 32) {
    const c = level.tiles[cur];
    let best = null;
    for (let i = 0; i < level.tiles.length; i++) {
      if (!(mask & (1 << i))) continue;
      if (eaten.includes(i)) continue;
      const t = level.tiles[i];
      const ddx = t.x - c.x;
      const ddy = t.y - c.y;
      if (sx !== 0 && (ddy !== 0 || Math.sign(ddx) !== sx)) continue;
      if (sy !== 0 && (ddx !== 0 || Math.sign(ddy) !== sy)) continue;
      const dist = Math.abs(ddx) + Math.abs(ddy);
      if (!best || dist < best.dist) best = { i, dist };
    }
    if (!best) break; // 先にマスがなければ氷の上で止まる
    eaten.push(best.i);
    cur = best.i;
  }
  return { finalIdx: cur, eaten };
}

// 配列版(ゲーム本体用)
export function resolveMove(level, alive, fromIdx, targetIdx) {
  let mask = 0;
  for (let i = 0; i < level.tiles.length; i++) if (alive[i]) mask |= 1 << i;
  return resolveMoveM(level, mask, fromIdx, targetIdx);
}

// ---------- 生成 ----------
export function generate(seed, stage) {
  const rand = mulberry32(mixSeed(seed, stage));
  let n = tileCountForStage(stage);
  const cap = heightCapForStage(stage);

  for (let attempt = 0; attempt < 500; attempt++) {
    const heights = genTerrain(rand, stage, cap);
    const level = tryGenerate(rand, n, seed, stage, heights);
    if (level) {
      level.minMoves = computeMinMoves(level);
      return level;
    }
    if (attempt > 350 && n > 8) n--;
  }
  throw new Error('stage generation failed');
}

function tryGenerate(rand, n, seed, stage, heights) {
  const occ = new Set();
  const key = (x, y) => x * 16 + y;
  const inGrid = (x, y) => x >= 0 && y >= 0 && x < GRID && y < GRID;

  const pGold = stage >= GOLD_STAGE ? P_GOLD : 0;
  const pSpring = stage >= SPRING_STAGE ? P_SPRING : 0;
  const pIce = stage >= ICE_STAGE ? P_ICE : 0;
  let golds = 0;
  let springs = 0;
  let iceChains = 0;

  const rollFlags = (tile) => {
    if (springs < MAX_SPRING && rand() < pSpring) {
      tile.spring = true;
      springs++;
    } else if (golds < MAX_GOLD && rand() < pGold) {
      tile.golden = true;
      golds++;
    }
  };

  const sx = 2 + Math.floor(rand() * (GRID - 4));
  const sy = 2 + Math.floor(rand() * (GRID - 4));
  const tiles = [{ x: sx, y: sy, value: 0 }];
  rollFlags(tiles[0]);
  occ.add(key(sx, sy));
  let goal = null;
  let curIdx = 0;
  let guard = 0;

  while (!goal && guard++ < 200) {
    const cur = tiles[curIdx];
    const h1 = heights[cur.x][cur.y];
    const bonus = cur.spring ? SPRING_BONUS : 0;
    const isGoalMove = tiles.length >= n;

    // 通常の移動先候補
    const opts = [];
    for (const [dx, dy] of DIRS) {
      for (let d = 1; d <= 3 + SPRING_BONUS + MAX_HEIGHT; d++) {
        const nx = cur.x + dx * d;
        const ny = cur.y + dy * d;
        if (!inGrid(nx, ny)) continue;
        if (occ.has(key(nx, ny))) continue;
        const need = d + heights[nx][ny] - h1 - bonus;
        if (need < 1 || need > 3) continue;
        if (blockedPath(heights, cur.x, cur.y, nx, ny)) continue;
        opts.push({ nx, ny, need, dx, dy });
      }
    }
    if (opts.length === 0) return null;
    const o = opts[Math.floor(rand() * opts.length)];

    if (isGoalMove) {
      cur.value = o.need;
      goal = { x: o.nx, y: o.ny };
      break;
    }

    // 氷チェーン: 着地マスを氷にして、同方向の先に滑り先マスを置く
    let madeIce = false;
    if (iceChains < MAX_ICE_CHAINS && tiles.length + 2 <= n && rand() < pIce) {
      const exts = [];
      for (let e = 1; e <= 3; e++) {
        const fx = o.nx + o.dx * e;
        const fy = o.ny + o.dy * e;
        if (!inGrid(fx, fy)) break;
        if (occ.has(key(fx, fy))) break; // 間に既存マスがあると滑りが変わるので中止
        exts.push({ fx, fy });
      }
      if (exts.length) {
        const ext = exts[Math.floor(rand() * exts.length)];
        // 間のセルに将来マスを置かないよう占有しておく(滑走路の確保)
        for (let e = 1; ; e++) {
          const mx = o.nx + o.dx * e;
          const my = o.ny + o.dy * e;
          if (mx === ext.fx && my === ext.fy) break;
          occ.add(key(mx, my));
        }
        cur.value = o.need;
        const iceTile = { x: o.nx, y: o.ny, value: 1 + Math.floor(rand() * 3), ice: true };
        tiles.push(iceTile);
        occ.add(key(o.nx, o.ny));
        const landTile = { x: ext.fx, y: ext.fy, value: 0 };
        rollFlags(landTile);
        tiles.push(landTile);
        occ.add(key(ext.fx, ext.fy));
        curIdx = tiles.length - 1;
        iceChains++;
        madeIce = true;
      }
    }

    if (!madeIce) {
      cur.value = o.need;
      const t = { x: o.nx, y: o.ny, value: 0 };
      rollFlags(t);
      tiles.push(t);
      occ.add(key(o.nx, o.ny));
      curIdx = tiles.length - 1;
    }
  }
  if (!goal) return null;

  return { seed, stage, tiles, goal, heights, count: tiles.length };
}

// ---------- 最短手数(スピードボーナス用の近似BFS) ----------
// 「盤面がほぼ残っている」前提での最短ジャンプ数。実測との差は+1の猶予で吸収する。
export function computeMinMoves(level) {
  const n = level.tiles.length;
  const full = (1 << n) - 1;
  const visited = new Array(n).fill(false);
  let frontier = [0];
  visited[0] = true;
  for (let moves = 1; moves <= n + 1; moves++) {
    const next = [];
    for (const cur of frontier) {
      const curTile = level.tiles[cur];
      if (canJump(level, curTile, level.goal.x, level.goal.y)) return moves;
      for (let i = 0; i < n; i++) {
        if (visited[i]) continue;
        const t = level.tiles[i];
        if (!canJump(level, curTile, t.x, t.y)) continue;
        const { finalIdx } = resolveMoveM(level, full & ~(1 << cur), cur, i);
        if (!visited[finalIdx]) {
          visited[finalIdx] = true;
          next.push(finalIdx);
        }
      }
    }
    if (!next.length) return n + 1;
    frontier = next;
  }
  return n + 1;
}

// ---------- 到達判定 ----------
// cur から今狙えるマスの一覧(タップ対象)。ゴールは距離が合えばいつでも狙える。
export function reachableFrom(level, alive, curIdx) {
  const cur = level.tiles[curIdx];
  const res = [];
  for (let i = 0; i < level.tiles.length; i++) {
    if (!alive[i]) continue;
    const t = level.tiles[i];
    if (canJump(level, cur, t.x, t.y)) res.push(i);
  }
  if (canJump(level, cur, level.goal.x, level.goal.y)) res.push('goal');
  return res;
}

// ---------- ソルバー(ヒント用) ----------
// 1) ここから全マス回収してゴール(パーフェクト)がまだ可能ならその一手
// 2) 不可能なら、とにかくゴールへ着けるルートの一手
export function findSolution(level, alive, curIdx) {
  const n = level.tiles.length;
  let mask = 0;
  for (let i = 0; i < n; i++) if (alive[i]) mask |= 1 << i;

  const failedAll = new Set();
  const dfsAll = (cur, m) => {
    const memoKey = m * 32 + cur;
    if (failedAll.has(memoKey)) return null;
    const curTile = level.tiles[cur];
    if (m === 0) {
      if (canJump(level, curTile, level.goal.x, level.goal.y)) return ['goal'];
      failedAll.add(memoKey);
      return null;
    }
    for (let i = 0; i < n; i++) {
      if (!(m & (1 << i))) continue;
      const t = level.tiles[i];
      if (!canJump(level, curTile, t.x, t.y)) continue;
      const { finalIdx, eaten } = resolveMoveM(level, m, cur, i);
      let nm = m;
      for (const e of eaten) nm &= ~(1 << e);
      const rest = dfsAll(finalIdx, nm);
      if (rest) return [i, ...rest];
    }
    failedAll.add(memoKey);
    return null;
  };

  const perfect = dfsAll(curIdx, mask);
  if (perfect) return perfect;

  // フォールバック: ゴール到達だけを目指す
  const failedGoal = new Set();
  const dfsGoal = (cur, m) => {
    const memoKey = m * 32 + cur;
    if (failedGoal.has(memoKey)) return null;
    const curTile = level.tiles[cur];
    if (canJump(level, curTile, level.goal.x, level.goal.y)) return ['goal'];
    for (let i = 0; i < n; i++) {
      if (!(m & (1 << i))) continue;
      const t = level.tiles[i];
      if (!canJump(level, curTile, t.x, t.y)) continue;
      const { finalIdx, eaten } = resolveMoveM(level, m, cur, i);
      let nm = m;
      for (const e of eaten) nm &= ~(1 << e);
      const rest = dfsGoal(finalIdx, nm);
      if (rest) return [i, ...rest];
    }
    failedGoal.add(memoKey);
    return null;
  };
  return dfsGoal(curIdx, mask);
}
