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
//  - トロッコ(cart+rail): 着地するとレールの向きの先のマスまで運ばれる(乗ったマスも食べる)
//  - 大ニンジン(golden): 食べると本数×5本分

import { mixSeed, mulberry32 } from './rng.js';

export const GRID = 9;
export const MAX_TILES = 30;
export const MAX_HEIGHT = 3; // 高さレベル0〜3(=段差3段)

export const SPRING_BONUS = 2; // ジャンプ台で伸びる距離
export const GOLD_MULT = 5; // 大ニンジンは1本で5本分(獲得 = 本数 × 5)

// ギミックの出現率・上限
const P_GOLD = 0.08;
const P_SPRING = 0.1;
const P_CART = 0.15;
const MAX_GOLD = 2;
const MAX_SPRING = 3;
const MAX_CARTS = 3;

// ---------- 季節 ----------
// 1季節=10ステージ: 春(1-10)→夏(11-20)→秋(21-30)→冬(31-40)。41面以降は全部入り。
// 各季節は単独ギミック(段差と金ニンジンは全季節)。
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

export function seasonForStage(stage) {
  if (stage <= 40) return SEASONS[Math.floor((stage - 1) / 10)];
  return 'allin';
}

// 背景の季節。チュートリアル4季節はその季節、41面以降は10面ごとにseedから擬似ランダム
// (日時ではなくseed由来なのでコードで再現できる=不正対策)。
export function backgroundSeasonForStage(seed, stage) {
  const s = seasonForStage(stage);
  if (s !== 'allin') return s;
  const block = Math.floor((stage - 41) / 10);
  const r = mulberry32(mixSeed(seed, 90210 + block))();
  return SEASONS[Math.floor(r * SEASONS.length)];
}

// その季節で許可するギミック。sledは背景が冬のときトロッコの見た目をソリにする。
export function seasonProfile(seed, stage) {
  const s = seasonForStage(stage);
  const bg = backgroundSeasonForStage(seed, stage);
  return {
    season: s,
    background: bg,
    allowSpring: s === 'summer' || s === 'allin',
    allowHuman: s === 'autumn' || s === 'allin',
    allowCart: s === 'winter' || s === 'allin',
    allowGold: true,
    sled: bg === 'winter',
    // その季節のポイントとなるギミックは毎ステージ最低1つ出す(生成で保証)
    requireSpring: s === 'summer',
    requireHuman: s === 'autumn', // 人間はフェーズ2で生成対応
    requireCart: s === 'winter',
  };
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// ---------- 難易度カーブ ----------
// 各季節で盤面サイズをリセット(季節頭は小さめ→季節内で増やす)。
// 新ギミックを小さい盤面で導入できるようにするため。
export function tileCountForStage(stage) {
  if (stage <= 40) {
    const within = ((stage - 1) % 10) + 1; // 1..10
    return Math.min(8 + 2 * (within - 1), MAX_TILES); // 8 → 26
  }
  // 全部入り(41面〜)は大きめを維持しつつ緩やかに最大へ
  return Math.min(24 + Math.floor((stage - 41) / 3), MAX_TILES);
}

// 段差の上限。全季節で段差ありだが、各季節の序盤は控えめにする(春は5面〜)。
export function heightCapForStage(stage) {
  const s = seasonForStage(stage);
  const within = ((stage - 1) % 10) + 1;
  if (s === 'spring') return within >= 5 ? 1 : 0;
  if (s === 'summer') return within >= 4 ? 2 : 1;
  if (s === 'autumn') return within >= 4 ? 2 : 1;
  if (s === 'winter') return within >= 4 ? 3 : 2;
  return MAX_HEIGHT; // allin
}

// ---------- ステージコード ----------
// (seed, stage) をアフィン変換で撹拌し、Crockford Base32 の5文字 + チェックサム1文字で表示。
// 「数字をいじって別ステージを名乗る」等のカジュアルな改竄をはじくための軽い難読化。
// (紛らわしい I, L, O, U はアルファベットから除外)
const CODE_ALPH = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_M = 1 << 25; // 2^25 > seed*1000+stage の最大値(9,999,999)
const CODE_A = 15485863; // 奇数なので 2^25 と互いに素
const CODE_B = 7654321;
const CODE_A_INV = (() => {
  // 拡張ユークリッドで A^-1 mod M
  let [r0, r1] = [CODE_A, CODE_M];
  let [s0, s1] = [1, 0];
  while (r1 !== 0) {
    const q = Math.floor(r0 / r1);
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  return ((s0 % CODE_M) + CODE_M) % CODE_M;
})();

function codeChecksum(s5) {
  let c = 0;
  for (let i = 0; i < 5; i++) {
    c = (c + CODE_ALPH.indexOf(s5[i]) * (i + 3)) % 32;
  }
  return CODE_ALPH[c];
}

export function makeCode(seed, stage) {
  const v = seed * 1000 + stage;
  let e = (v * CODE_A + CODE_B) % CODE_M;
  let s = '';
  for (let i = 0; i < 5; i++) {
    s = CODE_ALPH[e & 31] + s;
    e = Math.floor(e / 32);
  }
  s += codeChecksum(s);
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

export function parseCode(str) {
  if (!str) return null;
  let s = String(str)
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  if (s.length !== 6) return null;
  for (const ch of s) if (CODE_ALPH.indexOf(ch) < 0) return null;
  if (codeChecksum(s) !== s[5]) return null;
  let e = 0;
  for (let i = 0; i < 5; i++) e = e * 32 + CODE_ALPH.indexOf(s[i]);
  const v = ((((e - CODE_B) % CODE_M) + CODE_M) % CODE_M) * CODE_A_INV % CODE_M;
  const seed = Math.floor(v / 1000);
  const stage = v % 1000;
  if (seed < 1000 || seed > 9999 || stage < 1 || stage > 999) return null;
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

// ---------- スタンス(ウサギの立ち位置と次のジャンプ力) ----------
// { x, y, h(地形高さ), power(次のジャンプ力), id(メモ用キー) }
export function stanceFromTile(level, idx) {
  const t = level.tiles[idx];
  return {
    x: t.x,
    y: t.y,
    h: level.heights[t.x][t.y],
    power: tilePower(t),
    id: idx,
  };
}

// (x,y,h,power) から (tx,ty) へ飛べるか
function canJumpXY(level, x, y, h, power, tx, ty) {
  const dx = tx - x;
  const dy = ty - y;
  if (dx !== 0 && dy !== 0) return false;
  const d = Math.abs(dx) + Math.abs(dy);
  if (d === 0) return false;
  const need = d + level.heights[tx][ty] - h;
  if (need !== power) return false;
  return !blockedPath(level.heights, x, y, tx, ty);
}

function tileAt(level, mask, x, y) {
  for (let i = 0; i < level.tiles.length; i++) {
    if (!(mask & (1 << i))) continue;
    if (level.tiles[i].x === x && level.tiles[i].y === y) return i;
  }
  return -1;
}

// ---------- 着地の解決(トロッコ) ----------
// fromX,fromY からジャンプして targetIdx に着地したときのスタンスを返す。
// 通常マス: そのマスの上に立つ(power=マスのパワー)。
// トロッコ: 「乗ったときの進行方向」へ、同じ高さの空きマスを進み、段差/マス/端の手前で止まる(大破)。
//   降りた空きマスに立ち、次のジャンプ力 = トロッコの数字(value)。
// 返り値: { stance, eaten } eaten=消費するマスindex(トロッコ自身のみ)。
function landStanceM(level, mask, fromX, fromY, targetIdx) {
  const t = level.tiles[targetIdx];
  const h0 = level.heights[t.x][t.y];
  if (!t.cart) {
    return { stance: stanceFromTile(level, targetIdx), eaten: [targetIdx] };
  }
  // 進行方向 = 乗り込んだジャンプの向き
  const rx = Math.sign(t.x - fromX);
  const ry = Math.sign(t.y - fromY);
  const ahead = mask & ~(1 << targetIdx);
  let x = t.x;
  let y = t.y;
  let guard = 0;
  while (guard++ < GRID) {
    const nx = x + rx;
    const ny = y + ry;
    if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) break; // 端で止まる
    if (level.heights[nx][ny] !== h0) break; // 段差は越えない
    if (tileAt(level, ahead, nx, ny) !== -1) break; // 畑マスの手前で止まる
    x = nx;
    y = ny;
  }
  return {
    stance: { x, y, h: h0, power: t.value, id: 'e' + x + '_' + y + '_' + t.value },
    eaten: [targetIdx],
  };
}

// 配列版(ゲーム本体用): alive から mask を作って解決
export function landStance(level, alive, fromX, fromY, targetIdx) {
  let mask = 0;
  for (let i = 0; i < level.tiles.length; i++) if (alive[i]) mask |= 1 << i;
  return landStanceM(level, mask, fromX, fromY, targetIdx);
}

// ---------- 生成 ----------
export function generate(seed, stage) {
  const rand = mulberry32(mixSeed(seed, stage));
  let n = tileCountForStage(stage);
  const cap = heightCapForStage(stage);
  const prof = seasonProfile(seed, stage);

  for (let attempt = 0; attempt < 800; attempt++) {
    const heights = genTerrain(rand, stage, cap);
    const level = tryGenerate(rand, n, seed, stage, heights);
    if (level) {
      // その季節のポイントギミックが1つも無いステージは作り直す
      // (人間はフェーズ2で生成対応するまで保証しない)
      const okSpring = !prof.requireSpring || level.tiles.some((t) => t.spring);
      const okCart = !prof.requireCart || level.tiles.some((t) => t.cart);
      if (okSpring && okCart) {
        level.season = seasonForStage(stage);
        level.background = backgroundSeasonForStage(seed, stage);
        level.minMoves = computeMinMoves(level);
        return level;
      }
    }
    if (attempt > 550 && n > 8) n--;
  }
  throw new Error('stage generation failed');
}

function tryGenerate(rand, n, seed, stage, heights) {
  const occ = new Set();
  const key = (x, y) => x * 16 + y;
  const inGrid = (x, y) => x >= 0 && y >= 0 && x < GRID && y < GRID;

  const prof = seasonProfile(seed, stage);
  const pGold = prof.allowGold ? P_GOLD : 0;
  // その季節のポイントギミックは出現率を上げて、毎ステージ確実に出やすくする
  const pSpring = prof.allowSpring ? (prof.requireSpring ? 0.35 : P_SPRING) : 0;
  const pCart = prof.allowCart ? (prof.requireCart ? 0.4 : P_CART) : 0;
  let golds = 0;
  let springs = 0;
  let carts = 0;

  // 背の高いギミック(ジャンプ台・トロッコ)は隣り合うと立体表示で重なって見えるため、
  // 互いに1マス以上(周囲8マス)離す
  const nearTall = (x, y) =>
    tiles.some(
      (t) => (t.spring || t.cart) && Math.abs(t.x - x) <= 1 && Math.abs(t.y - y) <= 1
    );

  const rollFlags = (tile) => {
    if (springs < MAX_SPRING && rand() < pSpring) {
      if (!nearTall(tile.x, tile.y)) {
        tile.spring = true;
        springs++;
      }
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

    // トロッコ: cur→トロッコに飛び乗る→レール方向へ空きマスを進み段差/端で停止(大破)→
    // 停止セルSから「トロッコの数字」ぶんジャンプして次マスTへ。C・Tを同時に配置する。
    let madeCart = false;
    if (carts < MAX_CARTS && tiles.length + 2 <= n && rand() < pCart && !nearTall(o.nx, o.ny)) {
      const cx = o.nx;
      const cy = o.ny;
      const hc = heights[cx][cy];
      const hasTile = (x, y) => tiles.some((t) => t.x === x && t.y === y);
      // レール方向へ同高さの空きマスを1〜3マス進み、端/段差の壁で停止(=停止セルS)。
      // ・必ず1マス以上動く(動けない場所には作らない)
      // ・3マス以内に壁(端/段差)があるときだけ作る(遠くの端まで走って画面外に出るのを防ぐ)
      // ・途中に既存マス/予約セルがあると実行時とズレるので作らない
      // コリドーは予約して常に空に保ち、停止位置を状況に依らず固定する。
      const CART_MAX = 3;
      const corridor = [];
      let sxp = cx;
      let syp = cy;
      let stoppedAtWall = false;
      while (corridor.length < CART_MAX) {
        const nx2 = sxp + o.dx;
        const ny2 = syp + o.dy;
        if (!inGrid(nx2, ny2)) {
          stoppedAtWall = true;
          break;
        }
        if (heights[nx2][ny2] !== hc) {
          stoppedAtWall = true;
          break;
        }
        if (hasTile(nx2, ny2) || occ.has(key(nx2, ny2))) break;
        corridor.push(key(nx2, ny2));
        sxp = nx2;
        syp = ny2;
      }
      // 3マス進んでも壁が無い(=まだ空きが続く)場合、次のセルが壁か確認
      if (!stoppedAtWall && corridor.length === CART_MAX) {
        const nx2 = sxp + o.dx;
        const ny2 = syp + o.dy;
        if (!inGrid(nx2, ny2) || heights[nx2][ny2] !== hc) stoppedAtWall = true;
      }
      const corridorOk = stoppedAtWall && corridor.length >= 1;
      const corridorSet = new Set(corridor);
      // 停止セルSから、数字p(1〜3)で行ける次マスTの候補を集める(線路上は除外)
      const landOpts = [];
      for (const [dx, dy] of DIRS) {
        for (let d = 1; d <= 3 + MAX_HEIGHT; d++) {
          const tx = sxp + dx * d;
          const ty = syp + dy * d;
          if (!inGrid(tx, ty)) continue;
          // トロッコ自身のセル(cx,cy)はこの時点でまだocc/tilesに入っていないので明示的に除外
          // (大破後は空きマスになるため、そこへ着地するマスは置けない)
          if (tx === cx && ty === cy) continue;
          if (occ.has(key(tx, ty)) || corridorSet.has(key(tx, ty)) || hasTile(tx, ty)) continue;
          const p = d + heights[tx][ty] - hc;
          if (p < 1 || p > 3) continue;
          if (blockedPath(heights, sxp, syp, tx, ty)) continue;
          landOpts.push({ tx, ty, p });
        }
      }
      if (corridorOk && landOpts.length) {
        const lo = landOpts[Math.floor(rand() * landOpts.length)];
        cur.value = o.need;
        // 線路を占有して将来マスが割り込まないようにする(停止位置を固定)
        for (const c of corridor) occ.add(c);
        tiles.push({ x: cx, y: cy, value: lo.p, cart: true, rail: [o.dx, o.dy], sled: prof.sled });
        occ.add(key(cx, cy));
        const landTile = { x: lo.tx, y: lo.ty, value: 0 };
        rollFlags(landTile);
        tiles.push(landTile);
        occ.add(key(lo.tx, lo.ty));
        curIdx = tiles.length - 1;
        carts++;
        madeCart = true;
      }
    }

    if (!madeCart) {
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

// ---------- 最短手数(スピードボーナス用のBFS) ----------
export function computeMinMoves(level) {
  const n = level.tiles.length;
  const full = (1 << n) - 1;
  const start = stanceFromTile(level, 0);
  const seen = new Set();
  let frontier = [{ stance: start, mask: full & ~1 }];
  seen.add(start.id + '|' + (full & ~1));
  for (let moves = 1; moves <= n + 1; moves++) {
    const next = [];
    for (const st of frontier) {
      const s = st.stance;
      if (canJumpXY(level, s.x, s.y, s.h, s.power, level.goal.x, level.goal.y)) {
        return moves;
      }
      for (let i = 0; i < n; i++) {
        if (!(st.mask & (1 << i))) continue;
        const t = level.tiles[i];
        if (!canJumpXY(level, s.x, s.y, s.h, s.power, t.x, t.y)) continue;
        const { stance, eaten } = landStanceM(level, st.mask, s.x, s.y, i);
        let m2 = st.mask;
        for (const e of eaten) m2 &= ~(1 << e);
        const k = stance.id + '|' + m2;
        if (!seen.has(k)) {
          seen.add(k);
          next.push({ stance, mask: m2 });
        }
      }
    }
    if (!next.length) return n + 1;
    frontier = next;
  }
  return n + 1;
}

// ---------- 到達判定 ----------
// stance から今狙えるマスの一覧(タップ対象)。ゴールは距離が合えばいつでも狙える。
export function reachableFrom(level, alive, stance) {
  const res = [];
  for (let i = 0; i < level.tiles.length; i++) {
    if (!alive[i]) continue;
    const t = level.tiles[i];
    if (canJumpXY(level, stance.x, stance.y, stance.h, stance.power, t.x, t.y)) {
      res.push(i);
    }
  }
  if (canJumpXY(level, stance.x, stance.y, stance.h, stance.power, level.goal.x, level.goal.y)) {
    res.push('goal');
  }
  return res;
}

// ---------- ソルバー(ヒント用) ----------
// 1) ここから全マス回収してゴール(パーフェクト)がまだ可能ならその一手
// 2) 不可能なら、とにかくゴールへ着けるルートの一手
export function findSolution(level, alive, stance) {
  const n = level.tiles.length;
  let mask = 0;
  for (let i = 0; i < n; i++) if (alive[i]) mask |= 1 << i;

  const search = (needPerfect) => {
    const failed = new Set();
    const dfs = (s, m) => {
      const memoKey = s.id + '|' + m;
      if (failed.has(memoKey)) return null;
      if (!needPerfect || m === 0) {
        if (canJumpXY(level, s.x, s.y, s.h, s.power, level.goal.x, level.goal.y)) {
          return ['goal'];
        }
      }
      for (let i = 0; i < n; i++) {
        if (!(m & (1 << i))) continue;
        const t = level.tiles[i];
        if (!canJumpXY(level, s.x, s.y, s.h, s.power, t.x, t.y)) continue;
        const { stance: s2, eaten } = landStanceM(level, m, s.x, s.y, i);
        let nm = m;
        for (const e of eaten) nm &= ~(1 << e);
        const rest = dfs(s2, nm);
        if (rest) return [i, ...rest];
      }
      failed.add(memoKey);
      return null;
    };
    return dfs(stance, mask);
  };

  return search(true) || search(false);
}
