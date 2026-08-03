// 現行のコード生成「画像(テクスチャ)」を .png に書き出す開発用ツール。
// ブラウザで /export-textures.html を開き、ボタンでダウンロードする。
// 書き出した .png は「Aフォルダ（デザイナー用リファレンス）」= assets/reference/ に置く想定。
//
// ※このツールは開発用。本番ビルド(dist)には含まれない（index.html だけがビルド対象）。

import { drawNumberCanvas, drawLeafCanvas } from '../models.js';

// 書き出す対象一覧。build は必ず HTMLCanvasElement を返す。
// key はそのまま assets/textures/<key>.png のファイル名になる（textureLoader.js と対応）。
const DEFS = [
  { key: 'number-1', label: '数字バッジ 1（青）', build: () => drawNumberCanvas(1) },
  { key: 'number-2', label: '数字バッジ 2（ピンク）', build: () => drawNumberCanvas(2) },
  { key: 'number-3', label: '数字バッジ 3（赤）', build: () => drawNumberCanvas(3) },
  { key: 'leaf', label: '落ち葉テクスチャ', build: () => drawLeafCanvas() },
];

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      'image/png'
    );
  });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function downloadOne(def, statusEl) {
  try {
    statusEl.textContent = '書き出し中…';
    const canvas = def.build();
    const blob = await canvasToBlob(canvas);
    triggerDownload(blob, `${def.key}.png`);
    statusEl.textContent = `OK (${canvas.width}×${canvas.height} / ${(blob.size / 1024).toFixed(1)} KB)`;
  } catch (e) {
    statusEl.textContent = 'エラー: ' + e.message;
    console.error(e);
  }
}

function build() {
  const app = document.getElementById('app');
  app.innerHTML = '';

  const heading = document.createElement('h1');
  heading.textContent = '画像(テクスチャ)書き出し（.png）';
  app.appendChild(heading);

  const note = document.createElement('p');
  note.className = 'note';
  note.innerHTML =
    '各ボタンで現行の生成画像を .png でダウンロードします。<br>' +
    'ダウンロードした一式を <code>assets/reference/</code> に置いてデザイナーへのリファレンスにしてください。<br>' +
    'デザイナーが直した .png を <code>assets/textures/</code> に <code>&lt;key&gt;.png</code> の名前で置くと、ゲームが自動で差し替えます。<br>' +
    '仕様は <code>assets/README.md</code> の「画像(テクスチャ)一覧」を参照。';
  app.appendChild(note);

  const allBtn = document.createElement('button');
  allBtn.textContent = 'すべてダウンロード';
  allBtn.className = 'all';
  app.appendChild(allBtn);

  const list = document.createElement('div');
  list.className = 'list';
  app.appendChild(list);

  const rows = DEFS.map((def) => {
    const row = document.createElement('div');
    row.className = 'row';
    const btn = document.createElement('button');
    btn.textContent = `${def.label} (${def.key}.png)`;
    const status = document.createElement('span');
    status.className = 'status';
    btn.onclick = () => downloadOne(def, status);
    row.appendChild(btn);
    row.appendChild(status);
    list.appendChild(row);
    return { def, status };
  });

  allBtn.onclick = async () => {
    for (const { def, status } of rows) {
      await downloadOne(def, status);
      await new Promise((r) => setTimeout(r, 300)); // 連続DLブロック回避
    }
  };
}

build();
