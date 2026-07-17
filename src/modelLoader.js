// 3Dモデルの差し替え機構（Bフォルダ優先読み込み＋コード生成フォールバック）
//
// 使い方（scene3d 側）:
//   import { initModels, loadedModel } from './modelLoader.js';
//   await initModels();                         // 起動時に一度だけ
//   this.rabbit = loadedModel('rabbit') || makeRabbit();
//
// assets/models/<name>.glb が存在すればそれを（クローンして）返し、
// 無ければ null を返す。呼び出し側は null のときコード生成モデルにフォールバックする。
//
// ※アニメーション（耳ピクッ・ホップ・車輪回転など）はモデルの userData に
//   依存しているため、glb に差し替える際はモデルごとに個別対応が必要
//   （デザイナーのデータを見ながら一つずつ実装する運用）。詳細は
//   assets/README.md を参照。

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// 差し替え可能なモデルキー → glb ファイル名
export const MODEL_FILES = {
  rabbit: 'rabbit.glb', // プレイヤー兎
  goalRabbit: 'goal-rabbit.glb', // ゴールで待つピンク兎
  whirl: 'whirl.glb', // つむじ風
  leafBase: 'leaf-base.glb', // 落ち葉マスの土台(つむじ風の対)
  carrot: 'carrot.glb', // ニンジン1本
  spring: 'spring.glb', // ジャンプ台のバネ
  cart: 'cart.glb', // トロッコ
  sled: 'sled.glb', // ソリ（冬）
  goal: 'goal.glb', // ゴールの祠（台座＋旗）
  mound: 'mound.glb', // 畑マスの土台
};

const base = (import.meta.env && import.meta.env.BASE_URL) || './';
const loader = new GLTFLoader();
const cache = new Map(); // key -> THREE.Object3D | null（null = 未提供＝フォールバック）

let ready = false;

// assets/models/ 以下の glb を探索する。無いものは静かに null 扱い。
export async function initModels(dir = 'assets/models/') {
  if (ready) return;
  await Promise.all(
    Object.entries(MODEL_FILES).map(
      ([key, file]) =>
        new Promise((resolve) => {
          loader.load(
            base + dir + file,
            (gltf) => {
              cache.set(key, gltf.scene);
              resolve();
            },
            undefined,
            () => {
              cache.set(key, null); // 見つからない/読めない → フォールバック
              resolve();
            }
          );
        })
    )
  );
  ready = true;
}

// 読み込み済み glb のクローンを返す。未提供なら null（呼び出し側でフォールバック）。
export function loadedModel(key) {
  const tpl = cache.get(key);
  return tpl ? tpl.clone(true) : null;
}

// そのキーの差し替えデータが用意されているか
export function hasModel(key) {
  return !!cache.get(key);
}
