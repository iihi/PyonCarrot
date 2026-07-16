// Three.js シーン管理：ステージ描画、ジャンプ/沈むアニメーション、タップ判定
import * as THREE from 'three';
import {
  makeRabbit,
  makeGoalRabbit,
  makeTile,
  makeGoal,
  makeIsland,
  makeNumberSprite,
  makeRing,
  makeTerrain,
  makeWhirl,
  SEASON_BG,
  HSTEP,
} from './models.js';
import { GRID } from './level.js';

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class GameScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xbfe9ff, 26, 46);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);

    const amb = new THREE.HemisphereLight(0xffffff, 0xd9c9a8, 1.25);
    this.scene.add(amb);
    const sun = new THREE.DirectionalLight(0xfff4dd, 2.2);
    sun.position.set(7, 14, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 9;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.far = 40;
    this.scene.add(sun);

    this.world = new THREE.Group();
    this.scene.add(this.world);
    this._bgSeason = 'spring';
    this.island = makeIsland(GRID, 'spring');
    this.scene.add(this.island);

    // グリッド線（9x9全面）。白だと冬の雪原で見えないので、全季節で見える濃いめの色に
    this.grid = new THREE.GridHelper(GRID, GRID, 0x3f5e42, 0x3f5e42);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.3;
    this.grid.position.y = 0.01;
    this.scene.add(this.grid);
    const gh = GRID / 2;
    this.gridBounds = { x0: -gh, x1: gh, z0: -gh, z1: gh };

    this.rabbit = makeRabbit();
    this.rabbit.visible = false;
    this.scene.add(this.rabbit);

    this.tileMeshes = [];
    this.goalMesh = null;
    this.minis = []; // にぎやかしの極小ウサギ
    this.reachIds = []; // 今飛べるマス(明滅で示す)
    this.hintId = null; // ヒント対象(別色で明滅)
    this._activeHi = new Set(); // 前フレームで発光中だったマス(戻し用)
    this.tweens = [];
    this.clock = new THREE.Clock();
    this.time = 0;
    this.eatStart = -1; // 着地後の「食べる」演出の開始時刻(-1=なし)
    this.jumpPose = 0; // 飛行中の手足ポーズ(0=通常, 1=ぴょーん)
    this._fx = new Set(); // キラキラ等の一時エフェクト
    this.numbersVisible = false;
    this.camTarget = new THREE.Vector3();
    this.camPos = new THREE.Vector3(8, 12, 8);
    this.camGoal = { target: new THREE.Vector3(), pos: new THREE.Vector3(8, 12, 8) };

    this.raycaster = new THREE.Raycaster();
    this.onTileTap = null; // ゲーム側が設定するコールバック(idx | 'goal')

    canvas.addEventListener('pointerdown', (e) => this._pointer(e));
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  worldPos(gx, gy, y = 0) {
    const c = (GRID - 1) / 2;
    return new THREE.Vector3(gx - c, y, gy - c);
  }

  // マス(gx,gy)の地形の高さ(ワールドY)
  _cellY(gx, gy) {
    return this.level ? this.level.heights[gx][gy] * HSTEP : 0;
  }

  // マス(gx,gy)の上にウサギが立つ高さ
  _standY(gx, gy) {
    return 0.22 + this._cellY(gx, gy);
  }

  // 吹き出し等のHTML配置用: マス上のワールド座標を画面ピクセルに変換
  projectToScreen(gx, gy, yOffset = 0) {
    const v = this.worldPos(gx, gy, this._cellY(gx, gy) + yOffset);
    v.project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * this.canvas.clientWidth,
      y: (-v.y * 0.5 + 0.5) * this.canvas.clientHeight,
    };
  }

  resize() {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.level) this._fitCamera(true);
  }

  // 季節ごとに背景(島の草・水・空・フォグ)を切り替える。将来PNG背景に差し替え予定。
  _applyBackground(season) {
    if (season === this._bgSeason) return;
    this._bgSeason = season;
    const bg = SEASON_BG[season] || SEASON_BG.spring;
    if (this.island) {
      this.scene.remove(this.island);
      this.island.traverse((c) => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) {
          (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => m.dispose());
        }
      });
    }
    this.island = makeIsland(GRID, season);
    this.scene.add(this.island);
    this.scene.background = new THREE.Color(bg.sky);
    this.scene.fog.color.setHex(bg.fog);
  }

  // ---------- ステージ構築 ----------
  buildStage(level) {
    this.level = level;
    this._applyBackground(level.background || level.season || 'spring');
    this.goalCollected = false;
    this.eatStart = -1;
    this.setRabbitNumber(null);
    for (const t of this.tileMeshes) this.world.remove(t.group);
    if (this.goalMesh) this.world.remove(this.goalMesh);
    this.clearRings();
    this.clearHint();
    this.tweens = [];
    // 前ステージの残エフェクトを掃除（tween中断でdoneが呼ばれないため）
    for (const m of [...this._fx]) this._removeFx(m);
    this.tileMeshes = [];

    // 段差地形（段々畑）
    if (this.terrain) {
      this.scene.remove(this.terrain);
      this.terrain.traverse((c) => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) {
          (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) =>
            m.dispose()
          );
        }
      });
    }
    this.terrain = makeTerrain(level.heights, level.background || level.season || 'spring');
    this.scene.add(this.terrain);

    this.onSpring = false;
    level.tiles.forEach((t, i) => {
      const group = t.whirl ? makeWhirl() : makeTile(t);
      const baseY = this._cellY(t.x, t.y);
      group.position.copy(this.worldPos(t.x, t.y, baseY));
      // つむじ風マスは数字・ニンジンなし
      const number = t.whirl ? null : makeNumberSprite(t.value);
      if (number) {
        number.visible = this.numbersVisible;
        group.add(number);
      }
      this.world.add(group);
      this.tileMeshes.push({
        group,
        number,
        baseY,
        idx: i,
        alive: true,
        spring: !!t.spring,
        whirl: !!t.whirl,
      });

      // 登場アニメーション
      group.position.y = baseY - 1.2;
      group.scale.setScalar(0.3);
      this.tween(0.45, i * 0.03, easeOut, (k) => {
        group.position.y = baseY - 1.2 * (1 - k);
        group.scale.setScalar(0.3 + 0.7 * k);
      });
    });

    this.goalMesh = makeGoal();
    this.goalMesh.position.copy(
      this.worldPos(level.goal.x, level.goal.y, this._cellY(level.goal.x, level.goal.y))
    );
    this.world.add(this.goalMesh);
    this.goalMesh.scale.setScalar(0.01);
    this.tween(0.5, level.tiles.length * 0.03, easeOut, (k) => {
      this.goalMesh.scale.setScalar(Math.max(k, 0.01));
    });

    // ハイライト用に各マス・ゴールの元の発光を控えておく
    const grabEmissive = (group) => {
      const arr = [];
      group.traverse((o) => {
        if (!o.material) return;
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) if (m.emissive) arr.push({ m, e: m.emissive.getHex(), i: m.emissiveIntensity });
      });
      return arr;
    };
    for (const tm of this.tileMeshes) tm.origMats = grabEmissive(tm.group);
    this.goalOrigMats = grabEmissive(this.goalMesh);
    this._activeHi = new Set();

    // ウサギは登場シーン(playEntrance)まで隠しておく
    // (スタートマスのニンジンは登場後にウサギが食べる)
    const start = level.tiles[0];
    this.rabbit.visible = false;
    this.rabbit.position.copy(
      this.worldPos(start.x, start.y, this._standY(start.x, start.y))
    );
    this.rabbit.rotation.set(0, Math.PI / 4, 0);
    this.rabbit.scale.setScalar(1);

    this._fitCamera(false);
    this._buildMinis(level);
  }

  // キラキラの粒子を弾けさせる
  _sparkleBurst(pos, n = 14) {
    const colors = [0xfff59e, 0xffffff, 0xffd24a, 0xaee9ff];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.05 + Math.random() * 0.05, 0),
        new THREE.MeshBasicMaterial({
          color: colors[i % colors.length],
          transparent: true,
        })
      );
      m.position.copy(pos);
      this.scene.add(m);
      this._fx.add(m);
      const ang = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      const vx = Math.cos(ang) * (0.7 + Math.random() * 0.7);
      const vz = Math.sin(ang) * (0.7 + Math.random() * 0.7);
      const vy = 1.4 + Math.random() * 1.2;
      this.tween(0.55 + Math.random() * 0.25, Math.random() * 0.1, (t) => t, (k) => {
        m.position.set(pos.x + vx * k, pos.y + vy * k - 2.4 * k * k, pos.z + vz * k);
        m.rotation.x += 0.2;
        m.rotation.y += 0.27;
        m.material.opacity = 1 - k;
        m.scale.setScalar(1 - 0.6 * k);
      }, () => this._removeFx(m));
    }
  }

  _removeFx(m) {
    this.scene.remove(m);
    m.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
    this._fx.delete(m);
  }

  // 白ウサギの登場シーン:
  // スタートマス手前の地面にワープゾーン(光る円盤)が開き、
  // ウサギがせり上がって現れ、ジャンプでスタートマスへ移動する
  playEntrance() {
    return new Promise((resolve) => {
      const start = this.level.tiles[0];
      const goalP = this.worldPos(start.x, start.y, this._standY(start.x, start.y));
      const fwd = { x: Math.SQRT1_2, z: Math.SQRT1_2 }; // 画面の手前方向
      const side = { x: Math.SQRT1_2, z: -Math.SQRT1_2 }; // 画面の横方向

      // ポータル周辺のマスが平地(高さ0)かどうか
      const c0 = (GRID - 1) / 2;
      const flatAround = (wx, wz) => {
        for (let gx = Math.floor(wx + c0 - 0.55); gx <= Math.ceil(wx + c0 + 0.55); gx++) {
          for (let gz = Math.floor(wz + c0 - 0.55); gz <= Math.ceil(wz + c0 + 0.55); gz++) {
            if (gx < 0 || gz < 0 || gx >= GRID || gz >= GRID) continue;
            if (this.level.heights[gx][gz] > 0) return false;
          }
        }
        return true;
      };

      // ポータル位置: 基本は画面の真下。他のマスと重なる場合は
      // 右下→左下→さらに下…の順で空いている草地を探す
      const others = [...this.level.tiles.slice(1), this.level.goal].map((t) =>
        this.worldPos(t.x, t.y)
      );
      const candidates = [];
      for (const f of [1.5, 2.0, 2.5, 3.0]) {
        for (const sd of [0, 0.8, -0.8, 1.6, -1.6, 2.4, -2.4]) {
          candidates.push([f, sd]);
        }
      }
      let pp = null;
      let bestPp = null;
      let bestClearance = -1;
      for (const [f, sd] of candidates) {
        const c = new THREE.Vector3(
          goalP.x + fwd.x * f + side.x * sd,
          0,
          goalP.z + fwd.z * f + side.z * sd
        );
        if (Math.hypot(c.x, c.z) > 7.2) continue; // 島から出ない
        if (!flatAround(c.x, c.z)) continue; // 段差地形の上にはポータルを出さない
        let clearance = Infinity;
        for (const o of others) {
          clearance = Math.min(clearance, Math.hypot(o.x - c.x, o.z - c.z));
        }
        if (clearance >= 1.05) {
          pp = c; // 手前寄りの候補から順に見ているので最初の合格を採用
          break;
        }
        if (clearance > bestClearance) {
          bestClearance = clearance;
          bestPp = c;
        }
      }
      if (!pp) pp = bestPp || new THREE.Vector3(goalP.x + fwd.x * 1.5, 0, goalP.z + fwd.z * 1.5);
      this.killTweens('rabbit');

      // ワープゾーン（水色の光る円盤＋リング）
      const portal = new THREE.Group();
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(0.55, 24),
        new THREE.MeshBasicMaterial({
          color: 0x7fe4ff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        })
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.02;
      const rim = makeRing(0xaef4ff);
      rim.position.y = 0.03;
      portal.add(disc, rim);
      portal.position.copy(pp);
      portal.scale.setScalar(0.2);
      this.scene.add(portal);
      this._fx.add(portal);

      // ポータルが開く
      this.tween(0.3, 0, easeOut, (k) => {
        portal.scale.setScalar(0.2 + 0.8 * k);
        disc.material.opacity = 0.55 * k;
        rim.material.opacity = 0.9 * k;
      });
      this._sparkleBurst(new THREE.Vector3(pp.x, 0.25, pp.z));

      // ウサギが手前(カメラ側)を向いたまま、ゆっくり下からせり上がって現れる
      const camFace = Math.PI / 4;
      const face = Math.atan2(goalP.x - pp.x, goalP.z - pp.z);
      this.rabbit.rotation.set(0, camFace, 0);
      this.rabbit.scale.setScalar(1);
      this.rabbit.position.set(pp.x, -0.65, pp.z);
      this.tween(0.7, 0.25, easeOut, (k) => {
        this.rabbit.visible = true;
        this.rabbit.position.y = -0.65 + 0.71 * k; // 地面(0.06)まで
      }, null, 'rabbit');

      // くるっとスタートマスの方へ向き直る
      this.tween(0.18, 1.02, easeOut, (k) => {
        this.rabbit.rotation.y =
          camFace + Math.atan2(Math.sin(face - camFace), Math.cos(face - camFace)) * k;
      }, null, 'rabbit');

      // 通常の移動と同じ「ぴょーん」でスタートマスへ（高台スタートにも対応）
      const entryArc = 0.7 + Math.max(0, goalP.y - 0.22) * 0.9;
      this.tween(0.38, 1.25, (t) => t, (k) => {
        this.rabbit.position.lerpVectors(
          new THREE.Vector3(pp.x, 0.06, pp.z),
          goalP,
          k
        );
        this.rabbit.position.y =
          0.06 + (goalP.y - 0.06) * k + entryArc * 4 * k * (1 - k);
        const e = Math.sin(k * Math.PI);
        this.rabbit.scale.set(1 - 0.06 * e, 1 - 0.09 * e, 1 + 0.2 * e);
        this.rabbit.rotation.x = 0.6 * e * (k - 0.5);
        this._applyJumpPose(e);
      }, () => {
        this.rabbit.rotation.x = 0;
        this._applyJumpPose(0);
      }, 'rabbit');

      // ジャンプと同時にポータルは閉じる
      this.tween(0.3, 1.3, easeOut, (k) => {
        portal.scale.setScalar(1 - 0.99 * k);
        disc.material.opacity = 0.55 * (1 - k);
        rim.material.opacity = 0.9 * (1 - k);
      }, () => this._removeFx(portal));

      // 着地スクワッシュ→カメラの方へ向き直って完了
      const turnTo = Math.PI / 4;
      this.tween(0.3, 1.65, easeOut, (k) => {
        const sy = 0.75 + 0.25 * k;
        this.rabbit.scale.set(1 + 0.15 * (1 - k), sy, 1 + 0.15 * (1 - k));
        this.rabbit.rotation.y =
          face + Math.atan2(Math.sin(turnTo - face), Math.cos(turnTo - face)) * k;
      }, () => {
        this.rabbit.scale.setScalar(1);
        this.rabbit.position.copy(goalP);
        this.rabbit.rotation.y = turnTo;
        resolve();
      }, 'rabbit');
    });
  }

  // 10ステージごとに1匹増える極小ウサギ（最大10匹）。
  // マス群の上方(画面奥)の帯を、画面に収まる範囲でゆっくり行き来する。
  _buildMinis(level) {
    for (const m of this.minis) this.scene.remove(m.g);
    this.minis = [];
    const count = Math.min(Math.floor(level.stage / 10), 10);
    if (!count) return;

    const top = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 }; // 画面の上方向
    const side = { x: Math.SQRT1_2, z: -Math.SQRT1_2 }; // 画面の横方向
    const c = this.fitCenter;

    // グリッド(9x9全面)の画面上端コーナーより必ず外側に帯を置く（マスの中に入らない）
    const gb = this.gridBounds;
    const cornerT = (gb.x0 - c.x) * top.x + (gb.z0 - c.z) * top.z;
    const bandDist = cornerT + 0.9;

    // 横の間隔も画面幅に収まるよう調整
    const spacing = Math.min(
      0.95,
      (2 * Math.max(this.viewHalfW - 1.0, 0.6)) / Math.max(count - 1, 1)
    );

    for (let i = 0; i < count; i++) {
      const g = i % 3 === 1 ? makeGoalRabbit() : makeRabbit();
      g.scale.setScalar(0.3); // 凄く小さく
      this.scene.add(g);
      const spread = (i - (count - 1) / 2) * spacing;
      const bd = bandDist + (i % 2) * 0.45; // 前後にも少し散らす(外側へ)
      let x = c.x + top.x * bd + side.x * spread;
      let z = c.z + top.z * bd + side.z * spread;
      // 島から落ちない
      const r = Math.hypot(x, z);
      if (r > 7.3) {
        x *= 7.3 / r;
        z *= 7.3 / r;
      }
      this.minis.push({
        g,
        anchor: { x, z },
        phase: i * 1.9 + 0.7,
        speed: 0.22 + (i % 3) * 0.07,
        range: 0.4 + (i % 2) * 0.25,
      });
    }
  }

  _fitCamera(instant) {
    const pts = [
      ...this.level.tiles.map((t) => this.worldPos(t.x, t.y)),
      this.worldPos(this.level.goal.x, this.level.goal.y),
    ];
    // トロッコ/ソリはレール方向へ運ばれる。停止セルが空きマスでタイル範囲の外だと
    // 乗ったときにウサギが画面外に出てしまうので、停止セルも画面に含める。
    const hd = this.level.heights;
    for (const t of this.level.tiles) {
      if (!t.cart || !t.rail || !hd) continue;
      const [rx, ry] = t.rail;
      const h0 = hd[t.x][t.y];
      let x = t.x;
      let y = t.y;
      let guard = 0;
      while (guard++ < GRID) {
        const nx = x + rx;
        const ny = y + ry;
        if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) break;
        if (hd[nx][ny] !== h0) break;
        if (this.level.tiles.some((o) => o !== t && o.x === nx && o.y === ny)) break;
        x = nx;
        y = ny;
      }
      pts.push(this.worldPos(x, y));
    }
    const box = new THREE.Box3();
    pts.forEach((p) => box.expandByPoint(p));
    const center = box.getCenter(new THREE.Vector3());

    // 画面の横方向/縦方向それぞれに必要な広さを測ってギリギリまで寄る
    let maxS = 0;
    let maxT = 0;
    for (const p of pts) {
      const dx = p.x - center.x;
      const dz = p.z - center.z;
      maxS = Math.max(maxS, Math.abs(dx * Math.SQRT1_2 - dz * Math.SQRT1_2));
      maxT = Math.max(maxT, Math.abs(-dx * Math.SQRT1_2 - dz * Math.SQRT1_2));
    }

    const vFov = (this.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    // 横: マス+リング分の余白 / 縦: 見下ろしで縮む(≈0.87)+HUDと被らないよう縦視野は74%だけ使う
    // 下限(3.2)を設けて、マスが少ないステージで寄りすぎないようにする
    // 段差がある場合は高さぶんの余白も足す
    let maxHLvl = 0;
    if (this.level.heights) {
      for (let x = 0; x < GRID; x++) {
        for (let y = 0; y < GRID; y++) {
          maxHLvl = Math.max(maxHLvl, this.level.heights[x][y]);
        }
      }
    }
    const hPad = maxHLvl * HSTEP * 0.6;
    const halfW = Math.max(maxS + 1.15, 3.2);
    const halfH = Math.max(maxT * 0.87 + 1.15 + hPad, 2.7);
    const dist = Math.max(
      halfW / Math.tan(hFov / 2),
      halfH / (Math.tan(vFov / 2) * 0.74)
    );

    const dir = new THREE.Vector3(0.62, 1.5, 0.62).normalize();
    this.camGoal.target.copy(center);
    this.camGoal.pos.copy(center).addScaledVector(dir, dist);
    this.fitCenter = center.clone();
    // ミニウサギ配置用: 画面に写る範囲(ワールド換算・概算)
    this.viewHalfW = dist * Math.tan(hFov / 2);
    this.viewHalfTop = (dist * Math.tan(vFov / 2) * 0.74) / 0.87;
    // フォグはカメラ距離に追従させて手前が白くならないようにする
    this.scene.fog.near = dist + 6;
    this.scene.fog.far = dist + 34;
    if (instant) {
      this.camTarget.copy(this.camGoal.target);
      this.camPos.copy(this.camGoal.pos);
    }
  }

  // ---------- ハイライト ----------
  // マスの発光は _frame でまとめて設定する(役割の優先: 危険 > ヒント > ゴール > 移動)。
  // 到達マス=明滅、危険マス(人間の視線)=赤く常時。id リストだけ持つ。
  clearRings() {
    this.reachIds = [];
    this.hintId = null;
  }

  setReachable(list) {
    this.reachIds = list.slice();
  }

  showHint(target) {
    this.hintId = target;
  }

  clearHint() {
    this.hintId = null;
  }

  // ---------- つむじ風 ----------
  // つむじ風が画面外へ飛び去る(共通処理)。盤面中心から離れる向きへ上昇しつつ消える。
  _whirlExit(whirlIdx, delay = 0) {
    const wt = this.tileMeshes[whirlIdx];
    if (!wt || !wt.group.visible) return;
    const g = wt.group;
    const spin = g.userData.spin;
    const p0 = g.position.clone();
    const center = this.fitCenter || new THREE.Vector3();
    let dx = p0.x - center.x;
    let dz = p0.z - center.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const dist = (this.viewHalfW || 8) + 5; // 確実に画面外まで
    this.killTweens('tile' + whirlIdx);
    this.tween(1.0, delay, (t) => t, (k) => {
      g.position.set(p0.x + dx * dist * k, p0.y + 1.6 * k, p0.z + dz * dist * k);
      if (spin) spin.rotation.y += 0.35; // 飛び去りながら勢いよく回る
      const fade = Math.max(0, 1 - k * 1.15);
      g.traverse((o) => {
        if (!o.material) return;
        const m = o.material;
        // 初回に元の不透明度を控えて、リングも中の葉もまとめてフェード
        if (m.userData.baseOp === undefined) {
          m.userData.baseOp = m.transparent ? m.opacity : 1;
          m.transparent = true;
        }
        m.opacity = m.userData.baseOp * fade;
      });
    }, () => {
      wt.alive = false;
      g.visible = false;
    }, 'tile' + whirlIdx);
  }

  // つむじ風マス(whirlIdx)に乗ったウサギを、風が包んだまま対の落ち葉マス(leafIdx)へ運ぶ。
  // うさぎを落とすと風はそのまま画面外へ飛び去る。
  whirlCarry(whirlIdx, leafIdx) {
    return new Promise((resolve) => {
      const wt = this.tileMeshes[whirlIdx];
      const dest = this.level.tiles[leafIdx];
      const p0 = this.rabbit.position.clone();
      const p1 = this.worldPos(dest.x, dest.y, this._standY(dest.x, dest.y));
      const baseRotY = this.rabbit.rotation.y;
      const g = wt ? wt.group : null;
      const spin = g ? g.userData.spin : null;
      const gp0 = g ? g.position.clone() : null;
      this.killTweens('rabbit');
      if (g) this.killTweens('tile' + whirlIdx);

      // 風がうさぎを包んだまま一緒に弧を描いて移動。うさぎは中でグルグル回る
      this.tween(0.95, 0, easeInOut, (k) => {
        this.rabbit.position.lerpVectors(p0, p1, k);
        this.rabbit.position.y = p0.y + (p1.y - p0.y) * k + 1.0 * Math.sin(k * Math.PI);
        this.rabbit.rotation.y = baseRotY + k * Math.PI * 6;
        const s = 1 - 0.18 * Math.sin(k * Math.PI);
        this.rabbit.scale.set(s, s, s);
        if (g) {
          // 風はうさぎにまとわりつく(足元より少し下から包む)
          g.position.set(this.rabbit.position.x, this.rabbit.position.y - 0.3, this.rabbit.position.z);
          if (spin) spin.rotation.y += 0.3;
        }
      }, () => {
        this.rabbit.position.copy(p1);
        this.rabbit.rotation.y = Math.PI / 4;
        this.rabbit.scale.setScalar(1);
        // うさぎを落とすと、落ち葉が舞い散ってマスが元の畑に戻り、
        // 風はそのまま画面外へ飛び去る(どちらも待たない)
        this._blowLeaves(leafIdx);
        this._whirlExit(whirlIdx);
        resolve();
      }, 'rabbit');
    });
  }

  // 落ち葉マスに直接乗ったとき: 対のつむじ風が使えなくなり、画面外へ飛び去る
  whirlFlee(whirlIdx) {
    this._whirlExit(whirlIdx, 0.15);
  }

  // つむじ風がうさぎを落とした瞬間: 落ち葉マスの葉が舞い散り、
  // 積もっていた落ち葉が吹き飛んで下から普通の畑マスが現れる
  _blowLeaves(idx) {
    const tm = this.tileMeshes[idx];
    if (!tm) return;
    const wp = new THREE.Vector3();
    tm.group.getWorldPosition(wp);

    // 舞い散る葉(外へ渦を巻きながら飛んで消える)
    const cols = [0xe8632a, 0xf2b13a, 0xc23a3a, 0xff9a3f, 0xd9814f];
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(
        new THREE.CircleGeometry(0.05 + Math.random() * 0.05, 5),
        new THREE.MeshStandardMaterial({
          color: cols[i % cols.length],
          flatShading: true,
          side: THREE.DoubleSide,
          transparent: true,
        })
      );
      m.position.set(wp.x, wp.y + 0.22, wp.z);
      this.scene.add(m);
      this._fx.add(m);
      const ang0 = (i / 14) * Math.PI * 2 + Math.random() * 0.5;
      const sp = 0.7 + Math.random() * 1.1;
      const vy = 1.0 + Math.random() * 1.2;
      const swirl = 2.2 + Math.random() * 1.6; // 渦を巻く回り込み
      const rx = (Math.random() - 0.5) * 1.4;
      const rz = (Math.random() - 0.5) * 1.4;
      this.tween(0.8 + Math.random() * 0.4, i * 0.01, (t) => t, (k) => {
        const ang = ang0 + swirl * k;
        const r = sp * k;
        m.position.set(
          wp.x + Math.cos(ang) * r,
          wp.y + 0.22 + vy * k * (1 - 0.55 * k),
          wp.z + Math.sin(ang) * r
        );
        m.rotation.x += rx * 0.25;
        m.rotation.z += rz * 0.25;
        m.material.opacity = 1 - k * k;
      }, () => this._removeFx(m));
    }

    // 積もっていた落ち葉の山は吹き飛んで消える(下の畑マスが現れる)
    const pile = tm.group.userData.leafPile;
    if (pile && pile.visible) {
      const s0 = pile.scale.x;
      this.tween(0.32, 0.05, easeOut, (k) => {
        pile.scale.setScalar(Math.max(0.01, s0 * (1 - k)));
        pile.position.y = 0.18 * k;
      }, () => {
        pile.visible = false;
      }, `leafpile${idx}`);
    }
  }

  setNumbersVisible(v) {
    this.numbersVisible = v;
    for (const t of this.tileMeshes) if (t.number) t.number.visible = v && t.alive;
  }

  setGridVisible(v) {
    if (this.grid) this.grid.visible = v;
  }

  // ---------- アニメーション ----------
  tween(dur, delay, ease, update, done, tag) {
    this.tweens.push({ t: -delay, dur, ease, update, done, tag });
  }

  // 同じ対象を動かす古いトゥイーンを打ち切る（doneは呼ばない）
  killTweens(tag) {
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      if (this.tweens[i].tag === tag) this.tweens.splice(i, 1);
    }
  }

  // 飛行中の「ぴょーん」ポーズ: 前足を前へ伸ばし、後ろ足を後ろへ蹴り出す
  _applyJumpPose(e) {
    this.jumpPose = e;
    const u = this.rabbit.userData;
    for (const f of u.feet) {
      f.position.z = f.userData.base.z - 0.3 * e;
      f.position.y = f.userData.base.y + 0.13 * e;
      f.rotation.x = 1.0 * e;
    }
    for (const a of u.arms) {
      a.position.z = a.userData.base.z + 0.16 * e;
      a.position.y = a.userData.base.y + 0.12 * e;
      a.rotation.x = -0.9 * e;
    }
  }

  // ウサギがジャンプ。sinkIdx>=0 ならそのマスを沈める。Promise を返す。
  // タメ(しゃがみ) → ぴょーん(高い弧・伸び・前傾・手足を伸ばす) → 着地バウンド の3段モーション
  // from は stance {x,y}(空きマスにも立てる)。
  jumpTo(fromStance, target, sinkIdx = -1) {
    return new Promise((resolve) => {
      const from = fromStance;
      const to = target === 'goal' ? this.level.goal : this.level.tiles[target];
      const p0 = this.worldPos(from.x, from.y, this._standY(from.x, from.y));
      const p1 = this.worldPos(to.x, to.y, this._standY(to.x, to.y));
      // ゴールでは2匹が台座に並ぶよう、白ウサギは左寄りに着地する
      if (target === 'goal') {
        p1.x += Math.SQRT1_2 * -0.44;
        p1.z += -Math.SQRT1_2 * -0.44;
      }
      const dist = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
      // 上りのときは頂点を高くして、段をしっかり越える弧を描く
      const climb = Math.max(0, p1.y - p0.y);
      const height = 0.95 + dist * 0.32 + climb * 0.9;
      const crouchDur = 0.12;
      const flightDur = 0.36 + dist * 0.08;

      this.rabbit.rotation.y = Math.atan2(p1.x - p0.x, p1.z - p0.z);
      this.killTweens('rabbit');

      // ゴールに飛び込むときはピンクウサギが台座の右側へパッと横移動してよける
      // （プレイヤーの方を見たまま＝向きは変えない。冷たくならないように）
      if (target === 'goal' && this.goalMesh && this.goalMesh.userData.bunny) {
        const b = this.goalMesh.userData.bunny;
        this.goalCollected = true; // 待機モーションを止めて演出をtween制御にする
        const bx = Math.SQRT1_2 * 0.4; // 画面の右方向へ
        const bz = -Math.SQRT1_2 * 0.4;
        this.tween(0.24, crouchDur + flightDur * 0.35, (t) => t, (k) => {
          b.position.x = bx * k;
          b.position.z = bz * k;
          b.position.y = 0.2 + 0.22 * 4 * k * (1 - k); // 小さくぴょこっと
          const sy = 1 + 0.15 * Math.sin(k * Math.PI);
          b.userData.inner.scale.y = 0.92 * sy;
        }, () => {
          b.userData.inner.scale.y = 0.92;
        }, 'goal');
      }

      // 1) タメ：ぐっとしゃがむ
      this.tween(crouchDur, 0, easeOut, (k) => {
        const sy = 1 - 0.24 * k;
        this.rabbit.scale.set(1 + 0.12 * k, sy, 1 + 0.12 * k);
      }, null, 'rabbit');

      // 2) 飛行：高い弧を描き、進行方向へ体が伸びる（前後に長く・上下に薄く）
      this.tween(flightDur, crouchDur, (t) => t, (k) => {
        this.rabbit.position.lerpVectors(p0, p1, k);
        this.rabbit.position.y =
          p0.y + (p1.y - p0.y) * k + height * 4 * k * (1 - k);
        const e = Math.sin(k * Math.PI);
        this.rabbit.scale.set(1 - 0.06 * e, 1 - 0.09 * e, 1 + 0.2 * e);
        // 上昇中はのけぞり、下降中は前傾（軌道に体を沿わせる）
        this.rabbit.rotation.x = 0.6 * e * (k - 0.5);
        // 手足を伸ばして「ぴょーん」
        this._applyJumpPose(e);
      }, () => {
        this.rabbit.position.copy(p1);
        this.rabbit.rotation.x = 0;
        this._applyJumpPose(0);
        resolve(); // ゲーム進行は着地時点で再開
      }, 'rabbit');

      // 3) 着地バウンド：ぐしゃっとつぶれて戻る
      this.tween(0.2, crouchDur + flightDur, easeOut, (k) => {
        const sy = 0.72 + 0.28 * k;
        this.rabbit.scale.set(1 + 0.18 * (1 - k), sy, 1 + 0.18 * (1 - k));
      }, () => {
        this.rabbit.scale.setScalar(1);
      }, 'rabbit');

      if (sinkIdx >= 0) this._sinkTile(sinkIdx);
    });
  }

  // トロッコで運ばれる: 荷車がウサギを乗せてレール方向の停止セルまで走り、大破して沈む。
  rideCart(cartIdx, stop) {
    return new Promise((resolve) => {
      const c = this.level.tiles[cartIdx];
      const cartTm = this.tileMeshes[cartIdx];
      const rg = cartTm.group.userData.railGroup;
      const cart = cartTm.group.userData.cart;
      const p0 = this.worldPos(c.x, c.y, this._standY(c.x, c.y));
      const p1 = this.worldPos(stop.x, stop.y, this._standY(stop.x, stop.y));
      const dist = Math.abs(stop.x - c.x) + Math.abs(stop.y - c.y);
      this.killTweens('rabbit');
      // 荷車を進行方向へ向ける(乗った向きで走る)
      if (rg && dist > 0) {
        rg.rotation.y = Math.atan2(stop.x - c.x, stop.y - c.y);
      }
      if (dist > 0) this.rabbit.rotation.y = Math.atan2(p1.x - p0.x, p1.z - p0.z);
      const dur = 0.16 + dist * 0.12;
      this.tween(dur, 0, (t) => t, (t) => {
        const e = t * t * (3 - 2 * t); // なめらか加減速
        this.rabbit.position.lerpVectors(p0, p1, e);
        this.rabbit.position.y = p0.y + 0.05 * Math.sin(e * Math.PI);
        this.rabbit.scale.set(1, 1, 1);
        if (rg) rg.position.set((stop.x - c.x) * e, 0, (stop.y - c.y) * e);
        if (cart) for (const w of cart.userData.wheels || []) w.rotation.x -= 0.7;
      }, () => {
        this.rabbit.position.copy(p1);
        this._breakCart(cartIdx); // 大破してマスが沈む
        resolve();
      }, 'rabbit');
    });
  }

  _sinkTile(idx) {
    const tm = this.tileMeshes[idx];
    tm.alive = false;
    const g = tm.group;
    this.killTweens(`tile${idx}`);
    this.tween(0.5, 0.12, easeInOut, (k) => {
      g.position.y = tm.baseY - 1.3 * k;
      g.scale.setScalar(Math.max(1 - k, 0.01));
    }, () => {
      if (!tm.alive) g.visible = false;
    }, `tile${idx}`);
  }

  // まきもどし：ウサギが今の位置から toStance の位置へ戻る(ふわっとホップ)
  rewindHop(toStance) {
    return new Promise((resolve) => {
      this.rabbit.scale.setScalar(1); // 捕獲でしぼんでいた場合に戻す
      const p0 = this.rabbit.position.clone();
      const p1 = this.worldPos(
        toStance.x,
        toStance.y,
        this._standY(toStance.x, toStance.y)
      );
      this.rabbit.rotation.y = Math.atan2(p1.x - p0.x, p1.z - p0.z);
      this.killTweens('rabbit');
      this.tween(0.35, 0.05, (t) => t, (k) => {
        this.rabbit.position.lerpVectors(p0, p1, k);
        this.rabbit.position.y =
          p0.y + (p1.y - p0.y) * k + 0.8 * 4 * k * (1 - k);
      }, () => {
        this.rabbit.position.copy(p1);
        resolve();
      }, 'rabbit');
    });
  }

  // 着地したマスのニンジンをパクッと消す（ウサギが食べた演出とセット）
  eatCarrots(idx) {
    const c = this.tileMeshes[idx].group.userData.carrots;
    if (!c || !c.visible) return; // つむじ風マスにはニンジンが無い
    this.eatStart = this.time; // ウサギのモグモグを1回再生
    this.killTweens(`carrot${idx}`);
    this.tween(0.22, 0, easeOut, (k) => {
      c.scale.setScalar(Math.max(0.01, 1 - k));
    }, () => {
      c.visible = false;
      c.scale.setScalar(1);
    }, `carrot${idx}`);
  }

  // ※まきもどしで復元されたマスは「食べたあと」なのでニンジンは戻さない

  // まきもどしで沈んだマスを盤面に戻す
  restoreTile(idx) {
    const tm = this.tileMeshes[idx];
    // トロッコは大破・移動しているので位置とスケールを元に戻す
    const rg = tm.group.userData.railGroup;
    if (rg) {
      this.killTweens(`cart${idx}`);
      rg.position.set(0, 0, 0);
      rg.scale.setScalar(1);
      rg.rotation.y = 0;
      rg.visible = true;
    }
    if (tm.alive && tm.group.visible) return;
    tm.alive = true;
    tm.group.visible = true;
    this.killTweens(`tile${idx}`);
    this.tween(0.3, 0, easeOut, (k) => {
      tm.group.position.y = tm.baseY - 1.3 * (1 - k);
      tm.group.scale.setScalar(Math.max(0.01, k));
    }, null, `tile${idx}`);
  }

  // 荷車が大破する演出 → 破片が飛び散ってマスが沈む
  _breakCart(idx) {
    const tm = this.tileMeshes[idx];
    const rg = tm.group.userData.railGroup;
    const wp = new THREE.Vector3();
    (rg || tm.group).getWorldPosition(wp);
    if (rg) rg.visible = false; // 荷車は一瞬で砕けて消える

    // 破片(木＝茶, 金属＝青灰, 車輪＝黒)を弾き飛ばす
    const colors = [0x3f8fd0, 0x2f6ea8, 0xcfe4f2, 0x2b2b30, 0xffd24a];
    for (let i = 0; i < 12; i++) {
      const sz = 0.07 + Math.random() * 0.08;
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(sz, sz, sz),
        new THREE.MeshStandardMaterial({
          color: colors[i % colors.length],
          flatShading: true,
        })
      );
      m.position.set(wp.x, wp.y + 0.35, wp.z);
      this.scene.add(m);
      this._fx.add(m);
      const ang = Math.random() * Math.PI * 2;
      const sp = 1.2 + Math.random() * 1.8;
      const vx = Math.cos(ang) * sp;
      const vz = Math.sin(ang) * sp;
      const vy = 2.2 + Math.random() * 2.2;
      const rx = (Math.random() - 0.5) * 0.8;
      const ry = (Math.random() - 0.5) * 0.8;
      this.tween(0.55 + Math.random() * 0.3, 0, (t) => t, (k) => {
        m.position.set(wp.x + vx * k, wp.y + 0.35 + vy * k - 4.5 * k * k, wp.z + vz * k);
        m.rotation.x += rx;
        m.rotation.y += ry;
        m.scale.setScalar(Math.max(0.01, 1 - k * 0.7));
      }, () => this._removeFx(m));
    }
    // 砂ぼこりのリング
    const ring = makeRing(0xe8dcc0);
    ring.position.set(wp.x, 0.03, wp.z);
    ring.rotation.x = -Math.PI / 2;
    this.scene.add(ring);
    this._fx.add(ring);
    this.tween(0.4, 0, easeOut, (k) => {
      ring.scale.setScalar(0.5 + k * 2.2);
      ring.material.opacity = 0.7 * (1 - k);
    }, () => this._removeFx(ring));

    this._sinkTile(idx);
  }

  setOnSpring(v) {
    this.onSpring = v;
  }

  // 空きマス(トロッコ降車後)の次のジャンプ力を、そのマスの位置に固定表示する。
  // ウサギの子ではなくワールドに置くので、ジャンプしても追従せずその場に残る。
  setRabbitNumber(n, gx, gy) {
    if (this.rabbitNum) {
      this.scene.remove(this.rabbitNum);
      if (this.rabbitNum.material.map) this.rabbitNum.material.map.dispose();
      this.rabbitNum.material.dispose();
      this.rabbitNum = null;
    }
    if (n == null) return;
    const spr = makeNumberSprite(n);
    const p = this.worldPos(gx, gy, this._standY(gx, gy) + 1.5); // 頭上あたり
    spr.position.copy(p);
    this.scene.add(spr);
    this.rabbitNum = spr;
  }

  celebrate() {
    this.goalCollected = true;
    const bunny = this.goalMesh && this.goalMesh.userData.bunny;
    const rb = this.rabbit;
    const shortest = (a) => Math.atan2(Math.sin(a), Math.cos(a));

    // 1) 着地したらすぐお互いの方を向く（見つめ合い）
    if (bunny) {
      let s0 = null;
      this.tween(0.22, 0.03, easeOut, (k) => {
        if (!s0) {
          const rp = rb.position;
          const bp = new THREE.Vector3();
          bunny.getWorldPosition(bp);
          s0 = {
            r0: rb.rotation.y,
            b0: bunny.rotation.y,
            rT: Math.atan2(bp.x - rp.x, bp.z - rp.z),
            bT: Math.atan2(rp.x - bp.x, rp.z - bp.z),
          };
        }
        rb.rotation.y = s0.r0 + shortest(s0.rT - s0.r0) * k;
        bunny.rotation.y = s0.b0 + shortest(s0.bT - s0.b0) * k;
      }, null, 'gaze');
    }

    // 2) 見つめ合ったまま、同じタイミングで一緒にジャンプ×2（左右に揺れながら）
    const baseB = bunny ? bunny.position.y : 0;
    const baseR = rb.position.y; // ゴールの地形の高さ基準
    for (let i = 0; i < 2; i++) {
      this.tween(0.42, 0.32 + i * 0.5, (t) => t, (k) => {
        const arc = 4 * k * (1 - k);
        const tilt = 0.13 * Math.sin(k * Math.PI * 2);
        rb.position.y = baseR + 0.85 * arc;
        rb.rotation.z = tilt;
        if (bunny) {
          bunny.position.y = baseB + 0.6 * arc;
          bunny.rotation.z = tilt;
        }
      }, () => {
        rb.rotation.z = 0;
        if (bunny) bunny.rotation.z = 0;
      }, 'rabbit');
    }
  }

  sadHop() {
    this.tween(0.5, 0, (t) => t, (k) => {
      this.rabbit.rotation.z = Math.sin(k * Math.PI * 4) * 0.12;
    }, () => (this.rabbit.rotation.z = 0));
  }

  // ---------- 入力 ----------
  _pointer(e) {
    if (!this.onTileTap || !this.level) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);

    const targets = [];
    this.tileMeshes.forEach((t, i) => {
      if (t.alive) targets.push({ obj: t.group, id: i });
    });
    if (this.goalMesh) targets.push({ obj: this.goalMesh, id: 'goal' });

    let best = null;
    for (const t of targets) {
      const hits = this.raycaster.intersectObject(t.obj, true);
      if (hits.length && (!best || hits[0].distance < best.dist)) {
        best = { id: t.id, dist: hits[0].distance };
      }
    }
    if (best) this.onTileTap(best.id);
  }

  // 画面上での方向キー入力用：ウサギから見た各ターゲットの画面方向を返す
  screenDirTo(target) {
    const to = target === 'goal' ? this.level.goal : this.level.tiles[target];
    const p0 = this.rabbit.position.clone().project(this.camera);
    const p1 = this.worldPos(to.x, to.y, this._standY(to.x, to.y)).project(
      this.camera
    );
    return { x: p1.x - p0.x, y: p1.y - p0.y };
  }

  // ---------- 毎フレーム ----------
  _frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;

    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += dt;
      if (tw.t < 0) continue;
      const k = Math.min(tw.t / tw.dur, 1);
      tw.update(tw.ease(k));
      if (k >= 1) {
        this.tweens.splice(i, 1);
        tw.done && tw.done();
      }
    }

    // マスの発光を役割ごとにまとめて設定(優先: 危険 > ヒント > ゴール > 移動)。
    // 到達=明滅、危険=赤く常時(点滅なし)。役割が外れたマスは元の発光へ戻す。
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 5);
    const hintPulse = 0.5 + 0.5 * Math.sin(this.time * 8);
    const active = new Map();
    for (const id of this.reachIds) {
      if (id === 'goal') active.set('goal', { col: 0xffcf22, inten: 0.4 + 0.6 * pulse });
      else active.set(id, { col: 0xfff04a, inten: 0.05 + 0.26 * pulse });
    }
    if (this.hintId != null) active.set(this.hintId, { col: 0xff2f8e, inten: 0.2 + 0.42 * hintPulse });
    const matsOf = (id) => (id === 'goal' ? this.goalOrigMats : this.tileMeshes[id] && this.tileMeshes[id].origMats);
    for (const [id, role] of active) {
      const mats = matsOf(id);
      if (!mats) continue;
      for (const mm of mats) {
        mm.m.emissive.setHex(role.col);
        mm.m.emissiveIntensity = role.inten;
      }
    }
    for (const id of this._activeHi) {
      if (active.has(id)) continue;
      const mats = matsOf(id);
      if (!mats) continue;
      for (const mm of mats) {
        mm.m.emissive.setHex(mm.e);
        mm.m.emissiveIntensity = mm.i;
      }
    }
    this._activeHi = new Set(active.keys());

    // ゴールのピンクウサギの待機モーション
    if (this.goalMesh && !this.goalCollected) {
      const bunny = this.goalMesh.userData.bunny;
      if (bunny) {
        // 呼吸と左右のゆらゆら
        bunny.userData.inner.scale.y = 0.92 * (1 + 0.03 * Math.sin(this.time * 3.1 + 1));
        bunny.rotation.z = 0.06 * Math.sin(this.time * 1.5);
        // ときどきぴょこっと跳ねる
        const bt = (this.time + 0.9) % 2.8;
        bunny.position.y = 0.2 + (bt < 0.3 ? 0.1 * Math.sin((bt / 0.3) * Math.PI) : 0);
        // 耳がふわふわ
        for (const e of bunny.userData.ears) {
          e.mesh.rotation.z = e.baseZ + 0.07 * Math.sin(this.time * 2.2 + e.baseZ);
        }
        // プレイヤーの方をゆっくり向く（追従）
        if (this.rabbit.visible) {
          const bp = this.goalMesh.position;
          const ta = Math.atan2(
            this.rabbit.position.x - bp.x,
            this.rabbit.position.z - bp.z
          );
          const dd = Math.atan2(
            Math.sin(ta - bunny.rotation.y),
            Math.cos(ta - bunny.rotation.y)
          );
          bunny.rotation.y += dd * Math.min(1, dt * 4);
        }
      }
    }
    if (this.goalMesh) {
      // 旗の揺れ
      const flag = this.goalMesh.userData.flag;
      if (flag) flag.rotation.y = Math.PI / 4 + Math.sin(this.time * 4) * 0.18;
    }

    // ウサギの待機モーション（内側グループだけを動かすのでジャンプと干渉しない）
    if (this.rabbit.visible) {
      const inner = this.rabbit.userData.inner;
      const snack = this.rabbit.userData.snack;
      const rabbitBusy = this.tweens.some((t) => t.tag === 'rabbit');

      // 呼吸
      let stretch = 1 + 0.025 * Math.sin(this.time * 2.8);

      // ニンジンを食べる（着地して1回だけ。マスのニンジン消滅と同期）
      const eatK = this.eatStart < 0 ? 1 : (this.time - this.eatStart) / 1.3;
      const eating = !rabbitBusy && eatK < 1;
      snack.visible = eating;
      if (eating) {
        snack.scale.setScalar(0.55 * (1 - 0.85 * eatK)); // だんだん小さく
        inner.rotation.x = 0.13 + 0.035 * Math.sin(this.time * 24); // 前かがみでもぐもぐ
      } else {
        inner.rotation.x = 0;
      }

      if (this.onSpring && !rabbitBusy && !eating) {
        // ジャンプ台の上ではその場でぽよんぽよんバウンドし続ける
        const bt = Math.abs(Math.sin(this.time * 5.5));
        inner.position.y = bt * 0.18;
        stretch *= 1 + 0.15 * bt - 0.1 * (1 - bt);
      } else {
        // ときどき足踏みホップ（伸び縮みのジャンプモーション付き。食事中・移動中はしない）
        const hopT = this.time % 4.3;
        if (!rabbitBusy && !eating && hopT < 0.34) {
          const k = hopT / 0.34;
          inner.position.y = 0.13 * Math.sin(k * Math.PI);
          // 踏切と着地でつぶれ、空中で伸びる
          stretch *= 1 + 0.24 * Math.sin(k * Math.PI) - 0.12 * Math.abs(Math.cos(k * Math.PI));
        } else {
          inner.position.y = 0;
        }
      }
      inner.scale.y = 1.18 * stretch;

      // ときどき耳ピクッ（ジャンプ中は後ろへなびく）
      const earT = (this.time + 1.7) % 3.4;
      const twitch = earT < 0.4 ? Math.sin((earT / 0.4) * Math.PI * 2) * 0.2 : 0;
      for (const e of this.rabbit.userData.ears) {
        e.mesh.rotation.x = e.baseX + twitch - 0.5 * this.jumpPose;
      }
    }
    // ジャンプ台のマスは常時ぽよんぽよん弾む（動きで見分けられるように）
    for (const t of this.tileMeshes) {
      if (!t.spring || !t.alive || !t.group.visible) continue;
      // 登場/沈み中(スケールが1でない)は触らない
      if (Math.abs(t.group.scale.x - 1) > 0.05) continue;
      const b = Math.abs(Math.sin(this.time * 4.5 + t.idx * 1.3));
      t.group.scale.y = 0.94 + 0.1 * b;
    }

    // つむじ風マスは常にグルグル回す(中の木の葉はひらひら舞う)
    for (const t of this.tileMeshes) {
      if (!t.whirl || !t.alive || !t.group.visible) continue;
      const spin = t.group.userData.spin;
      if (spin) spin.rotation.y += dt * 6;
      const leaves = t.group.userData.leaves;
      if (leaves) {
        for (let i = 0; i < leaves.length; i++) {
          const lf = leaves[i];
          lf.rotation.x += dt * (3 + (i % 3));
          lf.rotation.z += dt * (2 + (i % 2) * 2.5);
          // ふわふわ上下(葉ごとに位相をずらす)
          lf.position.y += Math.sin(this.time * 2.6 + i * 1.7) * dt * 0.12;
        }
      }
    }

    // 極小ウサギがゆっくり行き来する（にぎやかし）
    const miniSide = { x: Math.SQRT1_2, z: -Math.SQRT1_2 };
    for (const m of this.minis) {
      const t = this.time * m.speed + m.phase;
      const off = Math.sin(t) * m.range;
      m.g.position.set(
        m.anchor.x + miniSide.x * off,
        Math.abs(Math.sin(this.time * 3.2 + m.phase)) * 0.05,
        m.anchor.z + miniSide.z * off
      );
      const dir = Math.cos(t) >= 0 ? 1 : -1;
      m.g.rotation.y = Math.atan2(miniSide.x * dir, miniSide.z * dir);
    }

    // カメラをなめらかに移動
    this.camPos.lerp(this.camGoal.pos, 1 - Math.pow(0.001, dt));
    this.camTarget.lerp(this.camGoal.target, 1 - Math.pow(0.001, dt));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);

    this.renderer.render(this.scene, this.camera);
  }
}
