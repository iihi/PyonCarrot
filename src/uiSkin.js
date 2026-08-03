// UI(ボタン・ダイアログ枠)の画像スキン差し替え機構。
//
// assets/ui/manifest.json で「どの部位にどのPNGを使うか」を指定する。
// 指定があった部位だけ CSS 変数(--skin-*)を設定し、style.css 側が
// その画像を背景に重ねる。指定が無ければ従来のグラデ/枠のまま(見た目そのまま)。
//
// manifest.json の例:
//   { "btnPrimary": "btn-primary.png", "panel": "panel.png" }
// 既定は空 {} なので 404 も出ない。運用は assets/ui/README.md を参照。

// スキンのキー → { var: 通常画像のCSS変数, cls: <html>に付けるクラス,
//                 pressed: 押下画像のmanifestキー, activeVar: 押下画像のCSS変数 }
// クラス側で、その部位の「CSSが描く縁取り・立体影・地色」を消して画像だけで見せる。
// pressed 画像は任意。あれば押下時に切り替え、無ければ通常画像のまま軽く沈める。
const SKIN_VARS = {
  btn: { var: '--skin-btn', cls: 'skin-btn', pressed: 'btnPressed', activeVar: '--skin-btn-active' }, // 通常ボタン(緑)
  btnPrimary: { var: '--skin-btn-primary', cls: 'skin-btn-primary', pressed: 'btnPrimaryPressed', activeVar: '--skin-btn-primary-active' }, // 主ボタン(オレンジ)
  btnSub: { var: '--skin-btn-sub', cls: 'skin-btn-sub', pressed: 'btnSubPressed', activeVar: '--skin-btn-sub-active' }, // 副ボタン(グレー)
  panel: { var: '--skin-panel', cls: 'skin-panel' }, // ダイアログ枠(.modal-box)
};

// HUDのアイコン(サウンドはオン/オフ2状態)。画像があれば絵文字を隠して差し替え。
const ICON_VARS = {
  iconSoundOn: '--skin-icon-sound-on', // サウンドON時
  iconSoundOff: '--skin-icon-sound-off', // サウンドOFF時
  iconHome: '--skin-icon-home', // タイトルへ
};

// manifest の各キー → 解決済み絶対URL(JSから使う: 季節アイコン等)
const resolved = {};

// キーに対応する差し替え画像の絶対URL。無ければ null。
export function uiSkinUrl(key) {
  return resolved[key] || null;
}

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
  const rawUrl = (file) => new URL(base + dir + file, document.baseURI).href;
  // 相対 file 名 → ドキュメント基準の絶対 url() 文字列。
  // (CSS変数内の相対url()はスタイルシート基準(src/)で誤解決されるため絶対URLにする)
  const toUrl = (file) => `url("${rawUrl(file)}")`;

  // すべての文字列エントリの絶対URLを記録(JSからの参照用)
  for (const [k, v] of Object.entries(manifest)) {
    if (typeof v === 'string' && v) resolved[k] = rawUrl(v);
  }

  // ボタン・ダイアログ枠
  for (const [key, { var: varName, cls, pressed, activeVar }] of Object.entries(SKIN_VARS)) {
    const file = manifest[key];
    if (typeof file !== 'string' || !file) continue;
    root.style.setProperty(varName, toUrl(file));
    root.classList.add(cls); // その部位のCSS縁取り・立体影・地色を消す
    // 押下用画像(任意)。あれば :active で切り替わる
    const pf = pressed && manifest[pressed];
    if (typeof pf === 'string' && pf) root.style.setProperty(activeVar, toUrl(pf));
  }

  // HUDアイコン(サウンド/ホーム)
  for (const [key, varName] of Object.entries(ICON_VARS)) {
    const file = manifest[key];
    if (typeof file === 'string' && file) root.style.setProperty(varName, toUrl(file));
  }
  if (manifest.iconSoundOn || manifest.iconSoundOff) root.classList.add('skin-icon-sound');
  if (manifest.iconHome) root.classList.add('skin-icon-home');
}
