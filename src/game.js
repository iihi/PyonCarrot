// ゲーム本体：状態管理、UI、セーブ/コンティニュー、ニンジン経済とスコア
import {
  generate,
  reachableFrom,
  findSolution,
  landStance,
  stanceFromTile,
  makeCode,
  parseCode,
  GOLD_MULT,
  seasonForStage,
} from './level.js';
import { GameScene } from './scene3d.js';
import { Sfx } from './sfx.js';
import { TUTORIAL_STEPS } from './tutorial.js';

const SAVE_KEY = 'pyoncarrot_save_v1';

// ---------- スコアの定数（調整はここ） ----------
const SCORE_PER_CARROT = 10; // 残ニンジン1本あたりのスコア
const PERFECT_BONUS = 300; // 全マス回収クリア(じっくり派)
const SPEED_BONUS = 300; // 最短手数+1以内クリア(駆け抜け派)
const retryMult = (r) => (r === 0 ? 1.5 : r >= 3 ? 0.5 : 1.0); // リトライ倍率

// 季節の導入説明(季節の頭で1枚はさむ)
const SEASON_INTRO = {
  spring: { emoji: '🌸', name: '春', color: '#ff9ec7', text: 'まずは基本！<br>ニンジンを集めて、ゴールでまつ<b>ピンクのウサギ</b>をめざそう。' },
  summer: { emoji: '☀️', name: '夏', color: '#2fb2e0', text: '<b>ジャンプ台</b>とうじょう！<br>のって飛ぶと<b>2マス遠く</b>までとべるよ。' },
  autumn: { emoji: '🍂', name: '秋', color: '#e0842f', text: '<b>つむじ風</b>があらわれた！<br>のると対(つい)の<b>落ち葉マス</b>まで<br>ビュ〜ンと運ばれるよ。' },
  winter: { emoji: '❄️', name: '冬', color: '#4aa3d6', text: '<b>ソリ</b>にのって、進んだ方向へすべって、<br>かべ(段差や畑)の手前で止まる。<br>止まった所から<b>数字ぶん</b>ジャンプ！' },
  allin: { emoji: '🎊', name: 'ぜんぶ！', color: '#7c5cff', text: 'ここからは<b>ぜんぶ</b>でてくる！' },
};

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

    this.scene.onTileTap = (id) => this.tryMove(id);
    this._bindUI();
    this._bindDebug();
    this._loadSettings();
    this._showTitle();

    // シェアカード用にロゴを先読み(失敗しても文字で代替するので待たない)
    this._logoImg = new Image();
    this._logoImg.src = './logo.png';

    // 初回のタップ/クリックでiOSのオーディオを解錠する
    window.addEventListener(
      'pointerdown',
      () => this.sfx.unlock(),
      { once: true }
    );
  }

  // ---------- デバッグモード ----------
  // 本番では非表示。有効化は URL に #debug を付けるか、Dキーを3回連打。
  _bindDebug() {
    const panel = $('debug-panel');
    const enable = () => {
      this._debug = true;
      panel.classList.remove('hidden');
      this._dbgUpdate();
    };
    if (location.hash.toLowerCase().includes('debug')) enable();

    // Dキー3連打(1.2秒以内)で有効化
    let taps = [];
    window.addEventListener('keydown', (e) => {
      if (e.key === 'd' || e.key === 'D') {
        const now = performance.now();
        taps = taps.filter((t) => now - t < 1200);
        taps.push(now);
        if (taps.length >= 3 && !this._debug) enable();
      }
    });

    const jump = (stage) => {
      if (!this._debug) return;
      this.stage = Math.max(1, Math.min(999, stage));
      if (!this.seed) this.seed = 1000 + Math.floor(Math.random() * 9000);
      this.score = 0;
      this.retryCount = 0;
      this._hide('modal-clear');
      this._hide('modal-over');
      this._cancelClearSeq();
      this.startStage();
      this._dbgUpdate();
    };

    $('dbg-close').onclick = () => panel.classList.add('hidden');
    $('dbg-go').onclick = () => {
      const v = parseInt($('dbg-stage').value, 10);
      if (v >= 1) jump(v);
    };
    $('dbg-prev').onclick = () => jump(this.stage - 1);
    $('dbg-next').onclick = () => jump(this.stage + 1);
    $('dbg-skip10').onclick = () => jump(this.stage + 10);
    $('dbg-seed-go').onclick = () => {
      const v = parseInt($('dbg-seed').value, 10);
      if (v >= 1000 && v <= 9999) {
        this.seed = v;
        jump(this.stage);
      }
    };
    $('dbg-solve').onclick = () => this._dbgAutoSolve();
  }

  _dbgUpdate() {
    if (!this._debug) return;
    const info = $('dbg-info');
    if (this.level) {
      info.textContent = `seed ${this.seed} / stage ${this.stage} / code ${makeCode(
        this.seed,
        this.stage
      )} / minMoves ${this.level.minMoves}`;
    }
  }

  // ヒント用ソルバーの経路をそのまま自動再生してクリアする
  async _dbgAutoSolve() {
    if (!this._debug || this.state !== 'playing') return;
    let guard = 0;
    while (this.state === 'playing' && guard++ < 60) {
      const path = findSolution(this.level, this.alive, this.stance);
      if (!path || !path.length) break;
      const step = path[0];
      if (!this.reachable.includes(step)) break;
      await this.tryMove(step);
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  // ---------- UI ----------
  _bindUI() {
    $('btn-start').onclick = () => {
      this.sfx.click();
      // 初回だけチュートリアルを先に通す(完走/スキップで以降は出ない)
      let seen = false;
      try {
        seen = !!localStorage.getItem(SAVE_KEY + '_tut_seen');
      } catch (e) {}
      if (!seen) this._startTutorial(false);
      else this.newGame();
    };
    $('btn-tutorial').onclick = () => {
      this.sfx.click();
      this._startTutorial(true);
    };
    $('btn-tut-skip').onclick = () => {
      this.sfx.click();
      if (this._tut) this._tutEnd(false);
    };
    $('btn-tut-done').onclick = () => {
      this.sfx.click();
      this._hide('modal-tut-done');
      if (this._tutDoneFromTitle) this._showTitle();
      else this.newGame();
    };
    $('btn-tut-next').onclick = () => {
      this.sfx.click();
      if (this._tut) this._tutAdvance();
    };
    $('btn-continue').onclick = () => {
      this.sfx.click();
      this._openContinue();
    };
    $('btn-help').onclick = () => {
      this.sfx.click();
      this._show('modal-help');
    };
    // バージョン情報・著作権(タイトル画面)
    $('btn-version').onclick = () => {
      this.sfx.click();
      $('ver-app').textContent = document.title;
      $('ver-num').textContent =
        'v' + (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0');
      this._show('modal-version');
    };
    $('version-close').onclick = () => {
      this.sfx.click();
      this._hide('modal-version');
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
        // クリア後に閉じた場合などセーブ済みスコアがハイスコア未反映のことがある
        if (this.score > this.hiscore) {
          this.hiscore = this.score;
          this._saveSettings();
        }
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
      // このステージの結果を確定(ハイスコア更新)
      if (this.score > this.hiscore) {
        this.hiscore = this.score;
        this._saveSettings();
      }
      this._lastGain = 0;
      this.stage++;
      this.retryCount = 0;
      this._hide('modal-clear');
      this.startStage();
    };
    // クリア後の「もういちど」: 得たスコアを取り消して同じステージを仕切り直し(ペナルティなし)
    $('btn-clear-retry').onclick = () => {
      this.sfx.click();
      this._cancelClearSeq();
      this.score -= this._lastGain || 0;
      this._lastGain = 0;
      this.retryCount = 0;
      this._hide('modal-clear');
      this._save(); // 進行セーブも現ステージに巻き戻す
      this.startStage();
    };
    // クリア後のコード共有(難しかったステージの共有用): 下部と同じコードDLGを出す
    $('btn-clear-copy').onclick = () => {
      this.sfx.click();
      $('share-code').textContent = makeCode(this.seed, this.stage);
      this._show('modal-share');
    };
    // SNSシェア(結果カード画像+テキストをOSの共有シートへ)
    $('btn-clear-share').onclick = () => {
      this.sfx.click();
      this._shareResult();
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
    $('btn-title-over').onclick = () => {
      this.sfx.click();
      this._hide('modal-over');
      this._showTitle();
    };
    // 季節の説明画面を閉じて、そのステージへ登場
    $('btn-season-go').onclick = () => {
      this.sfx.click();
      this._hide('modal-season');
      this._beginEntrance();
    };

    // HUDボタン
    $('btn-retry').onclick = () => {
      this.sfx.click();
      this.retryStage();
    };
    $('btn-sound').onclick = () => {
      this.sfx.setEnabled(!this.sfx.enabled);
      $('btn-sound').classList.toggle('on', this.sfx.enabled);
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

    // チュートリアル吹き出しは画面のどこかをタップしても消える(うさぎを動かさなくてOK)
    window.addEventListener('pointerdown', () => {
      if (this._tutShown) this._hideTutorial(true);
    });
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
      'modal-version',
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
    this.sfx.stopBgm(); // タイトルに戻ったらBGMは止める
    this._lastIntroKey = null; // 次に始めたら季節説明を出し直す
    this._hideTutorial(false);
    // チュートリアル途中でタイトルへ戻ったら中断(次の「はじめから」でまた出る)
    this._tut = null;
    this._hide('tut-panel');
    $('btn-share').classList.remove('hidden');
    this._cancelClearSeq();
    for (const id of ['modal-help', 'modal-continue', 'modal-clear', 'modal-over', 'modal-share', 'modal-season', 'modal-version', 'modal-tut-done']) {
      this._hide(id);
    }
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
      this._toast('コードが正しくありません（例: MWD-H4F）');
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

  // ---------- チュートリアル(通しコース) ----------
  // 基本3ステップ+ギミック4ステップを、手書きの極小盤面で順に体験する。
  // 入り口は2つ: 初回の「はじめから」(フラグ保存で1回だけ) と タイトルの「チュートリアル」。
  // 本編の状態(セーブ・スコア・コード)には一切触らない。
  _startTutorial(fromTitle) {
    this._tut = { on: true, fromTitle, idx: 0 };
    this.sfx.startBgm();
    this._hide('screen-title');
    this._hide('modal-help');
    this._show('hud');
    $('btn-share').classList.add('hidden'); // コードは意味がないので隠す
    $('btn-tut-skip').textContent = fromTitle ? 'スキップしてタイトルへ' : 'スキップしてゲームへ';
    this._show('tut-panel');
    this._tutBuildStep();
  }

  _tutBuildStep() {
    const step = TUTORIAL_STEPS[this._tut.idx];
    $('tut-step-no').textContent = `チュートリアル ${this._tut.idx + 1} / ${TUTORIAL_STEPS.length}`;
    $('tut-text').innerHTML = step.text;
    $('btn-tut-next').classList.toggle('hidden', !step.info);
    // 読むだけのステップ: 盤面はさわらず(直前のお祝いがそのまま背景)、「つぎへ」で進む
    if (step.info) {
      this.state = 'busy';
      this._hideTutorial(false);
      return;
    }
    // 盤面はプレイで書き換わる(eaten等)ので、毎回コピーから作る
    this.level = JSON.parse(JSON.stringify(step.level));
    this.alive = this.level.tiles.map((_, i) => i !== 0);
    this.curIdx = 0;
    this.stance = stanceFromTile(this.level, 0);
    this.carrots = 0;
    this.moves = 0;
    this.scene.buildStage(this.level);
    this.scene.setNumbersVisible(true);
    this.scene.setGridVisible(true);
    this._hideTutorial(false);
    this._updateHUD(); // ステージ表示を「-」へ即時更新(登場アニメ完了を待たない)
    this._beginEntrance();
  }

  // 移動が確定するたびに完了条件をチェック。完了なら次のステップへ(trueを返す)。
  _tutAfterMove(landedId) {
    const step = TUTORIAL_STEPS[this._tut.idx];
    const d = step.done;
    const hit =
      (d.on === 'goal' && landedId === 'goal') ||
      (d.on === 'tile' && landedId === d.idx);
    if (!hit) return false;
    this.state = 'busy';
    this._updateHUD();
    if (landedId === 'goal') this.sfx.clear();
    // 「できた！」を味わってから次へ(切り替わりが早すぎるFB対応)
    setTimeout(() => this._tutAdvance(), landedId === 'goal' ? 2000 : 1000);
    return true;
  }

  _tutAdvance() {
    if (!this._tut) return; // スキップ等で終了済み
    this._tut.idx++;
    if (this._tut.idx >= TUTORIAL_STEPS.length) {
      this._tutEnd(true);
      return;
    }
    this._tutBuildStep();
  }

  _tutEnd(completed) {
    const fromTitle = this._tut && this._tut.fromTitle;
    this._tut = null;
    try {
      localStorage.setItem(SAVE_KEY + '_tut_seen', '1');
    } catch (e) {}
    this._hide('tut-panel');
    $('btn-share').classList.remove('hidden');
    // スキップは即座に遷移。完走したら「おつかれさま」の一枚を挟んでボタンで進む
    if (!completed) {
      if (fromTitle) this._showTitle();
      else this.newGame();
      return;
    }
    this.state = 'busy';
    this._tutDoneFromTitle = fromTitle;
    $('btn-tut-done').textContent = fromTitle ? 'タイトルへもどる' : 'さっそくあそぶ！';
    this._show('modal-tut-done');
  }

  // ---------- ゲーム進行 ----------
  newGame() {
    this.seed = 1000 + Math.floor(Math.random() * 9000);
    this.stage = 1;
    this.score = 0;
    this.retryCount = 0;
    this._lastIntroKey = null;
    this.startStage();
  }

  startStage() {
    this.sfx.startBgm(); // ゲーム中はBGMをループ再生(ボタン操作直後なので自動再生OK)
    this.level = generate(this.seed, this.stage);
    this.alive = this.level.tiles.map((_, i) => i !== 0);
    this.curIdx = 0; // 立っているマス(空きマスなら -1)
    this.stance = stanceFromTile(this.level, 0);
    this.carrots = 0; // ニンジンは持ち越さない
    this.moves = 0; // これまでの手数(スピードボーナス用)

    this._hide('screen-title');
    this._show('hud');
    this.scene.buildStage(this.level);
    // 数字とグリッドは常時ON
    this.scene.setNumbersVisible(true);
    this.scene.setGridVisible(true);
    this._save();
    this._updateHUD();
    this._dbgUpdate();

    this._hideTutorial(false);

    this.state = 'busy';
    // 季節の切り替わりでは、先に一枚の説明画面を挟んでから登場させる
    const introKey = this._seasonIntroKey(this.stage);
    if (introKey && introKey !== this._lastIntroKey) {
      this._lastIntroKey = introKey;
      this._showSeasonIntro(introKey);
    } else {
      this._beginEntrance();
    }
  }

  // 白ウサギの登場シーン（操作キャラだと分かるように毎ステージ再生）
  _beginEntrance() {
    this.state = 'busy';
    this.sfx.warp();
    this.scene.playEntrance().then(() => {
      // 登場したらスタートマスのニンジンをまず1口
      this._eatTile(0);
      this.curIdx = 0;
      this.stance = stanceFromTile(this.level, 0);
      this.scene.setOnSpring(!!this.level.tiles[0].spring);
      this.state = 'playing';
      this._updateHUD();
      this._updateReachable();
      this._maybeShowGimmickTutorial();
    });
  }

  // 季節の説明画面を出すべきステージなら季節キーを返す(春/夏/秋/冬の頭 と 21面=全部入り)
  _seasonIntroKey(stage) {
    if (stage === 21) return 'allin';
    if (stage <= 20 && (stage - 1) % 5 === 0) return seasonForStage(stage);
    return null;
  }

  _showSeasonIntro(key) {
    const info = SEASON_INTRO[key];
    $('season-emoji').textContent = info.emoji;
    $('season-name').textContent = info.name;
    $('season-text').innerHTML = info.text;
    const box = $('modal-season').querySelector('.season-box');
    box.style.setProperty('--season-color', info.color);
    this._show('modal-season');
  }

  retryStage() {
    if (this.state === 'busy') return;
    // チュートリアル中は同じステップをやり直すだけ(回数もスコアも関係なし)
    if (this._tut && this._tut.on) {
      this._tutBuildStep();
      return;
    }
    this.retryCount++;
    this.startStage();
  }

  // マスのニンジンを食べる(各マス1回だけ。まきもどしても2回目はなし)
  _eatTile(idx) {
    const tile = this.level.tiles[idx];
    if (tile.eaten) return;
    tile.eaten = true;
    const gain = tile.golden ? tile.value * GOLD_MULT : tile.value;
    this.carrots += gain;
    this.scene.eatCarrots(idx);
    this._carrotPop(tile.x, tile.y, gain);
    if (tile.golden) {
      this._toastOnce('_tut_gold', `大ニンジン！✨ 1本で${GOLD_MULT}本分！`);
    }
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

  // ---------- ギミックの初回チュートリアル吹き出し ----------
  // 段差・ジャンプ台・トロッコが初めて登場するステージで、該当マスに吹き出しを出す。
  // ウサギを動かしたら消えて、以降は表示しない。1ステージにつき1件（優先順）。
  _maybeShowGimmickTutorial() {
    // 通しチュートリアル中は説明パネルがあるので吹き出しは出さない
    if (this._tut && this._tut.on) return;
    const TUTS = [
      {
        flag: '_tut_h',
        pick: (t) => this.level.heights[t.x][t.y] > 0,
        prefer: (t) => this.level.heights[t.x][t.y] * 20,
        html: '⛰️ 高いところへ上るには<br />パワーが<b>1つ多く</b>ひつよう！<br />降りるときは<b>1つ遠くへ</b>飛べるよ',
      },
      {
        flag: '_tut_spring',
        pick: (t) => !!t.spring,
        prefer: () => 0,
        html: '🦘 <b>ジャンプ台</b>のマス！<br />ここから飛ぶと<b>2マス遠くまで</b>とべるよ',
      },
      {
        flag: '_tut_cart',
        pick: (t) => !!t.cart,
        prefer: () => 0,
        html: '🛒 <b>トロッコ</b>のマス！乗ると<b>進んだ方向</b>へ<br />走って、かべ(段差や畑)の手前で止まるよ。<br />止まった所から<b>数字ぶん</b>ジャンプ！',
      },
      {
        flag: '_tut_whirl',
        pick: (t) => !!t.whirl,
        prefer: () => 0,
        html: '🌪️ <b>つむじ風</b>のマス！のると対(つい)の<br /><b>落ち葉マス</b>までビュ〜ンと運ばれるよ',
      },
    ];

    for (const tut of TUTS) {
      try {
        if (localStorage.getItem(SAVE_KEY + tut.flag)) continue;
      } catch (e) {}
      const cands = this.level.tiles.filter(tut.pick);
      if (!cands.length) continue;

      const cw = this.scene.canvas.clientWidth;
      // 避けたい場所: プレイヤーうさぎ・次に飛べるマス
      const avoid = [this.scene.projectToScreen(this.stance.x, this.stance.y, 0.6)];
      for (const id of this.reachable || []) {
        const t = id === 'goal' ? this.level.goal : this.level.tiles[id];
        avoid.push(this.scene.projectToScreen(t.x, t.y, 0.4));
      }

      // 吹き出し(幅約240px・高さ約90px)の中心が避けたい点から遠い候補を選ぶ
      let best = null;
      for (const t of cands) {
        const p = this.scene.projectToScreen(t.x, t.y, 1.5);
        const bx = Math.min(Math.max(p.x, 132), cw - 132); // 画面内に収める
        const by = p.y - 52;
        let pen = 0;
        if (p.y - 110 < 0) pen += 500; // 画面上にはみ出す
        for (const a of avoid) {
          pen += Math.max(0, 175 - Math.hypot(a.x - bx, a.y - by)) * 3;
        }
        pen -= tut.prefer(t);
        if (!best || pen < best.pen) best = { pen, x: bx, y: p.y };
      }

      const el = $('tut-balloon');
      // 冬のソリはトロッコと同機能だが、文言だけ「ソリ」にする
      el.innerHTML =
        tut.flag === '_tut_cart' && cands.some((t) => t.sled)
          ? '🛷 <b>ソリ</b>のマス！乗ると<b>進んだ方向</b>へ<br>すべって、かべ(段差や畑)の手前で止まるよ。<br>止まった所から<b>数字ぶん</b>ジャンプ！'
          : tut.html;
      el.style.left = `${best.x}px`;
      el.style.top = `${best.y}px`;
      el.classList.remove('hidden');
      this._tutShown = true;
      this._tutFlag = tut.flag;
      return; // 1ステージ1件まで
    }
  }

  _hideTutorial(learned) {
    if (!this._tutShown) return;
    $('tut-balloon').classList.add('hidden');
    this._tutShown = false;
    if (learned && this._tutFlag) {
      try {
        localStorage.setItem(SAVE_KEY + this._tutFlag, '1');
      } catch (e) {}
    }
    this._tutFlag = null;
  }

  // ---------- HUD ----------
  _updateHUD() {
    $('hud-stage').textContent = this._tut && this._tut.on ? '-' : this.stage;
    $('hud-score').textContent = fmt(this.score);
    $('hud-count').textContent = this.carrots;
  }

  _updateReachable() {
    this.reachable = reachableFrom(this.level, this.alive, this.stance);
    this.scene.setReachable(this.reachable);
    // 空きマス(トロッコ降車後)ではそのマスに次のジャンプ力を表示
    this.scene.setRabbitNumber(
      this.curIdx === -1 ? this.stance.power : null,
      this.stance.x,
      this.stance.y
    );

    if (this.reachable.length === 0) {
      // チュートリアル中はゲームオーバーにせず、同じステップをやり直す
      if (this._tut && this._tut.on) {
        this.state = 'busy';
        this._toast('もういちど やってみよう！');
        setTimeout(() => this._tut && this._tutBuildStep(), 900);
        return;
      }
      // 詰み
      this.state = 'over';
      this.scene.sadHop();
      this.sfx.gameover();
      $('over-msg').textContent = 'これ以上すすめません…';
      $('over-score').textContent = fmt(this.score);
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
    this.scene.setRabbitNumber(null); // 空きマスの数字はその場で消す(追従させない)

    const fromStance = this.stance;
    const fromIdx = this.curIdx; // 立っていたマス(空きマスなら -1)
    const onSpring = fromIdx >= 0 && this.level.tiles[fromIdx].spring;
    const landInfo =
      id === 'goal'
        ? null
        : landStance(this.level, this.alive, fromStance.x, fromStance.y, id);

    this.sfx[onSpring ? 'boing' : 'hop']();

    // 元いたマスを沈める(空きマスからのジャンプなら沈めるマスなし)
    await this.scene.jumpTo(fromStance, id, fromIdx);
    this.sfx.land();
    this.moves++;

    if (id === 'goal') {
      if (this._tut && this._tut.on) {
        // チュートリアル中はスコア画面を出さず、お祝いだけして次のステップへ
        this.scene.celebrate();
        this._tutAfterMove('goal');
        return;
      }
      this._onClear();
      return;
    }

    const tile = this.level.tiles[id];
    for (const idx of landInfo.eaten) this.alive[idx] = false;

    // つむじ風マス: うさぎを包んで対の落ち葉マスまで運び、風は画面外へ飛び去る。
    // 落ち葉マスでは通常着地と同じ処理(ニンジンを食べて数字が次のジャンプ力)。
    if (tile.whirl) {
      const leafIdx = tile.pair;
      await this.scene.whirlCarry(id, leafIdx);
      this.sfx.land();
      this._eatTile(leafIdx); // 運ばれた先の落ち葉マスのニンジンをパクッ
      this.stance = landInfo.stance;
      this.curIdx = leafIdx;
      this.scene.setOnSpring(!!this.level.tiles[leafIdx].spring);
      if (this._tut && this._tut.on && this._tutAfterMove(id)) return;
      this.state = 'playing';
      this._updateHUD();
      this._updateReachable();
      return;
    }

    this._eatTile(id); // 着地マス(トロッコ本体)のニンジンをパクッ

    // 落ち葉マスに直接乗った場合、対のつむじ風は使えなくなり画面外へ飛び去る
    if (tile.pairWhirl != null && landInfo.eaten.includes(tile.pairWhirl)) {
      this.scene.whirlFlee(tile.pairWhirl);
    }

    // トロッコ: レール方向へ運ばれ、段差/端の手前で大破 → 空きマスに降りる
    if (tile.cart) {
      this.sfx.slide();
      await this.scene.rideCart(id, landInfo.stance);
    }

    this.stance = landInfo.stance;
    this.curIdx = tile.cart ? -1 : id;

    this.scene.setOnSpring(this.curIdx >= 0 && this.level.tiles[this.curIdx].spring);

    if (this._tut && this._tut.on && this._tutAfterMove(id)) return;

    this.state = 'playing';
    this._updateHUD();
    this._updateReachable();
  }

  // ---------- SNSシェア ----------
  // 結果カード(ロゴ+成績のみの横長バナー。盤面は入れない)をPNGに合成する
  _buildShareCard() {
    const W = 1080;
    const H = 320;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');

    // 背景: 緑地に斜めの格子模様
    ctx.fillStyle = '#82c15e';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(25, 80, 15, 0.10)';
    ctx.lineWidth = 3;
    const step = 46;
    for (let i = -H; i < W + H; i += step) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + H, H);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(i + H, 0);
      ctx.lineTo(i, H);
      ctx.stroke();
    }

    // 白の角丸パネル
    const px = 18, py = 18, pw = W - 36, ph = H - 36, r = 42;
    ctx.beginPath();
    ctx.moveTo(px + r, py);
    ctx.arcTo(px + pw, py, px + pw, py + ph, r);
    ctx.arcTo(px + pw, py + ph, px, py + ph, r);
    ctx.arcTo(px, py + ph, px, py, r);
    ctx.arcTo(px, py, px + pw, py, r);
    ctx.closePath();
    ctx.fillStyle = '#fefefa';
    ctx.fill();

    const font = (size, weight = 'bold') =>
      `${weight} ${size}px 'Hiragino Maru Gothic ProN','BIZ UDGothic','Yu Gothic UI',sans-serif`;
    ctx.textBaseline = 'middle';

    // ロゴ(読み込めていなければタイトル文字で代替)
    const logo = this._logoImg;
    let tx = px + 48;
    if (logo && logo.complete && logo.naturalWidth) {
      const lh = ph - 36;
      const lw = (logo.naturalWidth / logo.naturalHeight) * lh;
      ctx.drawImage(logo, px + 24, py + (ph - lh) / 2, lw, lh);
      tx = px + 24 + lw + 44;
    } else {
      ctx.fillStyle = '#e8760f';
      ctx.font = font(44);
      ctx.fillText(document.title, tx, py + 50);
    }

    // 成績(文言は仮。決まったらここを差し替える)
    ctx.fillStyle = '#3a9d43';
    ctx.font = font(62);
    ctx.fillText(`STAGE ${this.stage} クリア！`, tx, py + 62);
    ctx.fillStyle = '#e8760f';
    ctx.font = font(56);
    ctx.fillText(`SCORE ${fmt(this.score)}`, tx, py + 142);
    ctx.fillStyle = '#7d7d78';
    ctx.font = font(44, 'normal');
    ctx.fillText(`コード: ${makeCode(this.seed, this.stage)}`, tx, py + 218);

    return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
  }

  // スマホ: OSの共有シート(画像+テキスト)へ。ユーザーがX/Instagram等を選ぶ。
  // 非対応環境(PC等)は画像DL+テキストコピーにフォールバック。
  async _shareResult() {
    const code = makeCode(this.seed, this.stage);
    const isWeb =
      /^https?:$/.test(location.protocol) && !/^(localhost|127\.)/.test(location.hostname);
    const url = isWeb ? location.origin + location.pathname : '';
    const text = `${document.title} STAGE ${this.stage} クリア！\nSCORE ${fmt(this.score)} ／ ステージコード: ${code}\n#ぴょんぴょんキャロット`;
    const full = url ? `${text}\n${url}` : text;

    let blob = null;
    try {
      blob = await this._buildShareCard();
    } catch (e) {}

    if (blob && navigator.canShare) {
      const file = new File([blob], 'pyonpyon-result.png', { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text: full });
          return;
        } catch (e) {
          if (e && e.name === 'AbortError') return; // ユーザーが共有をやめた
        }
      }
    }
    // フォールバック: 画像を保存してテキストをコピー
    if (blob) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'pyonpyon-result.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
    try {
      await navigator.clipboard.writeText(full);
    } catch (e) {}
    this._toast('画像を保存して、シェア用テキストをコピーしました', 2600);
  }

  // 一度だけ出す説明トースト
  _toastOnce(flag, msg) {
    try {
      if (localStorage.getItem(SAVE_KEY + flag)) return;
      localStorage.setItem(SAVE_KEY + flag, '1');
    } catch (e) {}
    this._toast(msg, 2600);
  }

  _onClear() {
    this.state = 'clear';
    this.scene.celebrate();
    this.sfx.clear();

    // スコア計算: (残ニンジン×10 + パーフェクト + スピード) × リトライ倍率
    const carrotBonus = this.carrots * SCORE_PER_CARROT;
    const perfect = this.level.tiles.every((t) => t.whirl || t.eaten) ? PERFECT_BONUS : 0;
    const speed = this.moves <= this.level.minMoves + 1 ? SPEED_BONUS : 0;
    const mult = retryMult(this.retryCount);
    const gain = Math.round((carrotBonus + perfect + speed) * mult);
    this.score += gain;
    this._lastGain = gain; // クリアDLGの「もういちど」で取り消せるように覚えておく
    // ハイスコアの確定は「つぎのステージへ」を押した時点(やり直しで巻き戻せるため)

    $('clear-stage').textContent = this.stage;
    // 次ステージを先にセーブ（途中で閉じても続きから遊べる）
    this._save(this.stage + 1);
    // 見つめ合い→一緒に喜ぶ演出が見えてからダイアログを出す
    setTimeout(() => {
      if (this.state !== 'clear') return;
      this._show('modal-clear');
      this._playClearSequence({ carrotBonus, perfect, speed, mult, gain });
    }, 1500);
  }

  // クリアの内訳を1行ずつ「ドンッ」と見せる演出
  _playClearSequence(d) {
    this._cancelClearSeq();
    const timers = (this._seqTimers = []);
    const later = (ms, fn) => timers.push(setTimeout(fn, ms));

    const rows = {
      carrots: $('sb-carrots-row'),
      perfect: $('sb-perfect-row'),
      speed: $('sb-speed-row'),
      mult: $('sb-mult-row'),
      total: $('sb-total-row'),
      cum: $('sb-cum-row'),
    };
    // 出ない行は非表示、出る行は「待機」状態に
    rows.perfect.classList.toggle('hidden', !d.perfect);
    rows.speed.classList.toggle('hidden', !d.speed);
    rows.mult.classList.toggle('hidden', d.mult === 1);
    for (const r of Object.values(rows)) {
      r.classList.remove('sb-pop');
      if (!r.classList.contains('hidden')) r.classList.add('sb-wait');
    }

    // 値をセット（ニンジンはカウントアップで後から入る）
    $('sb-carrots-n').textContent = 0;
    $('sb-carrots').textContent = '+0';
    $('sb-perfect').textContent = `+${fmt(PERFECT_BONUS)}`;
    $('sb-speed').textContent = `+${fmt(SPEED_BONUS)}`;
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

    later(250, () => {
      pop(rows.carrots);
      this._flyCarrots(this.carrots);
      this._countUpCarrots(this.carrots);
    });
    let t = 1400;
    if (d.perfect) {
      later(t, () => pop(rows.perfect));
      t += 380;
    }
    if (d.speed) {
      later(t, () => pop(rows.speed));
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
    $('btn-sound').textContent = '♪'; // OFF時はCSSで斜め線を重ねる
  }
}
