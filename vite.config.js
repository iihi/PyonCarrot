import { defineConfig } from 'vite';
import pkg from './package.json';

export default defineConfig({
  // 相対パスでビルドする（サーバのどのフォルダに置いても動くように）
  base: './',
  define: {
    // package.json の version をバージョン情報ダイアログに埋め込む
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
});
