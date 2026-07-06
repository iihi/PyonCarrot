// WebAudioで作る簡易効果音（外部ファイル不要）

export class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;

    // iOS 16.4+: サイレントスイッチONでもWeb Audioが消音されないようにする
    // (新しいiOSではWeb Audioが環境音扱いになり、マナーモードで無音になるため)
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch (e) {}

    // バックグラウンドから戻ったときにオーディオを再開(iOS Safariの中断対策)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.ctx && this.ctx.state !== 'running') {
        this.ctx.resume();
      }
    });
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
