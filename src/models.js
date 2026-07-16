// ローポリ3Dモデルをコードで生成（外部アセット不要）
import * as THREE from 'three';
import { GRID } from './level.js';

// 段差1レベルぶんの高さ(ワールド単位)。低めにして奥のマスが隠れにくいようにする
export const HSTEP = 0.35;

const FLAT = { flatShading: true };

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.9,
    metalness: 0,
    ...FLAT,
    ...extra,
  });
}

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ---------- ウサギ ----------
export function makeRabbit() {
  const outer = new THREE.Group();
  const g = new THREE.Group();
  g.scale.setScalar(1.18);
  outer.add(g);
  const white = mat(0xfdf7ef);
  const pink = mat(0xffb3c1);

  const body = mesh(new THREE.SphereGeometry(0.3, 7, 6), white, 0, 0.3, -0.05);
  body.scale.set(1, 0.95, 1.15);
  g.add(body);

  const head = mesh(new THREE.SphereGeometry(0.22, 7, 6), white, 0, 0.62, 0.14);
  g.add(head);

  const ears = [];
  const feet = [];
  const arms = [];
  for (const s of [-1, 1]) {
    const ear = mesh(new THREE.SphereGeometry(0.085, 5, 4), white, s * 0.1, 0.98, 0.08);
    ear.scale.set(1, 3.1, 0.65);
    ear.rotation.z = s * -0.14;
    ear.rotation.x = -0.12;
    g.add(ear);
    const inner = mesh(new THREE.SphereGeometry(0.05, 5, 4), pink, s * 0.1, 0.99, 0.13);
    inner.scale.set(1, 3.4, 0.5);
    inner.rotation.z = s * -0.14;
    inner.rotation.x = -0.12;
    g.add(inner);
    ears.push({ mesh: ear, baseX: -0.12 }, { mesh: inner, baseX: -0.12 });

    const eye = mesh(
      new THREE.SphereGeometry(0.032, 6, 5),
      mat(0x2b2b2b, { roughness: 0.4 }),
      s * 0.09,
      0.67,
      0.33
    );
    g.add(eye);

    const foot = mesh(new THREE.SphereGeometry(0.1, 6, 5), white, s * 0.14, 0.07, 0.12);
    foot.scale.set(0.9, 0.5, 1.6);
    foot.userData.base = { y: 0.07, z: 0.12 };
    g.add(foot);
    feet.push(foot);

    const arm = mesh(new THREE.SphereGeometry(0.07, 5, 4), white, s * 0.2, 0.32, 0.16);
    arm.scale.set(0.8, 1.3, 0.8);
    arm.userData.base = { y: 0.32, z: 0.16 };
    g.add(arm);
    arms.push(arm);
  }

  const nose = mesh(new THREE.SphereGeometry(0.028, 5, 4), pink, 0, 0.6, 0.36);
  g.add(nose);

  const tail = mesh(new THREE.SphereGeometry(0.09, 6, 5), white, 0, 0.3, -0.36);
  g.add(tail);

  // 食事アニメ用のニンジン（普段は非表示）
  const snack = makeCarrot(0.55);
  snack.rotation.x = 1.2; // ほぼ水平にくわえる
  snack.position.set(0, 0.5, 0.36);
  snack.visible = false;
  g.add(snack);

  outer.userData.inner = g;
  outer.userData.ears = ears;
  outer.userData.feet = feet;
  outer.userData.arms = arms;
  outer.userData.snack = snack;
  return outer;
}

// ---------- ニンジン1本 ----------
export function makeCarrot(scale = 1, golden = false) {
  const g = new THREE.Group();
  const orange = golden
    ? mat(0xffd24a, { emissive: 0x8a6a00, emissiveIntensity: 0.45, roughness: 0.45 })
    : mat(0xff7a1c);
  // 本体を2段にしてニンジンらしいふくらみを出す
  const upper = mesh(new THREE.CylinderGeometry(0.16, 0.09, 0.26, 6), orange, 0, 0.42, 0);
  g.add(upper);
  const tip = mesh(new THREE.ConeGeometry(0.09, 0.32, 6), orange, 0, 0.13, 0);
  tip.rotation.x = Math.PI; // 先端を下に
  g.add(tip);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leaf = mesh(
      new THREE.ConeGeometry(0.07, 0.32, 5),
      mat(0x3dbf55),
      Math.sin(a) * 0.06,
      0.68,
      Math.cos(a) * 0.06
    );
    leaf.rotation.x = Math.sin(a) * 0.4;
    leaf.rotation.z = Math.cos(a) * 0.4;
    g.add(leaf);
  }
  g.scale.setScalar(scale);
  return g;
}

// ---------- 土のマス（ニンジン1〜3本つき） ----------
// カメラは (0.62, 1.5, 0.62) 方向から見下ろす。
// ROW_AXIS = 画面の横方向 / FWD_AXIS = 画面の手前(下)方向
const ROW_AXIS = { x: Math.SQRT1_2, z: -Math.SQRT1_2 };
const FWD_AXIS = { x: Math.SQRT1_2, z: Math.SQRT1_2 };

// ニンジンのサイズは本数によらず統一（2本用サイズ）
const CARROT_SCALE = 1.05;

// 本数ごとの配置 { r: 横方向, f: 手前方向 }。3本は▽置き（奥2本・手前1本）
const CARROT_LAYOUT = {
  1: [{ r: 0, f: 0 }],
  2: [
    { r: -0.19, f: 0 },
    { r: 0.19, f: 0 },
  ],
  3: [
    { r: -0.2, f: -0.11 },
    { r: 0.2, f: -0.11 },
    { r: 0, f: 0.16 },
  ],
};

// コイルバネ(ジャンプ台)。土台いっぱいの大きな螺旋+天板。金属光沢のシルバー。
export function makeSpring() {
  const g = new THREE.Group();
  // コイルは明るい光沢シルバー、上下の皿は一段濃いシルバー
  const coilMat = mat(0xe2e7ee, { roughness: 0.22, metalness: 0.75 });
  const plateMat = mat(0x9aa2ad, { roughness: 0.32, metalness: 0.7 });
  const baseY = 0.2;
  const h = 0.4;
  const r = 0.32; // 台座(半径0.4)いっぱい
  const coils = 4;
  const seg = 64;
  const pts = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const a = t * coils * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, baseY + t * h, Math.sin(a) * r));
  }
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, 0.065, 6, false),
    coilMat
  );
  tube.castShadow = true;
  g.add(tube);
  // 下皿・上の天板(黄色で台っぽく)
  g.add(mesh(new THREE.CylinderGeometry(r + 0.06, r + 0.08, 0.05, 12), plateMat, 0, baseY, 0));
  g.add(mesh(new THREE.CylinderGeometry(r + 0.05, r + 0.02, 0.06, 12), plateMat, 0, baseY + h, 0));
  return { group: g, topY: baseY + h + 0.04 };
}

// 作業用トロッコ(青メタルの木箱+スポーク車輪)。{ railGroup, cart, floorY } を返す。
// cart.userData.wheels を回転させて走行感を出す。向きは乗車時にrideCartで回す。
export function makeCart() {
  const railGroup = new THREE.Group();
  const cart = new THREE.Group();
  // 畑(茶)にも草(緑)にも埋もれない青系メタル
  const wood = mat(0x3f8fd0, { roughness: 0.45, metalness: 0.45 });
  const woodDark = mat(0x2f6ea8, { roughness: 0.5, metalness: 0.45 });
  const metal = mat(0xcfe4f2, { roughness: 0.3, metalness: 0.55 });
  const metalDark = mat(0x24506f, { roughness: 0.4, metalness: 0.5 });
  const W = 0.56, L = 0.6, H = 0.32, TH = 0.055;
  const floorY = 0.36;

  // 木の底+四方の壁(開いた箱)
  cart.add(mesh(new THREE.BoxGeometry(W, TH, L), woodDark, 0, floorY, 0));
  cart.add(mesh(new THREE.BoxGeometry(W, H, TH), wood, 0, floorY + H / 2, L / 2 - TH / 2));
  cart.add(mesh(new THREE.BoxGeometry(W, H, TH), wood, 0, floorY + H / 2, -L / 2 + TH / 2));
  cart.add(mesh(new THREE.BoxGeometry(TH, H, L), wood, W / 2 - TH / 2, floorY + H / 2, 0));
  cart.add(mesh(new THREE.BoxGeometry(TH, H, L), wood, -W / 2 + TH / 2, floorY + H / 2, 0));

  // 金属の上フチ(4辺)と四隅の柱
  const rimY = floorY + H;
  cart.add(mesh(new THREE.BoxGeometry(W + 0.05, 0.055, TH + 0.02), metal, 0, rimY, L / 2 - TH / 2));
  cart.add(mesh(new THREE.BoxGeometry(W + 0.05, 0.055, TH + 0.02), metal, 0, rimY, -L / 2 + TH / 2));
  cart.add(mesh(new THREE.BoxGeometry(TH + 0.02, 0.055, L + 0.05), metal, W / 2 - TH / 2, rimY, 0));
  cart.add(mesh(new THREE.BoxGeometry(TH + 0.02, 0.055, L + 0.05), metal, -W / 2 + TH / 2, rimY, 0));
  for (const cxs of [-1, 1]) {
    for (const czs of [-1, 1]) {
      cart.add(
        mesh(
          new THREE.BoxGeometry(0.07, H + 0.05, 0.07),
          metalDark,
          cxs * (W / 2 - 0.03),
          floorY + H / 2,
          czs * (L / 2 - 0.03)
        )
      );
    }
  }

  // スポーク車輪×4(グレー・ハブ+スポーク)
  const wheels = [];
  const wheelMat = mat(0x717681, { roughness: 0.4, metalness: 0.4 });
  const spokeMat = mat(0x8b909a, { roughness: 0.4, metalness: 0.4 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = new THREE.Group();
      const tire = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.045, 12), wheelMat);
      tire.rotation.z = Math.PI / 2;
      w.add(tire);
      const hub = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 8), metalDark);
      hub.rotation.z = Math.PI / 2;
      w.add(hub);
      for (let a = 0; a < 3; a++) {
        const spoke = mesh(new THREE.BoxGeometry(0.03, 0.22, 0.02), spokeMat);
        spoke.rotation.x = (a / 3) * Math.PI;
        w.add(spoke);
      }
      w.position.set(sx * (W / 2 + 0.02), 0.2, sz * (L / 2 - 0.12));
      wheels.push(w);
      cart.add(w);
    }
  }
  cart.userData.wheels = wheels;
  railGroup.add(cart);
  return { railGroup, cart, floorY };
}

// 冬のソリ(機能はトロッコと同じ)。赤い反り上がった刃+木のデッキ。
export function makeSled() {
  const railGroup = new THREE.Group();
  const cart = new THREE.Group();
  const wood = mat(0xba7b3e, { roughness: 0.7 });
  const woodDark = mat(0x8a5a2c, { roughness: 0.7 });
  const red = mat(0xe23b3b, { roughness: 0.4, metalness: 0.3 });
  const W = 0.56, L = 0.62, TH = 0.06;
  const floorY = 0.34;

  // デッキ(板を3枚並べる)
  for (let i = -1; i <= 1; i++) {
    cart.add(mesh(new THREE.BoxGeometry(W, TH, L * 0.28), i === 0 ? woodDark : wood, 0, floorY, i * L * 0.33));
  }
  // 前後の低い枠(後ろは少し高い背もたれ)
  cart.add(mesh(new THREE.BoxGeometry(W, 0.12, TH), wood, 0, floorY + 0.09, L / 2 - TH / 2));
  cart.add(mesh(new THREE.BoxGeometry(W, 0.2, TH), wood, 0, floorY + 0.13, -L / 2 + TH / 2));

  // 左右の赤い刃(前が反り上がる)+デッキとつなぐ支柱
  const runnerY = 0.14;
  for (const sx of [-1, 1]) {
    const runner = new THREE.Group();
    runner.add(mesh(new THREE.BoxGeometry(0.06, 0.05, L + 0.08), red, 0, runnerY, 0));
    const tip = mesh(new THREE.BoxGeometry(0.06, 0.05, 0.22), red, 0, runnerY + 0.07, (L + 0.08) / 2 + 0.03);
    tip.rotation.x = -0.7;
    runner.add(tip);
    for (const cz of [-0.22, 0.22]) {
      runner.add(mesh(new THREE.BoxGeometry(0.05, 0.22, 0.05), woodDark, 0, runnerY + 0.13, cz * L));
    }
    runner.position.x = sx * (W / 2 - 0.02);
    cart.add(runner);
  }
  cart.userData.wheels = []; // rideCartの車輪回転に合わせるため空配列
  railGroup.add(cart);
  return { railGroup, cart, floorY };
}

// ---------- つむじ風(whirl) マス ----------
// 半透明の輪を漏斗状に積み、scene3d の _frame で回して竜巻に見せる。
// 乗ると他マスへ飛ばされ、使い切りで消える(ニンジン・数字なし)。
export function makeWhirl() {
  const g = new THREE.Group();
  const spin = new THREE.Group();
  g.add(spin);
  const levels = 6;
  for (let i = 0; i < levels; i++) {
    const t = i / (levels - 1);
    const r = 0.12 + t * 0.32; // 上ほど広がる漏斗
    const tube = 0.035 + t * 0.028;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(r, tube, 6, 14),
      mat(0xdfeefc, { transparent: true, opacity: 0.6, roughness: 0.5, depthWrite: false })
    );
    ring.rotation.x = Math.PI / 2;
    ring.rotation.z = t * 1.8; // 少しずつねじる
    ring.position.y = 0.14 + t * 1.0;
    spin.add(ring);
  }
  g.userData.spin = spin;
  return g;
}

// 畑マスの土台（土の山＋上面）。ニンジンやジャンプ台はこの上に乗る。
export function makeMound() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.18, 7), mat(0x9c6b45), 0, 0.09, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.38, 0.41, 0.05, 7), mat(0xb98a5e), 0, 0.19, 0));
  return g;
}

// 落ち葉マスの土台（つむじ風の対＝飛ばされる先）。積もった落ち葉の山。
// 機能は畑マスと同じで、見た目だけ落ち葉モチーフ。
export function makeLeafBase() {
  const g = new THREE.Group();
  // 落ち葉の山(2段) — 秋色
  g.add(mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.14, 8), mat(0xc9722e), 0, 0.07, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.36, 0.43, 0.1, 8), mat(0xdd8f3a), 0, 0.17, 0));
  // 上に散った1枚1枚の葉(色違いの薄い板)
  const leafCols = [0xe8632a, 0xf2b13a, 0xc23a3a, 0xb9722a];
  const rand = mulberryLocal(4242);
  for (let i = 0; i < 8; i++) {
    const ang = rand() * Math.PI * 2;
    const r = rand() * 0.3;
    const leaf = mesh(
      new THREE.CircleGeometry(0.07 + rand() * 0.04, 5),
      new THREE.MeshStandardMaterial({
        color: leafCols[i % leafCols.length],
        flatShading: true,
        side: THREE.DoubleSide,
      }),
      Math.cos(ang) * r,
      0.225 + rand() * 0.01,
      Math.sin(ang) * r
    );
    leaf.rotation.x = -Math.PI / 2 + (rand() - 0.5) * 0.35;
    leaf.rotation.z = rand() * Math.PI;
    g.add(leaf);
  }
  return g;
}

export function makeTile(tile) {
  const g = new THREE.Group();
  const value = tile.value;

  // 落ち葉マス(つむじ風の対)は土台を落ち葉の山に差し替える(機能は同じ)
  g.add(tile.leaf ? makeLeafBase() : makeMound());

  // ジャンプ台: 土台の上に赤いコイルバネ+天板。ニンジンは天板の上に乗る
  let carrotLift = 0;
  if (tile.spring) {
    const spring = makeSpring();
    g.add(spring.group);
    carrotLift = spring.topY - 0.18; // ニンジンをバネの上へ持ち上げる
  }

  const carrots = new THREE.Group();
  for (const o of CARROT_LAYOUT[value] || CARROT_LAYOUT[1]) {
    const c = makeCarrot(CARROT_SCALE, !!tile.golden);
    c.position.set(
      ROW_AXIS.x * o.r + FWD_AXIS.x * o.f,
      0.18,
      ROW_AXIS.z * o.r + FWD_AXIS.z * o.f
    );
    carrots.add(c);
  }
  // 大ニンジンは名前どおり見た目も大きく（本数が多いほど控えめに拡大）
  if (tile.golden) {
    carrots.scale.setScalar(value === 1 ? 1.4 : value === 2 ? 1.25 : 1.15);
  }
  // 数字バッジと被らないよう、全体を画面の少し下(手前)へずらす
  carrots.position.set(FWD_AXIS.x * 0.1, carrotLift, FWD_AXIS.z * 0.1);

  // トロッコ/ソリのマス: 中にニンジンを積む。進む向きは乗車時にrideCartで回す。
  if (tile.cart) {
    const veh = tile.sled ? makeSled() : makeCart();
    carrots.position.set(0, veh.floorY + 0.04, 0);
    veh.cart.add(carrots);
    g.add(veh.railGroup);
    g.userData.cart = veh.cart;
    g.userData.railGroup = veh.railGroup;
  } else {
    g.add(carrots);
  }
  g.userData.carrots = carrots;

  return g;
}

// ---------- ゴールのウサギ（ピンク・小さめ・立ち耳。丸い体と白いおなかで差別化） ----------
export function makeGoalRabbit() {
  const outer = new THREE.Group();
  const g = new THREE.Group();
  g.scale.setScalar(0.92); // プレイヤー(1.18)より小さめ
  outer.add(g);

  const pink = mat(0xffaac4);
  const lightPink = mat(0xfff0f5);
  const deepPink = mat(0xff85ad);

  // まるっとした体
  const body = mesh(new THREE.SphereGeometry(0.3, 7, 6), pink, 0, 0.3, -0.02);
  body.scale.set(1, 1.0, 1.02);
  g.add(body);

  // 白いおなか
  const belly = mesh(new THREE.SphereGeometry(0.19, 6, 5), lightPink, 0, 0.27, 0.13);
  belly.scale.set(0.95, 1.05, 0.6);
  g.add(belly);

  // 頭（プレイヤーと同じく前上に）
  const head = mesh(new THREE.SphereGeometry(0.21, 7, 6), pink, 0, 0.63, 0.1);
  g.add(head);

  // 立ち耳（少し短めで外に開く）
  const ears = [];
  for (const s of [-1, 1]) {
    const ear = mesh(new THREE.SphereGeometry(0.08, 5, 4), pink, s * 0.12, 0.93, 0.05);
    ear.scale.set(1, 2.6, 0.6);
    ear.rotation.z = s * -0.32;
    ear.rotation.x = -0.1;
    ears.push({ mesh: ear, baseZ: s * -0.32 });
    g.add(ear);
    const inner = mesh(new THREE.SphereGeometry(0.048, 5, 4), lightPink, s * 0.135, 0.94, 0.09);
    inner.scale.set(1, 2.8, 0.45);
    inner.rotation.z = s * -0.32;
    inner.rotation.x = -0.1;
    ears.push({ mesh: inner, baseZ: s * -0.32 });
    g.add(inner);
  }

  for (const s of [-1, 1]) {
    const eye = mesh(
      new THREE.SphereGeometry(0.03, 6, 5),
      mat(0x2b2b2b, { roughness: 0.4 }),
      s * 0.085,
      0.67,
      0.28
    );
    g.add(eye);
    const foot = mesh(new THREE.SphereGeometry(0.09, 6, 5), pink, s * 0.13, 0.06, 0.1);
    foot.scale.set(0.9, 0.5, 1.5);
    g.add(foot);
    // ほっぺ
    const cheek = mesh(new THREE.SphereGeometry(0.035, 5, 4), deepPink, s * 0.13, 0.6, 0.25);
    cheek.scale.set(1, 0.7, 0.5);
    g.add(cheek);
  }

  const nose = mesh(new THREE.SphereGeometry(0.026, 5, 4), deepPink, 0, 0.62, 0.3);
  g.add(nose);
  const tail = mesh(new THREE.SphereGeometry(0.085, 6, 5), lightPink, 0, 0.28, -0.32);
  g.add(tail);

  outer.userData.inner = g;
  outer.userData.ears = ears;
  return outer;
}

// ---------- ゴール（ピンクウサギ＋花の台座＋旗） ----------
export function makeGoal() {
  const g = new THREE.Group();
  // クリーム色の台座（草・土と明確に違う色）
  const mound = mesh(
    new THREE.CylinderGeometry(0.42, 0.52, 0.2, 7),
    mat(0xffe9a8),
    0,
    0.1,
    0
  );
  g.add(mound);

  // ピンクの花びら（原作のハスの花モチーフ）
  const petalMat = mat(0xff9ec7);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const petal = mesh(
      new THREE.SphereGeometry(0.16, 6, 5),
      petalMat,
      Math.cos(a) * 0.42,
      0.16,
      Math.sin(a) * 0.42
    );
    petal.scale.set(1.15, 0.38, 0.72);
    petal.rotation.y = -a;
    g.add(petal);
  }

  // 赤い旗（カメラから見て右横に出して金ニンジンと重ならないように）
  const fx = 0.36;
  const fz = -0.36;
  const pole = mesh(
    new THREE.CylinderGeometry(0.022, 0.022, 1.05, 5),
    mat(0xd9d2c5),
    fx,
    0.62,
    fz
  );
  g.add(pole);
  const flagShape = new THREE.Shape();
  flagShape.moveTo(0, 0);
  flagShape.lineTo(0.38, -0.13);
  flagShape.lineTo(0, -0.26);
  flagShape.lineTo(0, 0);
  const flag = new THREE.Mesh(
    new THREE.ShapeGeometry(flagShape),
    new THREE.MeshStandardMaterial({
      color: 0xef4444,
      flatShading: true,
      side: THREE.DoubleSide,
    })
  );
  flag.position.set(fx, 1.12, fz);
  flag.rotation.y = Math.PI / 4;
  flag.castShadow = true;
  g.add(flag);
  g.userData.flag = flag;

  // ※常時明滅リングは「主人公と誤認しやすい」FBを受けて廃止。
  //   行けるようになった時だけ点滅リングが出る。

  // ピンクのウサギが待っている
  const bunny = makeGoalRabbit();
  bunny.position.y = 0.2;
  bunny.rotation.y = Math.PI / 4; // カメラの方を向く
  g.add(bunny);
  g.userData.bunny = bunny;
  return g;
}

// ---------- 段差地形（段々畑） ----------
// 高さレベルごとに色を一段ずつ変えて、パッと見で段数が分かるようにする。
// 季節ごとのパレット(top=高さ1..3の上面色 / side=側面色):
//  春=明るい黄緑(上るほど明るい)、夏=濃い緑(上るほど濃い)、
//  秋=茶色(上るほど濃い)、冬=雪(上るほど氷河の青が濃い。側面も雪色)
const TERRACE_PALETTES = {
  spring: { top: [0, 0x9ad35f, 0xbfe27f, 0xe2f0a2], side: 0x8a5a30 },
  summer: { top: [0, 0x4ea840, 0x3c9033, 0x2c7a27], side: 0x6f4f2a },
  autumn: { top: [0, 0xbd8a45, 0x9e6f34, 0x7d5526], side: 0x6b4526 },
  winter: { top: [0, 0xd6ebf8, 0xbfe0f4, 0x8fc7ec], side: 0xabcde2 },
};

export function makeTerrain(heights, season = 'spring') {
  const g = new THREE.Group();
  const c = (GRID - 1) / 2;
  const pal = TERRACE_PALETTES[season] || TERRACE_PALETTES.spring;
  const topPalette = pal.top;
  const sideMat = mat(pal.side);
  const gridVerts = [];
  for (let x = 0; x < GRID; x++) {
    for (let y = 0; y < GRID; y++) {
      const lvl = heights[x][y];
      if (!lvl) continue;
      const h = lvl * HSTEP;
      const topMat = mat(topPalette[Math.min(lvl, topPalette.length - 1)]);
      // 面ごとのマテリアル: [+x, -x, +y(上面), -y, +z, -z]
      const box = new THREE.Mesh(new THREE.BoxGeometry(1, h, 1), [
        sideMat,
        sideMat,
        topMat,
        sideMat,
        sideMat,
        sideMat,
      ]);
      box.position.set(x - c, h / 2, y - c);
      box.castShadow = true;
      box.receiveShadow = true;
      g.add(box);

      // 段の上面にもマス目の線を描く（平地のグリッドと同じ見た目）
      const gy = h + 0.012;
      const x0 = x - c - 0.5;
      const x1 = x - c + 0.5;
      const z0 = y - c - 0.5;
      const z1 = y - c + 0.5;
      gridVerts.push(
        x0, gy, z0, x1, gy, z0,
        x1, gy, z0, x1, gy, z1,
        x1, gy, z1, x0, gy, z1,
        x0, gy, z1, x0, gy, z0
      );
    }
  }
  if (gridVerts.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(gridVerts, 3));
    const lines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({
        color: 0x3f5e42, // 平地グリッドと同じ濃い色(冬でも見える)
        transparent: true,
        opacity: 0.3,
      })
    );
    g.add(lines);
  }
  return g;
}

// ---------- 季節ごとの背景色(プログラム生成のプレースホルダ。将来PNGに差し替え可) ----------
// sky=シーン背景 / fog=遠景フォグ / grass=島の草 / water=水面
export const SEASON_BG = {
  spring: { sky: 0xbfe9ff, fog: 0xd6f0ff, grass: 0x86cf5f, water: 0x6fc3e8 },
  summer: { sky: 0x8fd6ff, fog: 0xbfeaff, grass: 0x57b544, water: 0x2fb2e0 },
  autumn: { sky: 0xffe3b8, fog: 0xffdcb0, grass: 0xc79f4c, water: 0x66aecb },
  winter: { sky: 0xdff0ff, fog: 0xecf7ff, grass: 0xeaf3f8, water: 0xa9d6ea },
};

// 季節ごとの飾り(木・花・岩)の色味
const SEASON_DECO = {
  spring: { tree: 0x4d9e4f, trunk: 0x8a5a33, rock: 0xb9c2c9, flowers: [0xff9ec7, 0xffffff, 0xfff05e], snow: false },
  summer: { tree: 0x2f8f43, trunk: 0x7a4d2b, rock: 0xb9c2c9, flowers: [0xff5e7a, 0xffd23a, 0x59c3ff], snow: false },
  autumn: { tree: 0xd9702a, trunk: 0x6f4423, rock: 0xb0a48f, flowers: [0xe8632a, 0xf2b13a, 0xc23a3a], snow: false },
  winter: { tree: 0x3f7d54, trunk: 0x6f5638, rock: 0xd7e3ea, flowers: [0xffffff, 0xcfe8ff, 0xffd9e6], snow: true },
};

// ---------- 島と背景 ----------
export function makeIsland(gridSize, season = 'spring') {
  const g = new THREE.Group();
  const half = gridSize / 2;
  const bg = SEASON_BG[season] || SEASON_BG.spring;
  const deco = SEASON_DECO[season] || SEASON_DECO.spring;

  // 水面
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(26, 24),
    new THREE.MeshStandardMaterial({ color: bg.water, roughness: 1, flatShading: true })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.35;
  water.receiveShadow = true;
  g.add(water);

  // 草の島（ミニウサギが上端の外を歩けるよう広めに）
  const island = new THREE.Mesh(
    new THREE.CylinderGeometry(half + 3.5, half + 4.3, 0.5, 18),
    mat(bg.grass)
  );
  island.position.y = -0.25;
  island.receiveShadow = true;
  g.add(island);

  // まわりの飾り（木・花・岩）
  const treeGreen = mat(deco.tree);
  const trunk = mat(deco.trunk);
  const rockMat = mat(deco.rock);
  const snowMat = mat(0xffffff);
  const stemMat = mat(0x4d9e4f);
  const rand = mulberryLocal(12345);
  for (let i = 0; i < 26; i++) {
    const ang = rand() * Math.PI * 2;
    const r = half + 2.6 + rand() * 1.4;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    const kind = rand();
    if (kind < 0.3) {
      const t = new THREE.Group();
      const tr = mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.3, 5), trunk, 0, 0.15, 0);
      const lv = mesh(new THREE.ConeGeometry(0.32, 0.7, 6), treeGreen, 0, 0.7, 0);
      t.add(tr, lv);
      if (deco.snow) {
        // 冬は木のてっぺんに雪をのせる
        t.add(mesh(new THREE.ConeGeometry(0.2, 0.28, 6), snowMat, 0, 0.92, 0));
      }
      t.position.set(x, 0, z);
      t.scale.setScalar(0.7 + rand() * 0.9);
      g.add(t);
    } else if (kind < 0.5) {
      const rock = mesh(new THREE.DodecahedronGeometry(0.16, 0), rockMat, x, 0.06, z);
      rock.scale.set(1, 0.7, 1);
      rock.rotation.y = rand() * Math.PI;
      g.add(rock);
    } else {
      const f = new THREE.Group();
      const stem = mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.18, 4), stemMat, 0, 0.09, 0);
      const bloom = mesh(
        new THREE.SphereGeometry(0.05, 5, 4),
        mat(deco.flowers[Math.floor(rand() * deco.flowers.length)]),
        0,
        0.2,
        0
      );
      f.add(stem, bloom);
      f.position.set(x, 0, z);
      g.add(f);
    }
  }
  return g;
}

function mulberryLocal(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 数字バッジ（原作準拠の色分け: 1=青 2=ピンク 3=赤） ----------
const NUMBER_COLORS = { 1: '#3b6fe0', 2: '#e858b8', 3: '#e8483b' };

export function makeNumberSprite(value) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 96px "Arial Black", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 22;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText(String(value), 64, 70);
  ctx.fillStyle = NUMBER_COLORS[value] || '#3b6fe0';
  ctx.fillText(String(value), 64, 70);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, depthTest: false })
  );
  sprite.scale.setScalar(0.5);
  sprite.position.set(0, 1.15, 0);
  sprite.renderOrder = 10;
  return sprite;
}

// ---------- 点滅リング ----------
export function makeRing(color = 0xfff05e) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.62, 24),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  return ring;
}
