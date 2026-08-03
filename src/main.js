import { Game } from './game.js';
import { initTextures } from './textureLoader.js';

// 差し替え画像(assets/textures/*.png)を先に読み込んでからゲーム開始。
// 画像が無ければ従来どおりコード生成にフォールバックする(見た目は変わらない)。
initTextures().finally(() => {
  window.game = new Game();
});
