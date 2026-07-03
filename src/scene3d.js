// Three.js シーン管理：ステージ描画、ジャンプ/沈むアニメーション、タップ判定
import * as THREE from 'three';
import {
  makeRabbit,
  makeGoalRabbit,
  makeTile,
  makeGoal,
  makePickup,
  makeIsland,
  makeNumberSprite,
  makeRing,
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
    this.island = makeIsland(GRID);
    this.scene.add(this.island);

    // グリッド線（9x9全面）
    this.grid = new THREE.GridHelper(GRID, GRID, 0xffffff, 0xffffff);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.22;
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
    this.rings = [];
    this.hintMarker = null;
    this.tweens = [];
    this.clock = new THREE.Clock();
    this.time = 0;
    this.eatStart = -1; // 着地後の「食べる」演出の開始時刻(-1=なし)
    this.jumpPose = 0; // 飛行中の手足ポーズ(0=通常, 1=ぴょーん)
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

  resize() {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.level) this._fitCamera(true);
  }

  // ---------- ステージ構築 ----------
  buildStage(level) {
    this.level = level;
    this.goalCollected = false;
    this.eatStart = -1;
    for (const t of this.tileMeshes) this.world.remove(t.group);
    if (this.goalMesh) this.world.remove(this.goalMesh);
    this.clearRings();
    this.clearHint();
    this.tweens = [];
    this.tileMeshes = [];

    level.tiles.forEach((t, i) => {
      const group = makeTile(t.value);
      group.position.copy(this.worldPos(t.x, t.y));
      const number = makeNumberSprite(t.value);
      number.visible = this.numbersVisible;
      group.add(number);
      let pickup = null;
      if (t.pickup) {
        pickup = makePickup(t.pickup);
        // ニンジンに埋もれないよう画面の手前(下)側へ
        pickup.position.set(Math.SQRT1_2 * 0.34, 0, Math.SQRT1_2 * 0.34);
        group.add(pickup);
      }
      this.world.add(group);
      this.tileMeshes.push({ group, number, pickup, baseY: 0, idx: i, alive: true });

      // 登場アニメーション
      group.position.y = -1.2;
      group.scale.setScalar(0.3);
      this.tween(0.45, i * 0.03, easeOut, (k) => {
        group.position.y = -1.2 + 1.2 * k;
        group.scale.setScalar(0.3 + 0.7 * k);
      });
    });

    this.goalMesh = makeGoal();
    this.goalMesh.position.copy(this.worldPos(level.goal.x, level.goal.y));
    this.world.add(this.goalMesh);
    this.goalMesh.scale.setScalar(0.01);
    this.tween(0.5, level.tiles.length * 0.03, easeOut, (k) => {
      this.goalMesh.scale.setScalar(Math.max(k, 0.01));
    });

    // ウサギは登場シーン(playEntrance)まで隠しておく
    const start = level.tiles[0];
    this.tileMeshes[0].group.userData.carrots.visible = false;
    this.rabbit.visible = false;
    this.rabbit.position.copy(this.worldPos(start.x, start.y, 0.22));
    this.rabbit.rotation.set(0, Math.PI / 4, 0);
    this.rabbit.scale.setScalar(1);

    this._fitCamera(false);
    this._buildMinis(level);
  }

  // 白ウサギの登場シーン: 画面手前から2ホップでスタートマスへ入り、カメラの方を向く
  playEntrance() {
    return new Promise((resolve) => {
      const start = this.level.tiles[0];
      const goalP = this.worldPos(start.x, start.y, 0.22);
      const fwd = { x: Math.SQRT1_2, z: Math.SQRT1_2 }; // 画面の手前方向

      const pts = [2.3, 1.1, 0].map((d, i) => {
        const p = new THREE.Vector3(
          goalP.x + fwd.x * d,
          d > 0 ? 0.06 : 0.22, // 途中は草の上、最後はマスの上
          goalP.z + fwd.z * d
        );
        return p;
      });

      this.killTweens('rabbit');
      this.rabbit.visible = true;
      this.rabbit.position.copy(pts[0]);
      this.rabbit.rotation.y = Math.atan2(-fwd.x, -fwd.z); // 進行方向(奥)を向く

      let delay = 0.15;
      for (let i = 0; i < 2; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        this.tween(0.34, delay, (t) => t, (k) => {
          this.rabbit.position.lerpVectors(a, b, k);
          this.rabbit.position.y = a.y + (b.y - a.y) * k + 0.8 * 4 * k * (1 - k);
          const sy = 1 + 0.3 * Math.sin(k * Math.PI);
          this.rabbit.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
          this._applyJumpPose(Math.sin(k * Math.PI));
        }, null, 'rabbit');
        delay += 0.42;
      }

      // 着地後、くるっとカメラの方へ向き直ってぴょこんと決めポーズ
      const turnFrom = Math.atan2(-fwd.x, -fwd.z);
      const turnTo = Math.PI / 4;
      this.tween(0.32, delay, easeOut, (k) => {
        this._applyJumpPose(0);
        this.rabbit.rotation.y =
          turnFrom + Math.atan2(Math.sin(turnTo - turnFrom), Math.cos(turnTo - turnFrom)) * k;
        this.rabbit.position.y = 0.22 + 0.35 * 4 * k * (1 - k);
        const sy = 1 + 0.15 * Math.sin(k * Math.PI);
        this.rabbit.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
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
    const halfW = Math.max(maxS + 1.15, 3.2);
    const halfH = Math.max(maxT * 0.87 + 1.15, 2.7);
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

  // ---------- 点滅表示 ----------
  clearRings() {
    for (const r of this.rings) r.parent && r.parent.remove(r);
    this.rings = [];
  }

  setReachable(list) {
    this.clearRings();
    for (const item of list) {
      const ring = makeRing(item === 'goal' ? 0xffd24a : 0xfffb8f);
      const parent =
        item === 'goal' ? this.goalMesh : this.tileMeshes[item].group;
      parent.add(ring);
      this.rings.push(ring);
    }
  }

  showHint(target) {
    this.clearHint();
    const ring = makeRing(0x59c2ff);
    ring.scale.setScalar(0.85);
    const parent =
      target === 'goal' ? this.goalMesh : this.tileMeshes[target].group;
    parent.add(ring);
    this.hintMarker = ring;
    setTimeout(() => this.clearHint(), 3500);
  }

  clearHint() {
    if (this.hintMarker) {
      this.hintMarker.parent && this.hintMarker.parent.remove(this.hintMarker);
      this.hintMarker = null;
    }
  }

  setNumbersVisible(v) {
    this.numbersVisible = v;
    for (const t of this.tileMeshes) t.number.visible = v && t.alive;
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

  // ウサギがジャンプ。fromIdx のマスは沈む。Promise を返す。
  // タメ(しゃがみ) → ぴょーん(高い弧・伸び・前傾・手足を伸ばす) → 着地バウンド の3段モーション
  jumpTo(fromIdx, target) {
    return new Promise((resolve) => {
      const from = this.level.tiles[fromIdx];
      const to = target === 'goal' ? this.level.goal : this.level.tiles[target];
      const p0 = this.worldPos(from.x, from.y, 0.22);
      const p1 = this.worldPos(to.x, to.y, 0.22);
      const dist = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
      const height = 0.95 + dist * 0.32;
      const crouchDur = 0.12;
      const flightDur = 0.36 + dist * 0.08;

      this.rabbit.rotation.y = Math.atan2(p1.x - p0.x, p1.z - p0.z);
      this.killTweens('rabbit');

      // ゴールに飛び込むときはピンクウサギが隣のマスへぴょんとよける
      // （盤面の外に出ないよう、グリッド中央に近い隣接マスを選ぶ）
      if (target === 'goal' && this.goalMesh && this.goalMesh.userData.bunny) {
        const b = this.goalMesh.userData.bunny;
        this.goalCollected = true; // 待機モーションを止めて演出をtween制御にする
        const goal = this.level.goal;
        const mid = (GRID - 1) / 2;
        let best = null;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = goal.x + dx;
          const ny = goal.y + dy;
          if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
          if (nx === from.x && ny === from.y) continue; // プレイヤーの進入元は避ける
          const d = Math.hypot(nx - mid, ny - mid);
          if (!best || d < best.d) best = { bx: dx, bz: dy, d };
        }
        const bx = best ? best.bx : Math.SQRT1_2;
        const bz = best ? best.bz : -Math.SQRT1_2;
        b.rotation.y = Math.atan2(bx, bz); // 跳ぶ方向を向いて
        this.tween(0.36, crouchDur + flightDur * 0.3, (t) => t, (k) => {
          b.position.x = bx * k;
          b.position.z = bz * k;
          b.position.y = 0.2 + 0.55 * 4 * k * (1 - k) - 0.14 * k; // 隣は地面なので少し低く着地
          const sy = 1 + 0.22 * Math.sin(k * Math.PI);
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

      // 2) 飛行：高い弧を描き、空中で伸びて前傾→着地に向けて起こす
      this.tween(flightDur, crouchDur, (t) => t, (k) => {
        this.rabbit.position.lerpVectors(p0, p1, k);
        this.rabbit.position.y = 0.22 + height * 4 * k * (1 - k);
        const sy = 1 + 0.4 * Math.sin(k * Math.PI);
        this.rabbit.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
        // 上昇中はのけぞり、下降中は前傾
        this.rabbit.rotation.x = 0.5 * Math.sin(k * Math.PI) * (k - 0.5);
        // 手足を伸ばして「ぴょーん」
        this._applyJumpPose(Math.sin(k * Math.PI));
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

      this._sinkTile(fromIdx);
    });
  }

  _sinkTile(idx) {
    const tm = this.tileMeshes[idx];
    tm.alive = false;
    const g = tm.group;
    this.killTweens(`tile${idx}`);
    this.tween(0.5, 0.12, easeInOut, (k) => {
      g.position.y = -1.3 * k;
      g.scale.setScalar(Math.max(1 - k, 0.01));
    }, () => {
      if (!tm.alive) g.visible = false;
    }, `tile${idx}`);
  }

  // まきもどし：ウサギが戻り、マスが復活する
  rewindTo(restoreIdx, fromTarget) {
    return new Promise((resolve) => {
      const tm = this.tileMeshes[restoreIdx];
      const g = tm.group;
      tm.alive = true;
      g.visible = true;
      this.killTweens(`tile${restoreIdx}`);
      this.tween(0.35, 0, easeOut, (k) => {
        g.position.y = -1.3 * (1 - k);
        g.scale.setScalar(Math.max(0.01, k));
      }, null, `tile${restoreIdx}`);

      const from =
        fromTarget === 'goal'
          ? this.level.goal
          : this.level.tiles[fromTarget];
      const to = this.level.tiles[restoreIdx];
      const p0 = this.worldPos(from.x, from.y, 0.22);
      const p1 = this.worldPos(to.x, to.y, 0.22);
      this.rabbit.rotation.y = Math.atan2(p1.x - p0.x, p1.z - p0.z);
      this.killTweens('rabbit');
      this.tween(0.35, 0.05, (t) => t, (k) => {
        this.rabbit.position.lerpVectors(p0, p1, k);
        this.rabbit.position.y = 0.22 + 0.8 * 4 * k * (1 - k);
      }, () => {
        this.rabbit.position.copy(p1);
        resolve();
      }, 'rabbit');
    });
  }

  // 着地したマスのニンジンをパクッと消す（ウサギが食べた演出とセット）
  eatCarrots(idx) {
    const c = this.tileMeshes[idx].group.userData.carrots;
    if (!c.visible) return;
    this.eatStart = this.time; // ウサギのモグモグを1回再生
    this.killTweens(`carrot${idx}`);
    this.tween(0.22, 0, easeOut, (k) => {
      c.scale.setScalar(Math.max(0.01, 1 - k));
    }, () => {
      c.visible = false;
      c.scale.setScalar(1);
    }, `carrot${idx}`);
  }

  // まきもどしで復元されたマスのニンジンを戻す
  restoreCarrots(idx) {
    const c = this.tileMeshes[idx].group.userData.carrots;
    this.killTweens(`carrot${idx}`);
    c.visible = true;
    this.tween(0.25, 0, easeOut, (k) => {
      c.scale.setScalar(Math.max(0.01, k));
    }, null, `carrot${idx}`);
  }

  collectPickup(idx) {
    const tm = this.tileMeshes[idx];
    if (!tm.pickup) return;
    const p = tm.pickup;
    tm.pickup = null;
    this.tween(0.4, 0, easeOut, (k) => {
      p.position.y = k * 1.2;
      p.scale.setScalar(Math.max(0.01, 1 - k));
    }, () => {
      tm.group.remove(p);
    });
  }

  celebrate() {
    this.goalCollected = true;
    // ピンクウサギも一緒に喜んで跳ねる（短め: 2回）
    const bunny = this.goalMesh && this.goalMesh.userData.bunny;
    if (bunny) {
      const baseY = bunny.position.y; // よけた先の地面の高さを基準に
      for (let i = 0; i < 2; i++) {
        this.tween(0.4, 0.05 + i * 0.42, (t) => t, (k) => {
          bunny.position.y = baseY + 0.6 * 4 * k * (1 - k);
          bunny.rotation.z = 0.15 * Math.sin(k * Math.PI * 2);
        }, () => {
          bunny.rotation.z = 0;
        }, 'goal');
      }
    }
    // プレイヤーのウサギが喜んで跳ねる（短め: 2回・回転ひかえめ）
    for (let i = 0; i < 2; i++) {
      this.tween(0.4, 0.2 + i * 0.42, (t) => t, (k) => {
        this.rabbit.position.y = 0.22 + 0.9 * 4 * k * (1 - k);
        this.rabbit.rotation.y += 0.09;
      }, null, 'rabbit');
    }

    // 喜んだあと、2匹が向き合って見つめ合う
    if (bunny) {
      const shortest = (a) => Math.atan2(Math.sin(a), Math.cos(a));
      let s0 = null;
      this.tween(0.45, 1.1, easeInOut, (k) => {
        if (!s0) {
          const rp = this.rabbit.position;
          const bp = new THREE.Vector3();
          bunny.getWorldPosition(bp);
          s0 = {
            r0: this.rabbit.rotation.y,
            b0: bunny.rotation.y,
            rT: Math.atan2(bp.x - rp.x, bp.z - rp.z),
            bT: Math.atan2(rp.x - bp.x, rp.z - bp.z),
          };
        }
        this.rabbit.rotation.y = s0.r0 + shortest(s0.rT - s0.r0) * k;
        bunny.rotation.y = s0.b0 + shortest(s0.bT - s0.b0) * k;
      }, null, 'gaze');
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
    const p1 = this.worldPos(to.x, to.y, 0.22).project(this.camera);
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

    // 点滅リング
    const pulse = 0.55 + 0.45 * Math.sin(this.time * 5);
    for (const r of this.rings) {
      r.material.opacity = 0.35 + 0.55 * pulse;
      r.scale.setScalar(1 + 0.08 * pulse);
    }
    if (this.hintMarker) {
      this.hintMarker.material.opacity = 0.5 + 0.5 * Math.sin(this.time * 8);
    }

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
      // 金リングの明滅と旗の揺れ
      const glow = this.goalMesh.userData.glow;
      if (glow) {
        glow.material.opacity = 0.35 + 0.3 * Math.sin(this.time * 3);
        glow.scale.setScalar(1.12 + 0.06 * Math.sin(this.time * 3));
      }
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
      inner.scale.y = 1.18 * stretch;

      // ときどき耳ピクッ（ジャンプ中は後ろへなびく）
      const earT = (this.time + 1.7) % 3.4;
      const twitch = earT < 0.4 ? Math.sin((earT / 0.4) * Math.PI * 2) * 0.2 : 0;
      for (const e of this.rabbit.userData.ears) {
        e.mesh.rotation.x = e.baseX + twitch - 0.5 * this.jumpPose;
      }
    }
    for (const t of this.tileMeshes) {
      if (t.pickup) {
        t.pickup.userData.spin.rotation.y += dt * 2.5;
        t.pickup.userData.spin.position.y = 0.42 + Math.sin(this.time * 3 + t.idx) * 0.05;
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
