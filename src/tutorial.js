// チュートリアル(通しコース)のステップ定義。
// 各ステップ = 説明文 + 手書きの極小盤面(固定データ) + 完了条件。
// 盤面は生成器を通さず buildStage にそのまま渡せる level 形式で書く。
// tiles[0] がスタートマス。数字(value)=そこから飛べる距離。
//
// 完了条件 done:
//   { on: 'tile', idx } … そのマスに着地したら次へ
//   { on: 'goal' }      … ゴールに飛び込んだら次へ
import { GRID } from './level.js';

const H = () => Array.from({ length: GRID }, () => new Array(GRID).fill(0));

const mk = (season, tiles, goal, heights) => ({
  seed: 0,
  stage: 0,
  tutorial: true,
  season,
  background: season,
  tiles,
  goal,
  heights: heights || H(),
  count: tiles.length,
  minMoves: 99, // チュートリアルは採点しない
});

export const TUTORIAL_STEPS = [
  // ---- 基本 ----
  {
    text: '🐰 マスの<b>数字</b>は「とべるマスの数」！<br>ひかっているマスをタップしてジャンプ！',
    done: { on: 'tile', idx: 1 },
    level: mk(
      'spring',
      [
        { x: 4, y: 5, value: 1 },
        { x: 4, y: 4, value: 1 },
      ],
      { x: 6, y: 6 } // 斜めはとべないので、じゃまにならない位置に置く
    ),
  },
  {
    text: '🥕 マスにのると<b>ニンジン</b>がもらえるよ。<br>あつめながら すすもう！',
    done: { on: 'tile', idx: 2 },
    level: mk(
      'spring',
      [
        { x: 4, y: 6, value: 1 },
        { x: 4, y: 5, value: 1 },
        { x: 4, y: 4, value: 1 },
      ],
      { x: 6, y: 6 }
    ),
  },
  {
    text: '💗 <b>ピンクのウサギ</b>のところへ とびこめば<b>クリア</b>！<br>とびたったマスは消える。ルートは自由！',
    done: { on: 'goal' },
    level: mk(
      'spring',
      [
        { x: 4, y: 5, value: 1 },
        { x: 4, y: 4, value: 1 },
      ],
      { x: 4, y: 3 }
    ),
  },
  // ---- ギミック(本編に出てくるステージ番号の予告つき) ----
  {
    text: '⛰️ <b>ステージ4</b>からは<b>段差</b>が出るよ！<br>上りはパワーが<b>1つ多く</b>ひつよう。<br>降りるときは<b>1マス遠くへ</b>とべる！',
    done: { on: 'goal' },
    level: (() => {
      const h = H();
      h[4][4] = 1;
      return mk(
        'spring',
        [
          { x: 4, y: 5, value: 2 }, // 上り: 1マス先+1段 = 2
          { x: 4, y: 4, value: 1 }, // 下り: 数字1でも1段下なら2マス先へ
        ],
        { x: 4, y: 2 },
        h
      );
    })(),
  },
  {
    text: '🦘 <b>ステージ6</b>からは<b>ジャンプ台</b>！<br>のって飛ぶと<b>2マス遠く</b>まで とべるよ',
    done: { on: 'goal' },
    level: mk(
      'summer',
      [
        { x: 4, y: 7, value: 1 },
        { x: 4, y: 6, value: 1, spring: true }, // 1+2=3マス先へ
        { x: 4, y: 3, value: 1 },
      ],
      { x: 4, y: 2 }
    ),
  },
  {
    text: '🌪️ <b>ステージ11</b>からは<b>つむじ風</b>！<br>のると対(つい)の<b>落ち葉マス</b>まで<br>ビューンと運ばれるよ',
    done: { on: 'goal' },
    level: mk(
      'autumn',
      [
        { x: 4, y: 6, value: 1 },
        { x: 4, y: 5, value: 0, whirl: true, pair: 2 },
        { x: 2, y: 3, value: 1, leaf: true, pairWhirl: 1 },
      ],
      { x: 2, y: 2 }
    ),
  },
  {
    text: '🛷 <b>ステージ16</b>からは<b>ソリ・トロッコ</b>！<br>のると進んだ方向へすべって、かべの手前でストップ。<br>止まった所から<b>数字ぶん</b>ジャンプ！',
    done: { on: 'goal' },
    level: mk(
      'winter',
      [
        { x: 4, y: 6, value: 1 },
        { x: 4, y: 5, value: 2, cart: true, rail: [0, -1], sled: true }, // (4,3)で停止→2マスジャンプ
        { x: 4, y: 2, value: 1 }, // ソリを止めるかべ役の畑
      ],
      { x: 4, y: 1 }
    ),
  },
];
