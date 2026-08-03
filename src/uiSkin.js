// UI(ボタン・ダイアログ枠)の画像スキン差し替え機構。
//
// assets/ui/manifest.json で「どの部位にどのPNGを使うか」を指定する。
// 指定があった部位だけ CSS 変数(--skin-*)を設定し、style.css 側が
// その画像を背景に重ねる。指定が無ければ従来のグラデ/枠のまま(見た目そのまま)。
//
// manifest.json の例:
//   { "btnPrimary": "btn-primary.png", "panel": "panel.png" }
// 既定は空 {} なので 404 も出ない。運用は assets/ui/README.md を参照。

// スキンのキー → style.css で使う CSS 変数名
const SKIN_VARS = {
  btn: '--skin-btn', // 通常ボタン(緑)
  btnPrimary: '--skin-btn-primary', // 主ボタン(オレンジ)
  btnSub: '--skin-btn-sub', // 副ボタン(グレー)
  panel: '--skin-panel', // ダイアログ枠(.modal-box)
};

export async function applyUiSkin(dir = 'assets/ui/') {
  const base = (import.meta.env && import.meta.env.BASE_URL) || './';
  let manifest;
  try {
    const res = await fetch(base + dir + 'manifest.json', { cache: 'no-cache' });
    if (!res.ok) return; // manifest が無ければ何もしない
    manifest = await res.json();
  } catch (e) {
    return; // 取得/パース失敗 → 従来スタイルのまま
  }
  if (!manifest || typeof manifest !== 'object') return;

  const root = document.documentElement;
  for (const [key, varName] of Object.entries(SKIN_VARS)) {
    const file = manifest[key];
    if (typeof file === 'string' && file) {
      // CSS変数内の相対url()はスタイルシート基準(src/)で解決されてしまうため、
      // ドキュメント基準の絶対URLにしてから渡す。
      const abs = new URL(base + dir + file, document.baseURI).href;
      root.style.setProperty(varName, `url("${abs}")`);
    }
  }
}
