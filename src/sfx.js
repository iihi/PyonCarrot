// WebAudioで作る簡易効果音（外部ファイル不要）

export class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    // BGMはWeb Audioでデコードしてループする(HTMLAudioのloopは繋ぎ目で音が切れるため)
    this.bgmBuffer = null; // デコード済みの音源
    this.bgmSource = null; // 再生中のループソース
    this.bgmGain = null; // 音量/消音用
    this._bgmLoading = null; // fetch+decodeのPromise(多重ロード防止)
    this.bgmVol = 0.35;
    this._wantBgm = false; // 本来BGMを鳴らしたい状態か(消音中でも保持)

    // iOS 16.4+: サイレントスイッチONでもWeb Audioが消音されないようにする
    // (新しいiOSではWeb Audioが環境音扱いになり、マナーモードで無音になるため)
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch (e) {}

    // バックグラウンドから戻ったときにオーディオを再開(iOS Safariの中断対策)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (this.ctx && this.ctx.state !== 'running') this.ctx.resume();
      // ループソースが中断されていたら鳴らし直す
      if (this._wantBgm && !this.bgmSource && this.bgmBuffer) this._startBgmSource();
    });
  }

  // ---------- BGM(Web Audioでギャップレスにループ) ----------
  async startBgm() {
    this._wantBgm = true;
    const ctx = this._ensure();
    if (!ctx) return;
    if (!this.bgmGain) {
      this.bgmGain = ctx.createGain();
      this.bgmGain.gain.value = this.enabled ? this.bgmVol : 0;
      this.bgmGain.connect(ctx.destination);
    }
    if (!this.bgmBuffer) {
      if (!this._bgmLoading) {
        this._bgmLoading = fetch(import.meta.env.BASE_URL + 'rabi_bgm.mp3')
          .then((r) => r.arrayBuffer())
          .then((ab) => ctx.decodeAudioData(ab))
          .then((buf) => {
            this.bgmBuffer = buf;
          })
          .catch(() => {});
      }
      await this._bgmLoading;
    }
    // 読み込み待ちの間に停止された/既に鳴っている場合は何もしない
    if (this.bgmBuffer && this._wantBgm && !this.bgmSource) this._startBgmSource();
  }

  _startBgmSource() {
    const ctx = this._ensure();
    if (!ctx || !this.bgmBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.bgmBuffer;
    src.loop = true; // バッファ全体をサンプル単位で繰り返す＝繋ぎ目が途切れない
    src.connect(this.bgmGain);
    src.start(0);
    this.bgmSource = src;
  }

  stopBgm() {
    this._wantBgm = false;
    if (this.bgmSource) {
      try {
        this.bgmSource.stop();
      } catch (e) {}
      this.bgmSource.disconnect();
      this.bgmSource = null;
    }
  }

  // 効果音・BGMのオン/オフをまとめて切り替える
  setEnabled(v) {
    this.enabled = v;
    if (this.bgmGain) {
      const ctx = this.ctx;
      const g = this.bgmGain.gain;
      const target = v ? this.bgmVol : 0;
      if (ctx) {
        // 短いフェードでプツッというノイズを防ぐ
        const now = ctx.currentTime;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(target, now + 0.08);
      } else {
        g.value = target;
      }
    }
    // 消音中にstartBgmしていた場合、再ONで鳴らし始める
    if (v && this._wantBgm && !this.bgmSource && this.bgmBuffer) this._startBgmSource();
  }

  // 初回のユーザー操作で呼び、無音バッファを鳴らしてiOSのオーディオを解錠する
  unlock() {
    const ctx = this._ensure();
    if (!ctx) return;
    try {
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    } catch (e) {}
  }

  _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    // 'interrupted' はiOS Safari独自の中断状態
    if (this.ctx.state !== 'running') this.ctx.resume();
    return this.ctx;
  }

  _tone(freq, dur, { type = 'square', vol = 0.15, delay = 0, slide = 0 } = {}) {
    const ctx = this._ensure();
    if (!ctx || !this.enabled) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.linearRampToValueAtTime(freq + slide, t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  click() {
    this._tone(880, 0.06, { type: 'triangle', vol: 0.1 });
  }
  hop() {
    this._tone(420, 0.12, { type: 'square', vol: 0.08, slide: 320 });
  }
  land() {
    this._tone(200, 0.08, { type: 'triangle', vol: 0.12, slide: -60 });
  }
  pickup() {
    this._tone(660, 0.09, { type: 'triangle', vol: 0.12 });
    this._tone(990, 0.12, { type: 'triangle', vol: 0.12, delay: 0.08 });
  }
  rewind() {
    this._tone(600, 0.09, { type: 'sine', vol: 0.12, slide: -250 });
  }
  hint() {
    this._tone(520, 0.08, { type: 'sine', vol: 0.1 });
    this._tone(780, 0.1, { type: 'sine', vol: 0.1, delay: 0.07 });
  }
  boing() {
    this._tone(220, 0.22, { type: 'sine', vol: 0.16, slide: 480 });
    this._tone(110, 0.1, { type: 'square', vol: 0.08, slide: 120 });
  }
  slide() {
    this._tone(900, 0.3, { type: 'triangle', vol: 0.07, slide: -500 });
  }
  thud() {
    this._tone(150, 0.1, { type: 'square', vol: 0.15, slide: -50 });
    this._tone(75, 0.12, { type: 'sine', vol: 0.18, slide: -20 });
  }
  warp() {
    const notes = [523, 784, 1047, 1568];
    notes.forEach((f, i) =>
      this._tone(f, 0.14, { type: 'sine', vol: 0.09, delay: i * 0.05, slide: 80 })
    );
  }
  clear() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) =>
      this._tone(f, 0.16, { type: 'triangle', vol: 0.14, delay: i * 0.12 })
    );
  }
  gameover() {
    const notes = [440, 370, 311, 262];
    notes.forEach((f, i) =>
      this._tone(f, 0.18, { type: 'sawtooth', vol: 0.08, delay: i * 0.14 })
    );
  }
}
