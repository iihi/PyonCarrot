// ゲーム本体：状態管理、UI、セーブ/コンティニュー
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

const $ = (id) => document.getElementById(id);

export class Game {
  constructor() {
    this.scene = new GameScene($('c'));
    this.sfx = new Sfx();

    this.state = 'title'; // title | playing | busy | clear | over
    this.seed = 0;
    this.stage = 1;
    this.stock = { rewind: 1, hint: 1 };
    this.stageStartStock = { ...this.stock };
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
    $('code-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._continueFromCode();
    });
    $('btn-resume').onclick = () => {
      const save = this._loadSave();
      if (save) {
        this.sfx.click();
        this.seed = save.seed;
        this.stage = save.stage;
        this.stock = save.stock || { rewind: 1, hint: 1 };
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
      this.stage++;
      this._hide('modal-clear');
      this.startStage();
    };
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

  _toast(msg, ms = 1800) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
  }

  _showTitle() {
    this.state = 'title';
    this._show('screen-title');
    this._hide('hud');
    const save = this._loadSave();
    $('btn-continue').classList.toggle('hidden', false);
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
    this.stock = { rewind: 1, hint: 1 };
    this._hide('modal-continue');
    this.startStage();
  }

  // ---------- ゲーム進行 ----------
  newGame() {
    this.seed = 1000 + Math.floor(Math.random() * 9000);
    this.stage = 1;
    this.stock = { rewind: 1, hint: 1 };
    this.startStage();
  }

  startStage() {
    this.level = generate(this.seed, this.stage);
    this.alive = this.level.tiles.map((_, i) => i !== 0);
    this.cur = 0;
    this.count = this.level.count;
    this.history = [];
    this.stageStartStock = { ...this.stock };

    this._hide('screen-title');
    this._show('hud');
    this.scene.buildStage(this.level);
    // 数字とグリッドは常時ON
    this.scene.setNumbersVisible(true);
    this.scene.setGridVisible(true);
    this._save();
    this._updateHUD();

    // 白ウサギの登場シーン（操作キャラだと分かるように毎ステージ再生）
    this.state = 'busy';
    this.scene.playEntrance().then(() => {
      this.state = 'playing';
      this._updateReachable();
    });
  }

  retryStage() {
    if (this.state === 'busy') return;
    this.stock = { ...this.stageStartStock };
    this.startStage();
  }

  _updateHUD() {
    $('hud-stage').textContent = this.stage;
    $('hud-count').textContent = this.count;
    $('cnt-rewind').textContent = this.stock.rewind;
    $('cnt-hint').textContent = this.stock.hint;
    $('btn-rewind').classList.toggle('disabled', !this.stock.rewind || !this.history.length);
    $('btn-hint').classList.toggle('disabled', !this.stock.hint);
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
      $('btn-rewind-over').classList.toggle(
        'hidden',
        !(this.stock.rewind > 0 && this.history.length > 0)
      );
      setTimeout(() => this._show('modal-over'), 700);
    }
  }

  async tryMove(id) {
    if (this.state !== 'playing') return;
    if (!this.reachable.includes(id)) return;

    this.state = 'busy';
    this.scene.clearRings();
    this.scene.clearHint();
    this.history.push({ cur: this.cur, count: this.count });

    this.sfx.hop();
    const fromIdx = this.cur;
    this.alive[fromIdx] = false; // 元いたマスは消える(スタート地点はalive[0]=false済)

    await this.scene.jumpTo(fromIdx, id);
    this.sfx.land();
    this.count--;

    if (id === 'goal') {
      this._onClear();
      return;
    }

    this.cur = id;
    this.alive[id] = false; // 乗っているマスには飛べない
    this.scene.eatCarrots(id); // 乗ったマスのニンジンはパクッ

    // アイテム取得
    const tile = this.level.tiles[id];
    if (tile.pickup && !tile.pickupTaken) {
      tile.pickupTaken = true;
      this.stock[tile.pickup]++;
      this.scene.collectPickup(id);
      this.sfx.pickup();
      this._toast(tile.pickup === 'rewind' ? 'まきもどし +1 ★' : 'ヒント +1 💡');
    }

    this.state = 'playing';
    this._updateHUD();
    this._updateReachable();
  }

  _onClear() {
    this.state = 'clear';
    this.scene.celebrate();
    this.sfx.clear();
    this._updateHUD();
    $('clear-stage').textContent = this.stage;
    // 次ステージを先にセーブ（途中で閉じても続きから遊べる）
    this._save(this.stage + 1);
    // 喜び→見つめ合いの演出が見えてからダイアログを出す
    setTimeout(() => this._show('modal-clear'), 1700);
  }

  // ---------- アイテム ----------
  async useRewind() {
    if (this.state !== 'playing') return;
    if (!this.stock.rewind || !this.history.length) {
      this._toast('まきもどしが使えません');
      return;
    }
    this.state = 'busy';
    this.stock.rewind--;
    this.sfx.rewind();
    this.scene.clearRings();
    this.scene.clearHint();

    const prev = this.history.pop();
    const fromId = this.cur;
    // 今いたマスはフィールドに残る（また飛び先の候補になる）
    this.alive[fromId] = true;
    this.scene.restoreCarrots(fromId); // 食べたニンジンも巻き戻す
    // 戻り先のマスはウサギが乗るので alive は false のまま
    await this.scene.rewindTo(prev.cur, fromId);

    this.cur = prev.cur;
    this.count = prev.count;
    this.state = 'playing';
    this._updateHUD();
    this._updateReachable();
  }

  useHint() {
    if (this.state !== 'playing') return;
    if (!this.stock.hint) {
      this._toast('ヒントがありません');
      return;
    }
    const path = findSolution(this.level, this.alive, this.cur);
    if (!path) {
      this._toast('この状態ではクリアできません。まきもどしを使おう！');
      return;
    }
    this.stock.hint--;
    this.sfx.hint();
    this.scene.showHint(path[0]);
    this._updateHUD();
  }

  // ---------- セーブ ----------
  _save(stage = this.stage) {
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({ seed: this.seed, stage, stock: this.stock })
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
        JSON.stringify({ sound: this.sfx.enabled })
      );
    } catch (e) {}
  }

  _loadSettings() {
    try {
      const raw = localStorage.getItem(SAVE_KEY + '_opt');
      if (raw) this.sfx.enabled = JSON.parse(raw).sound !== false;
    } catch (e) {}
    $('btn-sound').classList.toggle('on', this.sfx.enabled);
    $('btn-sound').textContent = this.sfx.enabled ? '♪' : '×';
  }
}
