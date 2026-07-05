// ゲーム本体：状態管理、UI、セーブ/コンティニュー、ニンジン経済とスコア
import {
  generate,
  reachableFrom,
  findSolution,
  makeCode,
  parseCode,
} from './level.js';
import { GameScene } from './scene3d.js';
import { Sfx } from './sfx.js';

const SAVE_KEY = 'pyoncarrot_save_v1';

// ---------- ニンジン経済・スコアの定数（調整はここ） ----------
const COST_REWIND = 3; // まきもどしのニンジン消費
const COST_HINT = 5; // ヒントのニンジン消費
const SCORE_PER_CARROT = 10; // 残ニンジン1本あたりのスコア
const NO_HINT_BONUS = 100; // ヒント未使用クリアのボーナス
const scoreBase = (stage) => 100 + 20 * Math.min(stage, 30); // クリア基礎スコア(30で頭打ち)
const retryMult = (r) => (r === 0 ? 1.5 : r >= 3 ? 0.5 : 1.0); // リトライ倍率

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString('ja-JP');

export class Game {
  constructor() {
    this.scene = new GameScene($('c'));
    this.sfx = new Sfx();

    this.state = 'title'; // title | playing | busy | clear | over
    this.seed = 0;
    this.stage = 1;
    this.score = 0; // 累計スコア(セーブされる)
    this.hiscore = 0;
    this.carrots = 0; // このステージで食べたニンジン(持ち越しなし)
    this.retryCount = 0; // このステージのリトライ回数(倍率用)
    this.history = [];

    this.scene.onTileTap = (id) => this.tryMove(id);
    this._bindUI();
    this._loadSettings();
    this._showTitle();

    // 初回のタップ/クリックでiOSのオーディオを解錠する
    window.addEventListener(
      'pointerdown',
      () => this.sfx.unlock(),
      { once: true }
    );
  }

  // ---------- UI ----------
  _bindUI() {
    $('btn-start').onclick = () => {
      this.sfx.click();
      this.newGame();
    };
    $('btn-continue').onclick = () => {
      this.sfx.click();
      this._openContinue();
    };
    $('btn-help').onclick = () => {
      this.sfx.click();
      this._show('modal-help');
    };
    $('help-close').onclick = () => {
      this.sfx.click();
      this._hide('modal-help');
    };
    $('btn-code-go').onclick = () => this._continueFromCode();
    $('code-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._continueFromCode();
    });
    $('btn-paste').onclick = () => this._pasteCode();
    $('btn-share').onclick = () => {
      this.sfx.click();
      $('share-code').textContent = makeCode(this.seed, this.stage);
      this._show('modal-share');
    };
    $('btn-share-copy').onclick = () =>
      this._copyText($('share-code').textContent);
    $('share-close').onclick = () => {
      this.sfx.click();
      this._hide('modal-share');
    };
    $('btn-resume').onclick = () => {
      const save = this._loadSave();
      if (save) {
        this.sfx.click();
        this.seed = save.seed;
        this.stage = save.stage;
        this.score = save.score || 0;
        this.retryCount = 0;
        this._hide('modal-continue');
        this.startStage();
      }
    };
    $('continue-close').onclick = () => {
      this.sfx.click();
      this._hide('modal-continue');
    };
    $('btn-next').onclick = () => {
      this.sfx.click();
      this._cancelClearSeq();
      this.stage++;
      this.retryCount = 0;
      this._hide('modal-clear');
      this.startStage();
    };
    // 演出中にダイアログをタップしたら最後まで一気に表示
    $('modal-clear').addEventListener('click', (e) => {
      if (e.target.id !== 'btn-next' && this._finishClearSeq) {
        this._finishClearSeq();
      }
    });
    $('btn-retry-over').onclick = () => {
      this.sfx.click();
      this._hide('modal-over');
      this.retryStage();
    };
    $('btn-rewind-over').onclick = () => {
      this._hide('modal-over');
      this.state = 'playing';
      this.useRewind();
    };
    $('btn-title-over').onclick = () => {
      this.sfx.click();
      this._hide('modal-over');
      this._showTitle();
    };

    // HUDボタン
    $('btn-rewind').onclick = () => this.useRewind();
    $('btn-hint').onclick = () => this.useHint();
    $('btn-retry').onclick = () => {
      this.sfx.click();
      this.retryStage();
    };
    $('btn-sound').onclick = () => {
      this.sfx.enabled = !this.sfx.enabled;
      $('btn-sound').classList.toggle('on', this.sfx.enabled);
      $('btn-sound').textContent = this.sfx.enabled ? '♪' : '×';
      this.sfx.click();
      this._saveSettings();
    };
    $('btn-help-hud').onclick = () => {
      this.sfx.click();
      this._show('modal-help');
    };
    $('btn-home').onclick = () => {
      this.sfx.click();
      this._showTitle();
    };

    window.addEventListener('keydown', (e) => this._key(e));
  }

  _key(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      if (this.state === 'clear') {
        $('btn-next').click();
        e.preventDefault();
        return;
      }
      if (this.state === 'title' && !this._modalOpen()) {
        $('btn-start').click();
        return;
      }
    }
    if (this.state !== 'playing' || this._modalOpen()) return;
    const dirMap = {
      ArrowUp: [0, 1],
      ArrowDown: [0, -1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      w: [0, 1],
      s: [0, -1],
      a: [-1, 0],
      d: [1, 0],
    };
    if (dirMap[e.key]) {
      e.preventDefault();
      this._moveByScreenDir(dirMap[e.key]);
    } else if (e.key === 'r' || e.key === 'R') {
      this.retryStage();
    } else if (e.key === 'z' || e.key === 'Z' || e.key === 'u' || e.key === 'U') {
      this.useRewind();
    } else if (e.key === 'h' || e.key === 'H') {
      this.useHint();
    } else if (e.key === 'm' || e.key === 'M') {
      $('btn-sound').click();
    }
  }

  // 画面上の見た目の方向で最も近い行き先を選ぶ
  _moveByScreenDir([dx, dy]) {
    let best = null;
    for (const id of this.reachable) {
      const d = this.scene.screenDirTo(id);
      const len = Math.hypot(d.x, d.y) || 1;
      const dot = (d.x / len) * dx + (d.y / len) * dy;
      if (dot > 0.45 && (!best || dot > best.dot)) best = { id, dot };
    }
    if (best) this.tryMove(best.id);
  }

  _modalOpen() {
    return [
      'modal-help',
      'modal-continue',
      'modal-clear',
      'modal-over',
      'modal-share',
    ].some((id) => !$(id).classList.contains('hidden'));
  }

  _show(id) {
    $(id).classList.remove('hidden');
  }
  _hide(id) {
    $(id).classList.add('hidden');
  }

  _toast(msg, ms = 1800) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
  }

  _showTitle() {
    this.state = 'title';
    this._hideTutorial(false);
    this._show('screen-title');
    this._hide('hud');
    const hi = $('title-hiscore');
    if (this.hiscore > 0) {
      hi.textContent = `ハイスコア ${fmt(this.hiscore)}`;
      hi.classList.remove('hidden');
    } else {
      hi.classList.add('hidden');
    }
  }

  _openContinue() {
    const save = this._loadSave();
    const info = $('resume-info');
    if (save) {
      info.classList.remove('hidden');
      $('btn-resume').textContent = `前回のつづきから（ステージ ${save.stage}）`;
    } else {
      info.classList.add('hidden');
    }
    $('code-input').value = '';
    this._show('modal-continue');
    if (!save) $('code-input').focus();
  }

  _continueFromCode() {
    const parsed = parseCode($('code-input').value);
    if (!parsed) {
      this._toast('コードの形式が違います（例: 1234-5）');
      return;
    }
    this.sfx.click();
    this.seed = parsed.seed;
    this.stage = parsed.stage;
    this.score = 0; // コード再開はスコア0から(コードにはスコアは含まれない)
    this.retryCount = 0;
    this._hide('modal-continue');
    this.startStage();
  }

  // ---------- クリップボード ----------
  async _copyText(text) {
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch (e) {}
    if (!ok) {
      // http配信などクリップボードAPIが使えない環境向けフォールバック
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand('copy');
      } catch (e) {}
      ta.remove();
    }
    if (ok) this.sfx.click();
    this._toast(ok ? `コード ${text} をコピーしました 📋` : 'コピーできませんでした');
  }

  async _pasteCode() {
    const input = $('code-input');
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) throw 0;
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) throw 0;
      input.value = text;
      this.sfx.click();
      if (!parseCode(text)) this._toast('コード形式ではないようです');
    } catch (e) {
      // 読み取り不可(非対応ブラウザ・権限拒否など)は手動ペーストを案内
      input.focus();
      this._toast('入力欄で長押し（PCはCtrl+V）で貼り付けてください');
    }
  }

  // ---------- ゲーム進行 ----------
  newGame() {
    this.seed = 1000 + Math.floor(Math.random() * 9000);
    this.stage = 1;
    this.score = 0;
    this.retryCount = 0;
    this.startStage();
  }

  startStage() {
    this.level = generate(this.seed, this.stage);
    this.alive = this.level.tiles.map((_, i) => i !== 0);
    this.cur = 0;
    this.carrots = 0; // ニンジンは持ち越さない
    this.hintsUsed = 0;
    this.history = [];

    this._hide('screen-title');
    this._show('hud');
    this.scene.buildStage(this.level);
    // 数字とグリッドは常時ON
    this.scene.setNumbersVisible(true);
    this.scene.setGridVisible(true);
    this._save();
    this._updateHUD();

    this._hideTutorial(false);

    // 白ウサギの登場シーン（操作キャラだと分かるように毎ステージ再生）
    this.state = 'busy';
    this.sfx.warp();
    this.scene.playEntrance().then(() => {
      // 登場したらスタートマスのニンジンをまず1口
      this._eatTile(0);
      this.state = 'playing';
      this._updateHUD();
      this._updateReachable();
      this._maybeShowHeightTutorial();
    });
  }

  retryStage() {
    if (this.state === 'busy') return;
    this.retryCount++;
    this.startStage();
  }

  // マスのニンジンを食べる(各マス1回だけ。まきもどしても2回目はなし)
  _eatTile(idx) {
    const tile = this.level.tiles[idx];
    if (tile.eaten) return;
    tile.eaten = true;
    this.carrots += tile.value;
    this.scene.eatCarrots(idx);
    this._carrotPop(tile.x, tile.y, tile.value);
  }

  // 「+N🥕」のポップ表示
  _carrotPop(gx, gy, n) {
    const p = this.scene.projectToScreen(gx, gy, 1.0);
    const el = document.createElement('div');
    el.className = 'carrot-pop';
    el.textContent = `+${n}🥕`;
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    $('game-wrap').appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  // ---------- 段差の初回チュートリアル ----------
  // 段差のあるステージを初めて遊ぶとき、一番高いマスに吹き出しを出す。
  // ウサギを動かしたら消えて、以降は表示しない。
  _maybeShowHeightTutorial() {
    try {
      if (localStorage.getItem(SAVE_KEY + '_tut_h')) return;
    } catch (e) {}
    let anchor = null;
    let best = 0;
    for (const t of this.level.tiles) {
      const h = this.level.heights[t.x][t.y];
      if (h > best) {
        best = h;
        anchor = t;
      }
    }
    if (!anchor) return; // 段差のないステージ
    const el = $('tut-balloon');
    const p = this.scene.projectToScreen(anchor.x, anchor.y, 1.5);
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.classList.remove('hidden');
    this._tutShown = true;
  }

  _hideTutorial(learned) {
    if (!this._tutShown) return;
    $('tut-balloon').classList.add('hidden');
    this._tutShown = false;
    if (learned) {
      try {
        localStorage.setItem(SAVE_KEY + '_tut_h', '1');
      } catch (e) {}
    }
  }

  // ---------- HUD ----------
  _updateHUD() {
    $('hud-stage').textContent = this.stage;
    $('hud-score').textContent = fmt(this.score);
    $('hud-count').textContent = this.carrots;
    $('btn-rewind').classList.toggle(
      'disabled',
      this.carrots < COST_REWIND || !this.history.length
    );
    $('btn-hint').classList.toggle('disabled', this.carrots < COST_HINT);
  }

  _updateReachable() {
    this.reachable = reachableFrom(this.level, this.alive, this.cur);
    this.scene.setReachable(this.reachable);

    if (this.reachable.length === 0) {
      // 詰み
      this.state = 'over';
      this.scene.sadHop();
      this.sfx.gameover();
      $('over-msg').textContent = 'これ以上すすめません…';
      $('over-score').textContent = fmt(this.score);
      $('btn-rewind-over').classList.toggle(
        'hidden',
        !(this.carrots >= COST_REWIND && this.history.length > 0)
      );
      setTimeout(() => this._show('modal-over'), 700);
    }
  }

  async tryMove(id) {
    if (this.state !== 'playing') return;
    if (!this.reachable.includes(id)) return;

    this._hideTutorial(true); // ウサギを動かしたら吹き出しは消える
    this.state = 'busy';
    this.scene.clearRings();
    this.scene.clearHint();
    this.history.push({ cur: this.cur });

    this.sfx.hop();
    const fromIdx = this.cur;
    this.alive[fromIdx] = false; // 元いたマスは消える(スタート地点はalive[0]=false済)

    await this.scene.jumpTo(fromIdx, id);
    this.sfx.land();

    if (id === 'goal') {
      this._onClear();
      return;
    }

    this.cur = id;
    this.alive[id] = false; // 乗っているマスには飛べない
    this._eatTile(id); // ニンジンをパクッ(+value)

    this.state = 'playing';
    this._updateHUD();
    this._updateReachable();
  }

  _onClear() {
    this.state = 'clear';
    this.scene.celebrate();
    this.sfx.clear();

    // スコア計算: (基礎 + 残ニンジン×10 + ノーヒントボーナス) × リトライ倍率
    const base = scoreBase(this.stage);
    const carrotBonus = this.carrots * SCORE_PER_CARROT;
    const noHint = this.hintsUsed === 0 ? NO_HINT_BONUS : 0;
    const mult = retryMult(this.retryCount);
    const gain = Math.round((base + carrotBonus + noHint) * mult);
    this.score += gain;
    if (this.score > this.hiscore) {
      this.hiscore = this.score;
      this._saveSettings();
    }

    $('clear-stage').textContent = this.stage;
    // 次ステージを先にセーブ（途中で閉じても続きから遊べる）
    this._save(this.stage + 1);
    // 見つめ合い→一緒に喜ぶ演出が見えてからダイアログを出す
    setTimeout(() => {
      if (this.state !== 'clear') return;
      this._show('modal-clear');
      this._playClearSequence({ base, carrotBonus, noHint, mult, gain });
    }, 1500);
  }

  // クリアの内訳を1行ずつ「ドンッ」と見せる演出
  _playClearSequence(d) {
    this._cancelClearSeq();
    const timers = (this._seqTimers = []);
    const later = (ms, fn) => timers.push(setTimeout(fn, ms));

    const rows = {
      base: $('sb-base-row'),
      carrots: $('sb-carrots-row'),
      nohint: $('sb-nohint-row'),
      mult: $('sb-mult-row'),
      total: $('sb-total-row'),
      cum: $('sb-cum-row'),
    };
    // 出ない行は非表示、出る行は「待機」状態に
    rows.nohint.classList.toggle('hidden', !d.noHint);
    rows.mult.classList.toggle('hidden', d.mult === 1);
    for (const r of Object.values(rows)) {
      r.classList.remove('sb-pop');
      if (!r.classList.contains('hidden')) r.classList.add('sb-wait');
    }

    // 値をセット（ニンジンはカウントアップで後から入る）
    $('sb-base').textContent = `+${fmt(d.base)}`;
    $('sb-carrots-n').textContent = 0;
    $('sb-carrots').textContent = '+0';
    $('sb-nohint').textContent = `+${fmt(NO_HINT_BONUS)}`;
    if (d.mult !== 1) {
      $('sb-mult-label').textContent =
        d.mult > 1 ? 'ノーリトライボーナス' : `リトライ${this.retryCount}回`;
      $('sb-mult').textContent = `×${d.mult}`;
    }
    $('sb-total').textContent = `+${fmt(d.gain)}`;
    $('sb-cum').textContent = fmt(this.score);

    const pop = (row) => {
      row.classList.remove('sb-wait');
      row.classList.add('sb-pop');
      this.sfx.thud();
    };

    later(200, () => pop(rows.base));
    later(600, () => {
      pop(rows.carrots);
      this._flyCarrots(this.carrots);
      this._countUpCarrots(this.carrots);
    });
    let t = 1750;
    if (d.noHint) {
      later(t, () => pop(rows.nohint));
      t += 380;
    }
    if (d.mult !== 1) {
      later(t, () => pop(rows.mult));
      t += 380;
    }
    later(t + 120, () => {
      pop(rows.total);
      this.sfx.pickup();
    });
    later(t + 500, () => {
      pop(rows.cum);
      $('hud-score').textContent = fmt(this.score);
      this._finishClearSeq = null;
    });

    // タップで最後まで一気に表示
    this._finishClearSeq = () => {
      this._cancelClearSeq();
      for (const r of Object.values(rows)) {
        if (!r.classList.contains('hidden')) {
          r.classList.remove('sb-wait');
          r.classList.add('sb-pop');
        }
      }
      $('sb-carrots-n').textContent = this.carrots;
      $('sb-carrots').textContent = `+${fmt(d.carrotBonus)}`;
      $('hud-count').textContent = 0;
      $('hud-score').textContent = fmt(this.score);
      this._finishClearSeq = null;
    };
  }

  _cancelClearSeq() {
    if (this._seqTimers) for (const t of this._seqTimers) clearTimeout(t);
    this._seqTimers = null;
    this._countUpStop = true;
    this._finishClearSeq = null;
    document.querySelectorAll('.fly-carrot').forEach((e) => e.remove());
  }

  // 残ニンジンのカウントアップ(HUD側はカウントダウン)
  _countUpCarrots(total) {
    this._countUpStop = false;
    const dur = 900;
    const start = performance.now();
    const tick = (now) => {
      if (this._countUpStop) return;
      const k = Math.min(1, (now - start) / dur);
      const n = Math.round(total * k);
      $('sb-carrots-n').textContent = n;
      $('sb-carrots').textContent = `+${fmt(n * SCORE_PER_CARROT)}`;
      $('hud-count').textContent = total - n;
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // HUDの🥕チップからスコアボードのニンジン行へ、🥕が弧を描いて集まってくる
  _flyCarrots(n) {
    if (n <= 0) return;
    const wrap = $('game-wrap');
    const wr = wrap.getBoundingClientRect();
    const s = $('hud-count').getBoundingClientRect();
    const dRect = $('sb-carrots-n').getBoundingClientRect();
    const sx = s.left + s.width / 2 - wr.left;
    const sy = s.top + s.height / 2 - wr.top;
    const dx = dRect.left + dRect.width / 2 - wr.left;
    const dy = dRect.top + dRect.height / 2 - wr.top;
    const count = Math.min(10, n);
    const flightDur = 480;

    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'fly-carrot';
      el.textContent = '🥕';
      el.style.left = `${sx}px`;
      el.style.top = `${sy}px`;
      el.style.transform = 'translate(-50%, -50%)';
      wrap.appendChild(el);
      // 少し横へ膨らむ制御点で弧を描く（1匹ずつ膨らみを変える）
      const cx = (sx + dx) / 2 - 60 - (i % 3) * 25;
      const cy = (sy + dy) / 2 - 20 + (i % 2) * 30;
      const t0 = performance.now() + i * 70;

      const fly = (now) => {
        if (!el.isConnected && now > t0) return;
        const k = (now - t0) / flightDur;
        if (k < 0) {
          requestAnimationFrame(fly);
          return;
        }
        if (k >= 1) {
          el.remove();
          // 着地で数字がプルンと弾む
          const target = $('sb-carrots-n').parentElement;
          target.classList.remove('sb-bump');
          void target.offsetWidth; // アニメ再生し直しのためのリフロー
          target.classList.add('sb-bump');
          return;
        }
        // 2次ベジェ
        const u = 1 - k;
        const x = u * u * sx + 2 * u * k * cx + k * k * dx;
        const y = u * u * sy + 2 * u * k * cy + k * k * dy;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.style.transform = `translate(-50%, -50%) scale(${1 - 0.35 * k}) rotate(${k * 220}deg)`;
        requestAnimationFrame(fly);
      };
      requestAnimationFrame(fly);
    }
  }

  // ---------- アイテム（ニンジン消費） ----------
  async useRewind() {
    if (this.state !== 'playing') return;
    if (!this.history.length) {
      this._toast('もどれる手がありません');
      return;
    }
    if (this.carrots < COST_REWIND) {
      this._toast(`ニンジンが足りません（まきもどしは${COST_REWIND}本）`);
      return;
    }
    this.state = 'busy';
    this.carrots -= COST_REWIND;
    this.sfx.rewind();
    this.scene.clearRings();
    this.scene.clearHint();

    const prev = this.history.pop();
    const fromId = this.cur;
    // 今いたマスはフィールドに残る（また飛び先の候補になる。ニンジンは食べたあとなので戻らない）
    this.alive[fromId] = true;
    // 戻り先のマスはウサギが乗るので alive は false のまま
    await this.scene.rewindTo(prev.cur, fromId);

    this.cur = prev.cur;
    this.state = 'playing';
    this._updateHUD();
    this._updateReachable();
  }

  useHint() {
    if (this.state !== 'playing') return;
    if (this.carrots < COST_HINT) {
      this._toast(`ニンジンが足りません（ヒントは${COST_HINT}本）`);
      return;
    }
    const path = findSolution(this.level, this.alive, this.cur);
    if (!path) {
      this._toast('この状態ではクリアできません。まきもどしを使おう！');
      return;
    }
    this.carrots -= COST_HINT;
    this.hintsUsed++;
    this.sfx.hint();
    this.scene.showHint(path[0]);
    this._updateHUD();
  }

  // ---------- セーブ ----------
  _save(stage = this.stage) {
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({ seed: this.seed, stage, score: this.score })
      );
    } catch (e) {}
  }

  _loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d.seed || !d.stage) return null;
      return d;
    } catch (e) {
      return null;
    }
  }

  _saveSettings() {
    try {
      localStorage.setItem(
        SAVE_KEY + '_opt',
        JSON.stringify({ sound: this.sfx.enabled, hiscore: this.hiscore })
      );
    } catch (e) {}
  }

  _loadSettings() {
    try {
      const raw = localStorage.getItem(SAVE_KEY + '_opt');
      if (raw) {
        const d = JSON.parse(raw);
        this.sfx.enabled = d.sound !== false;
        this.hiscore = d.hiscore || 0;
      }
    } catch (e) {}
    $('btn-sound').classList.toggle('on', this.sfx.enabled);
    $('btn-sound').textContent = this.sfx.enabled ? '♪' : '×';
  }
}
