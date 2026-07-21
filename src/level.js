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

// シードの範囲。ステージコード形式(8文字・28進)が表現できる上限まで使う。
// v = seed*1000 + stage < 28^7(=13,492,928,512) なので seed は最大 約1349万。
export const MIN_SEED = 1000;
export const MAX_SEED = 13000000; // 1300万(コード上限1349万の内側・キリの良い値)

export const SPRING_BONUS = 2; // ジャンプ台で伸びる距離
export const GOLD_MULT = 5; // 大ニンジンは1本で5本分(獲得 = 本数 × 5)

// ギミックの出現率・上限
const P_GOLD = 0.08;
const P_SPRING = 0.1;
const P_CART = 0.15;
const P_WHIRL = 0.12;
const MAX_GOLD = 2;
const MAX_SPRING = 3;
const MAX_CARTS = 3;
const MAX_WHIRL = 2;

// ---------- 季節 ----------
// 1季節=5ステージ: 春(1-5)→夏(6-10)→秋(11-15)→冬(16-20)。21面以降は全部入り。
// 各季節は単独ギミック(段差と金ニンジンは全季節)。
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const SEASON_LEN = 5;
const ALLIN_STAGE = SEASONS.length * SEASON_LEN + 1; // 21

export function seasonForStage(stage) {
  if (stage < ALLIN_STAGE) return SEASONS[Math.floor((stage - 1) / SEASON_LEN)];
  return 'allin';
}

// 背景の季節。チュートリアル4季節はその季節、21面以降は5面ごとにseedから擬似ランダム
// (日時ではなくseed由来なのでコードで再現できる=不正対策)。
export function backgroundSeasonForStage(seed, stage) {
  const s = seasonForStage(stage);
  if (s !== 'allin') return s;
  const block = Math.floor((stage - ALLIN_STAGE) / SEASON_LEN);
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
    allowWhirl: s === 'autumn' || s === 'allin',
    allowCart: s === 'winter' || s === 'allin',
    allowGold: true,
    sled: bg === 'winter',
    // その季節のポイントとなるギミックは毎ステージ最低1つ出す(生成で保証)
    requireSpring: s === 'summer',
    requireWhirl: s === 'autumn',
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
// チュートリアル各季節(5面)は最高の約半分でピーク。21面以降は1から段階的に最高へ。
// (急に難しくならないようにするため)
export function tileCountForStage(stage) {
  if (stage < ALLIN_STAGE) {
    const within = ((stage - 1) % SEASON_LEN) + 1; // 1..5
    return Math.min(7 + 2 * (within - 1), MAX_TILES); // 7,9,11,13,15(最高30の約半分)
  }
  // 全部入り(21面〜)は小さめから始めて緩やかに最大へ
  return Math.min(8 + (stage - ALLIN_STAGE), MAX_TILES); // 8 → 30(stage 30で30)
}

// 段差の上限。春は4面〜、夏以降はデフォルトで段差あり。各季節の頂点で最高の約半分。
export function heightCapForStage(stage) {
  const s = seasonForStage(stage);
  const within = ((stage - 1) % SEASON_LEN) + 1; // 1..5
  if (s === 'spring') return within >= 4 ? 1 : 0; // 春は4面〜
  if (s === 'summer') return 1; // 夏以降はデフォルトあり
  if (s === 'autumn') return within >= 3 ? 2 : 1;
  if (s === 'winter') return within >= 3 ? 2 : 1;
  // allin: 1 → 2 → 3 と段階的に上げる
  const k = stage - ALLIN_STAGE;
  if (k < 4) return 1;
  if (k < 10) return 2;
  return MAX_HEIGHT;
}

// ---------- ステージコード ----------
// (seed, stage) をアフィン変換で撹拌し、7文字 + チェックサム1文字＝計8文字(ハイフン無し)で表示。
// 「数字をいじって別ステージを名乗る」等のカジュアルな改竄をはじくための軽い難読化。
// アルファベットは見間違えやすい文字を除外: I/L/O/U(Crockford既定)に加え、数字と紛らわしい
// B(→8)/G(→6)/S(→5)/Z(→2) も除いた28文字。入力時はこれらを対応する数字へ読み替える。
// 表現域: 28^7 ≈ 134億。seed 最大 約1349万 × stage 999 まで格納できる。
// ※大きな数の乗算は Number の安全整数(2^53)を超えるため、変換は BigInt で行う。
const CODE_ALPH = '0123456789ACDEFHJKMNPQRTVWXY'; // 28文字
const CODE_BASE = BigInt(CODE_ALPH.length); // 28
const CODE_DIGITS = 7; // データ7文字(+チェックサム1文字)
const CODE_M = CODE_BASE ** BigInt(CODE_DIGITS); // 28^7
const CODE_A = 15485863n; // CODE_M(=2^14·7^7)と互いに素(奇数かつ7で割り切れない)
const CODE_B = 7654321n;
const CODE_A_INV = (() => {
  // 拡張ユークリッドで A^-1 mod M (BigInt)
  let [r0, r1] = [CODE_A, CODE_M];
  let [s0, s1] = [1n, 0n];
  while (r1 !== 0n) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  return ((s0 % CODE_M) + CODE_M) % CODE_M;
})();

function codeChecksum(data) {
  let c = 0;
  for (let i = 0; i < CODE_DIGITS; i++) {
    c = (c + CODE_ALPH.indexOf(data[i]) * (i + 3)) % CODE_ALPH.length;
  }
  return CODE_ALPH[c];
}

export function makeCode(seed, stage) {
  let e = (BigInt(seed * 1000 + stage) * CODE_A + CODE_B) % CODE_M;
  let s = '';
  for (let i = 0; i < CODE_DIGITS; i++) {
    s = CODE_ALPH[Number(e % CODE_BASE)] + s;
    e = e / CODE_BASE;
  }
  return s + codeChecksum(s); // 8文字・ハイフン無し
}

export function parseCode(str) {
  if (!str) return null;
  // 見間違えやすい文字を対応する数字へ読み替えてから判定(打ち間違い救済)
  let s = String(str)
    .toUpperCase()
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/S/g, '5')
    .replace(/Z/g, '2')
    .replace(/B/g, '8')
    .replace(/G/g, '6')
    .replace(/[^0-9A-Z]/g, '');
  if (s.length !== CODE_DIGITS + 1) return null;
  for (const ch of s) if (CODE_ALPH.indexOf(ch) < 0) return null;
  if (codeChecksum(s) !== s[CODE_DIGITS]) return null;
  let e = 0n;
  for (let i = 0; i < CODE_DIGITS; i++) e = e * CODE_BASE + BigInt(CODE_ALPH.indexOf(s[i]));
  const v = Number(((((e - CODE_B) % CODE_M) + CODE_M) % CODE_M) * CODE_A_INV % CODE_M);
  const seed = Math.floor(v / 1000);
  const stage = v % 1000;
  if (seed < MIN_SEED || seed > MAX_SEED || stage < 1 || stage > 999) return null;
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

// ---------- 着地の解決(トロッコ・つむじ風) ----------
// fromX,fromY からジャンプして targetIdx に着地したときのスタンスを返す。
// 通常マス: そのマスの上に立つ(power=マスのパワー)。
// トロッコ: 「乗ったときの進行方向」へ、同じ高さの空きマスを進み、段差/マス/端の手前で止まる(大破)。
//   降りた空きマスに立ち、次のジャンプ力 = トロッコの数字(value)。
// つむじ風: 対の落ち葉マス(pair)まで地形を無視して運ばれ、落ち葉マスに通常着地する。
//   つむじ風は使い切り(両方消費)。逆に落ち葉マスへ直接乗ると、対のつむじ風も消える。
// 返り値: { stance, eaten } eaten=この着地で消費するマスindex。
function landStanceM(level, mask, fromX, fromY, targetIdx) {
  const t = level.tiles[targetIdx];
  const h0 = level.heights[t.x][t.y];
  if (t.whirl) {
    // 対の落ち葉マスへ。落ち葉が生きている前提(落ち葉を先に食べるとつむじ風も消えるため、
    // つむじ風が mask にいる限り落ち葉も必ずいる)
    return {
      stance: stanceFromTile(level, t.pair),
      eaten: [targetIdx, t.pair],
    };
  }
  if (!t.cart) {
    const eaten = [targetIdx];
    // 落ち葉マスに直接乗った場合、対のつむじ風は飛び去って消える
    if (t.pairWhirl != null && (mask & (1 << t.pairWhirl))) eaten.push(t.pairWhirl);
    return { stance: stanceFromTile(level, targetIdx), eaten };
  }
  // 進行方向 = レール(生成時に「端/段差で必ず止まる」よう検証済みの向き)。
  // ※乗り込んだ向きにすると、想定外の向きから乗ったとき未検証の方向へ走って
  //   画面外やハマりの原因になるため、rail があればそれを優先する。
  const rx = t.rail ? t.rail[0] : Math.sign(t.x - fromX);
  const ry = t.rail ? t.rail[1] : Math.sign(t.y - fromY);
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
      // (人間の必須化・安全ルート保証は tryGenerate 側で担保)
      const okSpring = !prof.requireSpring || level.tiles.some((t) => t.spring);
      const okCart = !prof.requireCart || level.tiles.some((t) => t.cart);
      const okWhirl = !prof.requireWhirl || level.tiles.some((t) => t.whirl);
      if (okSpring && okCart && okWhirl) {
        level.season = seasonForStage(stage);
        level.background = backgroundSeasonForStage(seed, stage);
        level.minMoves = computeMinMoves(level);
        return level;
      }
    }
    if (attempt > 550 && n > 8) n--;
  }
  // 保険: 通常生成が全滅しても、平地・ギミック無しで必ず1つ作る(ゲームのフリーズ防止)
  for (let attempt = 0; attempt < 400; attempt++) {
    const heights = genTerrain(rand, 1, 0); // 平地
    const nn = Math.max(6, n - Math.floor(attempt / 50));
    const level = tryGenerate(rand, nn, seed, stage, heights, true);
    if (level) {
      level.season = seasonForStage(stage);
      level.background = backgroundSeasonForStage(seed, stage);
      level.minMoves = computeMinMoves(level);
      return level;
    }
  }
  throw new Error('stage generation failed');
}

function tryGenerate(rand, n, seed, stage, heights, relax = false) {
  const occ = new Set();
  const key = (x, y) => x * 16 + y;
  const inGrid = (x, y) => x >= 0 && y >= 0 && x < GRID && y < GRID;

  const prof = seasonProfile(seed, stage);
  // relax(保険生成)ではギミック・人間を一切入れず、素直に解ける平地ステージにする
  const pGold = relax ? 0 : prof.allowGold ? P_GOLD : 0;
  const pSpring = relax ? 0 : prof.allowSpring ? (prof.requireSpring ? 0.35 : P_SPRING) : 0;
  const pCart = relax ? 0 : prof.allowCart ? (prof.requireCart ? 0.4 : P_CART) : 0;
  const pWhirl = relax ? 0 : prof.allowWhirl ? (prof.requireWhirl ? 0.4 : P_WHIRL) : 0;
  let golds = 0;
  let springs = 0;
  let carts = 0;
  let whirls = 0;

  // 背の高いギミック(ジャンプ台・トロッコ・つむじ風)は隣り合うと立体表示で
  // 重なって見えるため、互いに1マス以上(周囲8マス)離す
  const nearTall = (x, y) =>
    tiles.some(
      (t) => (t.spring || t.cart || t.whirl) && Math.abs(t.x - x) <= 1 && Math.abs(t.y - y) <= 1
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
      // 2マス以上走って壁で止まる配置だけ採用(乗った瞬間に大破して効果が薄いのを防ぐ)
      const corridorOk = stoppedAtWall && corridor.length >= 2;
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

    // つむじ風: cur→つむじ風マスWに飛び乗る→対の落ち葉マスDへ運ばれる(地形無視)→Dから続行。
    // WとD(落ち葉。機能は普通のマス)をペアで同時に配置する。飛び先は生成時に確定。
    let madeWhirl = false;
    if (
      !madeCart &&
      whirls < MAX_WHIRL &&
      tiles.length + 2 <= n &&
      rand() < pWhirl &&
      !nearTall(o.nx, o.ny)
    ) {
      const wx = o.nx;
      const wy = o.ny;
      // 落ち葉マスDの候補: 空きセルで、近すぎず(2マス以上)・離れすぎず(6マス以内)。
      // 風で飛ぶので段差・向きの制約はなし。
      const dests = [];
      for (let x = 0; x < GRID; x++) {
        for (let y = 0; y < GRID; y++) {
          if (occ.has(key(x, y))) continue;
          const dist = Math.abs(x - wx) + Math.abs(y - wy);
          if (dist < 2 || dist > 6) continue;
          dests.push({ x, y });
        }
      }
      if (dests.length) {
        const d = dests[Math.floor(rand() * dests.length)];
        cur.value = o.need;
        const wt = { x: wx, y: wy, value: 0, whirl: true };
        tiles.push(wt);
        occ.add(key(wx, wy));
        const wIdx = tiles.length - 1;
        const leaf = { x: d.x, y: d.y, value: 0, leaf: true, pairWhirl: wIdx };
        rollFlags(leaf);
        tiles.push(leaf);
        occ.add(key(d.x, d.y));
        wt.pair = tiles.length - 1;
        curIdx = tiles.length - 1;
        whirls++;
        madeWhirl = true;
      }
    }

    if (!madeCart && !madeWhirl) {
      cur.value = o.need;
      const t = { x: o.nx, y: o.ny, value: 0 };
      rollFlags(t);
      tiles.push(t);
      occ.add(key(o.nx, o.ny));
      curIdx = tiles.length - 1;
    }
  }
  if (!goal) return null;

  // 段差は「畑のかたまり(bbox+1)の範囲」だけ残し、そこから離れた段差は平らにする。
  // 空の段差はOK(畑と同じ場所に段差があるのは自然)。畑と別の場所に段差だけ広がって
  // 一切使われない、という状態だけを防ぐ。トロッコの停止壁も残す(高さで止まるため)。
  // (平地ステージでは heights が全て0なので何も起きない)
  {
    let minX = GRID, maxX = 0, minY = GRID, maxY = 0;
    for (const t of tiles) {
      minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x);
      minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y);
    }
    minX = Math.min(minX, goal.x); maxX = Math.max(maxX, goal.x);
    minY = Math.min(minY, goal.y); maxY = Math.max(maxY, goal.y);
    const x0 = Math.max(0, minX - 1), x1 = Math.min(GRID - 1, maxX + 1);
    const y0 = Math.max(0, minY - 1), y1 = Math.min(GRID - 1, maxY + 1);
    const wall = new Set();
    for (const t of tiles) {
      if (!t.cart) continue;
      const [dx, dy] = t.rail;
      let x = t.x;
      let y = t.y;
      while (occ.has(key(x + dx, y + dy))) {
        x += dx;
        y += dy;
      }
      const wx = x + dx;
      const wy = y + dy;
      if (wx >= 0 && wy >= 0 && wx < GRID && wy < GRID) wall.add(key(wx, wy));
    }
    for (let x = 0; x < GRID; x++) {
      for (let y = 0; y < GRID; y++) {
        const inArea = x >= x0 && x <= x1 && y >= y0 && y <= y1;
        if (!inArea && !occ.has(key(x, y)) && !wall.has(key(x, y))) heights[x][y] = 0;
      }
    }
  }

  return { seed, stage, tiles, goal, heights, count: tiles.length };
}

// ---------- 最短手数(スピードボーナス用のBFS) ----------
export function computeMinMoves(level) {
  // つむじ風は landStanceM が対の落ち葉マスへ運ぶ(1手扱い)ので特別扱い不要
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

// ---------- ソルバー(デバッグのオートクリア用) ----------
// 1) ここから全マス回収してゴール(パーフェクト)がまだ可能ならその一手
// 2) 不可能なら、とにかくゴールへ着けるルートの一手
// つむじ風は landStanceM が対の落ち葉マスへ運ぶ(両方消費)ので特別扱い不要。
// 全マス消費 = ニンジン全回収(つむじ風は対の落ち葉とセットで必ず消えるため)。
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
