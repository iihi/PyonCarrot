// 画像(テクスチャ)の差し替え機構（Bフォルダ優先読み込み＋コード生成フォールバック）
//
// 使い方:
//   import { initTextures, loadedTexture } from './textureLoader.js';
//   await initTextures();                          // 起動時に一度だけ
//   const tex = loadedTexture('leaf') || <Canvas生成にフォールバック>;
//
// assets/textures/<name>.png が存在すればそれを返し、無ければ null を返す。
// 呼び出し側は null のとき Canvas 生成テクスチャにフォールバックする。
// 3Dモデルの modelLoader.js とまったく同じ A/B 運用（詳細は assets/README.md）。

import * as THREE from 'three';

// 差し替え可能な画像キー → png ファイル名
export const TEXTURE_FILES = {
  number1: 'number-1.png', // 数字バッジ 1（原作準拠で青）
  number2: 'number-2.png', // 数字バッジ 2（ピンク）
  number3: 'number-3.png', // 数字バッジ 3（赤）
  leaf: 'leaf.png', // 落ち葉マス(つむじ風の対)のテクスチャ
};

const base = (import.meta.env && import.meta.env.BASE_URL) || './';
const loader = new THREE.TextureLoader();
const cache = new Map(); // key -> THREE.Texture | null（null = 未提供＝フォールバック）

let readyPromise = null;

// assets/textures/ 以下の png を探索する。無いものは静かに null 扱い。
export function initTextures(dir = 'assets/textures/') {
  if (readyPromise) return readyPromise;
  readyPromise = Promise.all(
    Object.entries(TEXTURE_FILES).map(
      ([key, file]) =>
        new Promise((resolve) => {
          loader.load(
            base + dir + file,
            (tex) => {
              tex.colorSpace = THREE.SRGBColorSpace;
              cache.set(key, tex);
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
  return readyPromise;
}

// 読み込み済みテクスチャを返す。未提供なら null（呼び出し側でフォールバック）。
export function loadedTexture(key) {
  return cache.get(key) || null;
}

// そのキーの差し替え画像が用意されているか
export function hasTexture(key) {
  return !!cache.get(key);
}
