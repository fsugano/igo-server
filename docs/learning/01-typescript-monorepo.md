# 第1章 TypeScript とモノレポ

[← 目次へ](README.md) ｜ [次へ：第2章 ルールエンジン →](02-go-rules-engine.md)

## この章で学ぶこと

- TypeScript の型がバグをどう防ぐか
- 1つのリポジトリに複数のパッケージを置く「モノレポ」と npm workspaces
- `tsconfig.json` の主な設定と、サーバー用・ブラウザ用で設定が違う理由
- ESM（`import`/`export`）と、Node.js で `.js` 拡張子を付けて import する理由

## 1. TypeScript の基本

TypeScript は JavaScript に「型」を加えた言語です。実行前に `tsc`（TypeScript コンパイラ）が型を検査し、JavaScript に変換します。

### 1.1 リテラル型とユニオン型

このリポジトリでは、取りうる値を型で限定する書き方が多く使われています。

```ts
// packages/shared/src/board.ts
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;
export type Stone = typeof BLACK | typeof WHITE;   // 1 | 2 のどちらか
export type Cell = typeof EMPTY | Stone;           // 0 | 1 | 2

export type MoveError = 'occupied' | 'suicide' | 'ko' | 'out_of_bounds';
```

`Stone` 型の変数には 1 か 2 しか入りません。`3` を渡そうとするとコンパイルエラーになります。
エラーを文字列のユニオン型で表しておくと、タイプミス（`'ocupied'` など）もコンパイル時に見つかります。

### 1.2 判別可能なユニオン（Discriminated Union）

共通のプロパティ（ここでは `type`）で種類を見分けるユニオン型です。

```ts
// packages/shared/src/clock.ts
export type ClockSettings =
  | { type: 'byoyomi'; mainTime: number; periods: number; periodTime: number }
  | { type: 'fischer'; mainTime: number; increment: number; maxTime: number };

export function timeUntilFlag(s: ClockSettings, c: PlayerClock): number {
  if (s.type === 'byoyomi') return c.main + c.periods * s.periodTime; // ここでは s は byoyomi 型
  return c.main;                                                       // ここでは s は fischer 型
}
```

`if (s.type === 'byoyomi')` の中では、TypeScript が `s` を秒読みの型だと判断します（**型の絞り込み**）。
そのため `s.periodTime` を安全に参照できます。

### 1.3 結果を値で返す

このリポジトリは、失敗を例外ではなく**戻り値**で表すことが多いです。

```ts
// packages/shared/src/board.ts
play(p: number, color: Stone, koPoint = -1): PlayResult | MoveError { ... }

// 呼び出し側（packages/shared/src/game.ts）
const r = this.board.play(p, color, this.koPoint);
if (typeof r === 'string') return r;   // エラー（MoveError）
this.board = r.board;                  // 成功（PlayResult）
```

戻り値の型に失敗が含まれるので、呼び出す側はエラー処理を忘れにくくなります。
サーバーの API も同じ考え方で、`{ ok: true } | { ok: false; error: string }` を返します（`games.ts` の `Result` 型）。

### 1.4 ジェネリクス

型をパラメーターとして受け取る仕組みです。

```ts
// packages/shared/src/protocol.ts
export type Ack<T = {}> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

// 使う側
'lobby:join': (ack: Ack<{ lobby: LobbyState }>) => void;
```

`Ack<{ lobby: LobbyState }>` と書くと「成功時は `lobby` も一緒に返すコールバック」という型になります。

## 2. モノレポと npm workspaces

### 2.1 なぜパッケージを分けるのか

| パッケージ | 役割 | 動く場所 |
|---|---|---|
| `packages/shared` | 囲碁のルール、持ち時間、SGF、通信の型 | サーバーとブラウザの両方 |
| `apps/server` | API と対局サーバー | Node.js |
| `apps/web` | 画面 | ブラウザ |

囲碁のルール（どこに打てるか、石が取れるか）は、サーバーでもブラウザでも必要です。
サーバーは不正な手を拒否するために、ブラウザは打てない場所を事前に知らせたり棋譜を再生したりするために使います。
同じコードを `shared` に置くことで、**ルールの食い違いが起こりません**。

### 2.2 workspaces の設定

```json
// package.json（リポジトリ直下）
{
  "workspaces": ["packages/shared", "apps/server", "apps/web"],
  "scripts": {
    "build": "npm run build -w @igo/shared && npm run build -w @igo/web && npm run build -w @igo/server",
    "predev": "npm run build -w @igo/shared"
  }
}
```

- `npm install` を直下で1回実行すると、3パッケージの依存がまとめて入ります。
- `apps/server/package.json` に `"@igo/shared": "0.1.0"` と書くと、npm は `node_modules/@igo/shared` から `packages/shared` へのリンクを作ります。
- `-w @igo/server` で特定のパッケージのスクリプトを実行します。
- `predev` は `dev` の前に自動で実行されます（npm の `pre` スクリプト）。サーバーは `shared` のビルド結果（`dist/`）を読むので、先にビルドが必要です。

### 2.3 ブラウザ側は shared をソースのまま読む

```ts
// apps/web/vite.config.ts
resolve: {
  alias: { '@igo/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) },
},
```

Vite は TypeScript を直接扱えるので、ブラウザ側は `shared` をビルドせずにソースを読みます。`shared` を書き換えるとすぐ画面に反映されます。

## 3. tsconfig の読み方

```json
// tsconfig.base.json（共通設定）
{
  "compilerOptions": {
    "target": "ES2022",          // 出力する JavaScript の世代
    "module": "NodeNext",        // Node.js の ESM 方式で import を扱う
    "moduleResolution": "NodeNext",
    "strict": true,              // 厳しい型検査をすべて有効にする
    "declaration": true,         // .d.ts（型定義）も出力する
    "sourceMap": true,
    "isolatedModules": true      // ファイル単位で変換できる書き方に限定する
  }
}
```

ブラウザ用（`apps/web/tsconfig.json`）だけは次の点が違います。

| 設定 | サーバー・shared | web | 理由 |
|---|---|---|---|
| `module` / `moduleResolution` | `NodeNext` | `ESNext` / `Bundler` | web は Vite（バンドラー）が import を解決する |
| `lib` | 既定 | `DOM` を追加 | `document` や `window` を使う |
| `jsx` | なし | `react-jsx` | JSX を書く |
| `noEmit` | なし | `true` | 変換は Vite が行うので、tsc は型検査だけ |

## 4. ESM と `.js` 拡張子

サーバーのコードは `.ts` なのに、import では `.js` と書いています。

```ts
// apps/server/src/index.ts
import { buildApp } from './app.js';
```

Node.js の ESM は import のパスを書き換えません。`tsc` が `app.ts` を `app.js` に変換したあと、実行時に読まれるのは `app.js` です。
そのため、**変換後のファイル名**を書くのが `NodeNext` の決まりです。
`package.json` の `"type": "module"` は、そのパッケージの `.js` を ESM として扱う指定です。

トップレベル `await` も ESM ならではの機能です。

```ts
// apps/server/src/index.ts
const db = createDb(config.databaseUrl);
await migrate(db);          // 関数の外で await できる
```

## 練習問題

1. `packages/shared/src/board.ts` の `Stone` 型の変数に `3` を代入するコードを書き、`npm run typecheck` でどんなエラーが出るか確かめましょう。
2. `ClockSettings` に「切れ負け（持ち時間だけ）」の種類 `{ type: 'absolute'; mainTime: number }` を追加すると、どのファイルでコンパイルエラーが出るでしょうか。エラーになった場所が、対応が必要な場所です。
3. `apps/server/src/app.ts` の import から `.js` を消して `npm run build -w @igo/server` を実行し、どうなるか確認しましょう（確認したら元に戻してください）。
4. `npm run dev` の前に `predev` で `shared` をビルドしている理由を、サーバーと web の読み込み方の違いから説明してください。

## 参考資料

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)（特に Narrowing と Generics の章）
- [TSConfig Reference](https://www.typescriptlang.org/tsconfig)
- [npm workspaces](https://docs.npmjs.com/cli/using-npm/workspaces)
- [Node.js: ECMAScript modules](https://nodejs.org/api/esm.html)
