# 第8章 囲碁 AI（モンテカルロ探索と GTP）

[← 第7章](07-react-vite.md) ｜ [目次](README.md) ｜ [次へ：第9章 テスト・CI・Docker →](09-testing-ci-docker.md)

## この章で学ぶこと

- インターフェースで AI の実装を差し替える設計
- モンテカルロ法、UCB による探索、AMAF（RAVE）
- 速さのためのデータ構造（型付き配列、空点リスト、スタンプ）
- 重い計算でサーバーを止めない工夫
- 外部プログラムとテキストで通信する GTP と子プロセス

## 1. Engine インターフェース

```ts
// apps/server/src/ai/engine.ts
export interface Engine {
  readonly id: string;
  readonly username: string;
  readonly label: string;
  readonly rank: string;
  genMove(game: Game, color: Stone): Promise<EngineMove>;   // 次の一手
  deadStones(game: Game): Promise<number[]>;                // 整地用の死に石
  close?(): void;
}
```

`GameService` は `Engine` だけを知っていて、中身が内蔵 AI か KataGo かを気にしません。
テストでは「左上から順に打つだけ」の偽エンジン（`server.test.ts` の `stub`）を渡して、決まった動きで検証しています。これが**インターフェースで依存を切る**利点です。

AI に渡す盤面は `copyGame()` で作ったコピーです。AI が考えている間に本物の対局が進んでも（相手の投了など）、影響を受けません。

## 2. モンテカルロ法の考え方

囲碁は打てる手が多く、全部の先を読むことはできません。そこで次の方法を使います。

1. 候補手を1つ選んで打つ
2. そこから最後まで**ランダムに**打ち合う（プレイアウト）
3. 勝ったか負けたかを記録する
4. これを何千回も繰り返し、**勝率が高い手**を選ぶ

ランダムに打っても、たくさん試せば「良い手ほど勝ちやすい」傾向が表れます。

### 2.1 プレイアウト

```ts
// apps/server/src/ai/builtin.ts（要点）
function playout(b: FastBoard, toMove: number, rand: () => number, ...): number {
  const maxMoves = b.cells.length * 2;
  let color = toMove;
  let passes = 0;
  for (let m = 0; m < maxMoves && passes < 2; m++) {
    // 空点の中からランダムに選び、自分の眼を埋める手と打てない手は飛ばす
    ...
    if (played < 0) passes++;
    color = 3 - color;          // 1(黒) ⇔ 2(白) を入れ替える
  }
  return b.areaScore(owner);    // 中国ルール式に数えた黒の差
}
```

**自分の眼を埋めない**のが大事なルールです。これがないと、ランダムに打つうちに自分の眼をつぶして石が全部取られ、最後まで終わりません。

### 2.2 どの候補を試すか（UCB）

すべての候補を同じ回数ずつ試すのは無駄です。有望な手を多く試しつつ、まだあまり試していない手にもときどき回します。

```ts
const q = (1 - beta) * mc + beta * am + prior[i] + EXPLORE * Math.sqrt(logN / (v + 1));
//         ↑ 実際の勝率   ↑ AMAF の勝率 ↑ 序盤の好み  ↑ 試した回数が少ないほど大きい（探索）
```

| 項 | 意味 |
|---|---|
| `mc = wins / visits` | その手を打ったプレイアウトの勝率（**活用**） |
| `EXPLORE * sqrt(log N / (v+1))` | 試した回数が少ない手を優先する補正（**探索**） |
| `prior` | 13路以上の序盤で、1〜2線を少し嫌う |

「良さそうな手を深く調べる」と「まだ知らない手を試す」のバランスを取る方法を、多腕バンディット問題の **UCB**（Upper Confidence Bound）と呼びます。

### 2.3 AMAF / RAVE

```ts
const beta = Math.sqrt(RAVE_K / (3 * v + RAVE_K));   // 試した回数が少ないうちは AMAF を重視
```

AMAF（All Moves As First）は、「プレイアウトの途中で自分がその点に打っていたら、最初にそこへ打ったのと同じとみなして勝敗を数える」方法です。
1回のプレイアウトで多くの候補の情報が集まるので、少ない試行回数でもおおよその良し悪しがわかります。試行が増えると `beta` が小さくなり、本来の勝率を重視するようになります。

### 2.4 最後に選ぶ手

```ts
for (let i = 0; i < cands.length; i++) if (bi < 0 || visits[i] > visits[bi]) bi = i;
```

勝率ではなく**試した回数が最も多い手**を選びます。たまたま少ない回数で高い勝率が出た手より、安定して選ばれ続けた手のほうが信頼できるからです。

### 2.5 強さの段階

```ts
export const BUILTIN_LEVELS: BuiltinLevel[] = [
  { id: 'builtin-1', username: 'AI-Lv1', ..., playouts: 150,  maxMs: 1000, resignBelow: 0 },
  { id: 'builtin-2', username: 'AI-Lv2', ..., playouts: 1500, maxMs: 2000, resignBelow: 0.04 },
  { id: 'builtin-3', username: 'AI-Lv3', ..., playouts: 8000, maxMs: 4000, resignBelow: 0.05 },
];
```

プログラムは同じで、**プレイアウトの回数**だけを変えています。勝率が一定以下になると投了します。

### 2.6 整地への応用

プレイアウトの最後に各交点がどちらの色だったかを平均すると、「この点は何割の確率で黒のものか」（オーナーシップ）がわかります。

```ts
// 相手の色になる確率が高い石を死に石とみなす
if (c === BLACK && ownership[p] < -0.4) dead.push(p);
if (c === WHITE && ownership[p] > 0.4) dead.push(p);
```

相手がパスしたとき、オーナーシップから見て勝っていれば自分もパスして対局を終わらせます（`estimateMargin`）。

## 3. 速さのための工夫

1手で数千回のプレイアウトを行うので、プレイアウト用に専用の盤 `FastBoard` を使っています（共通の `Board` はわかりやすさ重視です）。

| 工夫 | 内容 |
|---|---|
| 隣接表を事前計算 | `nbr`（上下左右）と `diag`（斜め）を盤の大きさごとに1回だけ作って使い回す |
| 型付き配列 | `Uint8Array`, `Int32Array` で連続したメモリに置く。普通の配列より速い |
| 空点リスト | `empties`（空点の一覧）と `emptyPos`（各点の一覧内の位置）で、ランダムな空点を O(1) で選び、打ったら O(1) で消す |
| スタンプ | 「訪問済み」を毎回クリアせず、番号（stamp）を1つ増やすだけで済ませる |
| 自前の乱数 | xorshift（`rng()`）。速く、シードを指定すればテストで同じ結果を再現できる |
| 盤のコピーを再利用 | `work.copyFrom(root)` で新しい盤を作らずに中身だけ戻す |

## 4. サーバーを止めない

Node.js は1つのスレッドで全員のリクエストを処理します。AI が4秒間計算し続けると、その間ほかの人の着手も止まってしまいます。

```ts
const yieldToLoop = () => new Promise<void>((r) => setImmediate(r));
...
if ((total & 15) === 15) {                 // 16回に1回だけ時刻を確認
  if (now - sliceStart > slice) {          // 15ms 以上続けて計算したら
    await yieldToLoop();                   // いったん他の処理に順番を譲る
    sliceStart = Date.now();
  }
}
```

`setImmediate` で待つと、その間にたまっていた他の処理（他の人の着手、WebSocket の通信）が先に実行されます。
ただし CPU を使う総量は変わらないので、AI 対局が増えるとサーバー全体が遅くなります。本格的には `worker_threads` で別スレッドに移すのが改善策です。

## 5. GTP で外部エンジンとつなぐ

GTP（Go Text Protocol）は、囲碁プログラムと1行ずつテキストでやりとりする標準のプロトコルです。

```
→ boardsize 19
← =
←
→ play b D4
← =
←
→ genmove w
← = Q16
←
```

- 成功の返事は `=`、失敗は `?` で始まり、**空行で1つの返事が終わります**。
- KataGo、GNU Go、Leela Zero など多くのプログラムが対応しています。

### 5.1 子プロセスと標準入出力

```ts
// apps/server/src/ai/gtp.ts（要点）
const proc = spawn(this.cfg.command, this.cfg.args ?? [], { cwd: this.cfg.cwd, stdio: 'pipe' });
proc.stdout.on('data', (d: string) => this.onData(d));
...
private onData(d: string) {
  this.buf += d.replace(/\r/g, '');
  while ((i = this.buf.indexOf('\n\n')) >= 0) {        // 空行が来たら1つの返事
    const resp = this.buf.slice(0, i).trim();
    this.buf = this.buf.slice(i + 2);
    const w = this.waiting.shift();                    // 送った順に返事が来る
    if (resp.startsWith('=')) w.resolve(resp.slice(1).trim());
    else w.reject(new Error(`GTP error: ...`));
  }
}
```

- 標準出力は好きな位置で区切られて届くので、**バッファにためてから**区切り（空行）で分けます。Windows の改行（`\r\n`）も取り除いています。
- 返事は送った順に届くので、待っている Promise を配列（キュー）に入れ、先頭から解決します。
- 1手ごとに `clear_board` から全手順を送り直します（`load`）。エンジン側の状態とずれる心配がありません。
- 返事が来ない（タイムアウト）ときはプロセスを止め、次の要求で起動し直します。順番がずれたまま使い続けないためです。
- エンジンが盤外や不正な手を返したら、パスとして扱います（`games.ts`）。

### 5.2 座標の変換

```ts
const COLS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';   // I が抜けている
export function toVertex(p: number, size: number): string {
  if (p === PASS) return 'pass';
  return `${COLS[p % size]}${size - Math.floor(p / size)}`;   // 行は下から数える
}
```

GTP の座標は、列が `I` を飛ばしたアルファベット（`1` と見間違えないため）、行は**下から**1, 2, 3… です。内部の `y`（上から数える）とは逆なので変換が必要です。

## 練習問題

1. `EXPLORE` を 0 にすると、探索はどうなるでしょうか。逆に 10 のように大きくすると？
2. 9路盤で Lv1 と Lv3 を AI対AI で何局か対局させ、勝率の差を確かめてみましょう。プレイアウト数を2倍にすると強さはどれくらい変わるでしょうか。
3. 内蔵 AI を `worker_threads` で動かすには、何を別スレッドに送り、何を受け取ればよいでしょうか（`Game` クラスはそのまま送れない点に注意）。
4. `apps/server/test/fixtures/fake-gtp.mjs` を読み、GTP の最小の実装を理解しましょう。`name` コマンドに答えるように拡張してみてください。
5. 本格的な囲碁 AI（AlphaGo 以降）は、ランダムなプレイアウトの代わりに何を使っているでしょうか。調べてみましょう。

## 参考資料

- [GTP（Go Text Protocol）version 2 仕様](https://www.lysator.liu.se/~gunnar/gtp/)
- [Monte Carlo tree search（Wikipedia）](https://en.wikipedia.org/wiki/Monte_Carlo_tree_search)
- Gelly & Silver, *Monte-Carlo tree search and rapid action value estimation in computer Go*, Artificial Intelligence, 2011（RAVE の論文）
- [KataGo](https://github.com/lightvector/KataGo)
- [Node.js: child_process](https://nodejs.org/api/child_process.html) ／ [worker_threads](https://nodejs.org/api/worker_threads.html)
