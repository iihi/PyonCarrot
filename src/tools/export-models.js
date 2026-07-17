// 現行のコード生成3Dモデルを .glb に書き出す開発用ツール。
// ブラウザで /export.html を開き、ボタンでダウンロードする。
// 書き出した .glb は「Aフォルダ（デザイナー用リファレンス）」= assets/reference/ に置く想定。
//
// ※このツールは開発用。本番ビルド(dist)には含まれない（index.html だけがビルド対象）。

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import {
  makeRabbit,
  makeGoalRabbit,
  makeWhirl,
  makeGoal,
  makeMound,
  makeLeafBase,
  makeCarrot,
  makeSpring,
  makeCart,
  makeSled,
} from '../models.js';

// userData のパーツ参照に分かりやすい名前を付けて書き出す
// （デザイナーが「どこが動くパーツか」を把握しやすいように）
function annotate(root, name) {
  root.name = name;
  const u = root.userData || {};
  if (u.inner) u.inner.name = 'rig'; // アニメの基準になる内側グループ
  if (u.spin) u.spin.name = 'spin'; // つむじ風の回転グループ
  if (u.snack) u.snack.name = 'snack';
  if (u.cart) u.cart.name = 'cart';
  if (u.bunny) u.bunny.name = 'goal_rabbit';
  if (u.flag) u.flag.name = 'flag';
  const named = (arr, prefix) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((e, i) => {
      const m = e && e.mesh ? e.mesh : e;
      if (m && m.name === '') m.name = `${prefix}_${i}`;
    });
  };
  named(u.ears, 'ear');
  named(u.feet, 'foot');
  named(u.arms, 'arm');
  named(u.wheels, 'wheel');
  return root;
}

// 書き出す対象一覧。build は必ず THREE.Object3D を返す。
const DEFS = [
  { key: 'rabbit', label: 'プレイヤー兎', build: () => annotate(makeRabbit(), 'rabbit') },
  { key: 'goal-rabbit', label: 'ゴール兎', build: () => annotate(makeGoalRabbit(), 'goal_rabbit') },
  { key: 'whirl', label: 'つむじ風', build: () => annotate(makeWhirl(), 'whirl') },
  { key: 'leaf-base', label: '落ち葉マスの土台', build: () => annotate(makeLeafBase(), 'leaf_base') },
  { key: 'goal', label: 'ゴールの祠', build: () => annotate(makeGoal(), 'goal') },
  { key: 'mound', label: '畑マスの土台', build: () => annotate(makeMound(), 'mound') },
  { key: 'carrot', label: 'ニンジン', build: () => annotate(makeCarrot(1, false), 'carrot') },
  { key: 'carrot-gold', label: '金ニンジン', build: () => annotate(makeCarrot(1, true), 'carrot_gold') },
  { key: 'spring', label: 'ジャンプ台のバネ', build: () => annotate(makeSpring().group, 'spring') },
  { key: 'cart', label: 'トロッコ', build: () => annotate(makeCart().railGroup, 'cart_rig') },
  { key: 'sled', label: 'ソリ', build: () => annotate(makeSled().railGroup, 'sled_rig') },
];

const exporter = new GLTFExporter();

function exportGlb(object) {
  return new Promise((resolve, reject) => {
    exporter.parse(
      object,
      (result) => resolve(new Blob([result], { type: 'model/gltf-binary' })),
      (err) => reject(err),
      { binary: true, onlyVisible: true }
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
    const blob = await exportGlb(def.build());
    triggerDownload(blob, `${def.key}.glb`);
    statusEl.textContent = `OK (${(blob.size / 1024).toFixed(1)} KB)`;
  } catch (e) {
    statusEl.textContent = 'エラー: ' + e.message;
    console.error(e);
  }
}

function build() {
  const app = document.getElementById('app');
  app.innerHTML = '';

  const heading = document.createElement('h1');
  heading.textContent = '3Dモデル書き出し（.glb）';
  app.appendChild(heading);

  const note = document.createElement('p');
  note.className = 'note';
  note.innerHTML =
    '各ボタンで現行モデルを .glb でダウンロードします。<br>' +
    'ダウンロードした一式を <code>assets/reference/</code> に置いてデザイナーへのリファレンスにしてください。<br>' +
    '単位・向き・原点などの仕様は <code>assets/README.md</code> を参照。';
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
    btn.textContent = `${def.label} (${def.key}.glb)`;
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
