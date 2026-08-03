import { Game } from './game.js';
import { initTextures } from './textureLoader.js';
import { applyUiSkin } from './uiSkin.js';

// UI(ボタン・ダイアログ)の画像スキンを適用(assets/ui/manifest.json。無ければ従来のまま)。
applyUiSkin();

// 差し替え画像(assets/textures/*.png)を先に読み込んでからゲーム開始。
// 画像が無ければ従来どおりコード生成にフォールバックする(見た目は変わらない)。
initTextures().finally(() => {
  window.game = new Game();
});
