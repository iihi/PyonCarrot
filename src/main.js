import { Game } from './game.js';
import { initTextures } from './textureLoader.js';
import { initModels } from './modelLoader.js';
import { applyUiSkin } from './uiSkin.js';

// ロゴ等の画像を保存されにくくする: 右クリックメニューと画像ドラッグを禁止。
// (ゲーム画面なので画面全体に適用)
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('dragstart', (e) => e.preventDefault());

// UI(ボタン・ダイアログ)の画像スキンを適用(assets/ui/manifest.json。無ければ従来のまま)。
applyUiSkin();

// 差し替え画像(textures/*.png)と差し替えモデル(models/*.glb)を先に読み込んでから開始。
// 無いものは従来どおりコード生成にフォールバックする(見た目は変わらない)。
Promise.all([initTextures(), initModels()]).finally(() => {
  window.game = new Game();
});
