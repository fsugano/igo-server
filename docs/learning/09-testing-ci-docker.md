# 第9章 テスト・CI・Docker

[← 第8章](08-ai-engines.md) ｜ [目次](README.md)

## この章で学ぶこと

- 単体テストと結合テストの使い分け（Vitest）
- 実際の DB と WebSocket を使ったテストの書き方
- GitHub Actions による自動テスト（CI）
- Docker のマルチステージビルドと docker compose

## 1. テストの全体像

| ファイル | 種類 | 対象 | DB |
|---|---|---|---|
| `packages/shared/test/engine.test.ts` | 単体テスト | 盤、対局、SGF、持ち時間、レーティング | 不要 |
| `apps/server/test/ai.test.ts` | 単体テスト | `FastBoard`、内蔵 AI、GTP エンジン | 不要 |
| `apps/server/test/server.test.ts` | 結合テスト | 認証、対局、AI 対局を HTTP と WebSocket で通して確認 | `igo_test` を使う |

テストは合わせて35件あります（shared 21件、ai 7件、server 7件）。

```bash
npm test
```

```bash
npm test -w @igo/shared
```

2つ目は DB なしで動くルールエンジンのテストだけを実行します。

## 2. 単体テスト（純粋な関数を確かめる）

ルールエンジンは画面・通信・DB に依存しない**純粋なロジック**なので、入力と期待する出力を並べるだけでテストできます。

```ts
// packages/shared/test/engine.test.ts の補助関数
/** Builds a board from rows of '.', 'X' (black), 'O' (white). */
function boardFrom(rows: string[]): Board {
  const size = rows.length;
  const b = new Board(size);
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    if (ch === 'X') b.cells[y * size + x] = BLACK;
    if (ch === 'O') b.cells[y * size + x] = WHITE;
  }));
  return b;
}
```

盤面を文字の絵で書けるので、テストを読むだけでどんな局面かがわかります。この補助関数を使うと、たとえば「呼吸点がなくなった石が取られる」テストは次のように書けます（書き方の例です）。

```ts
import { describe, expect, it } from 'vitest';
import { BLACK, Board, WHITE } from '../src/index.js';

describe('board', () => {
  it('captures a stone with no liberties', () => {
    const b = boardFrom([
      '.X...',
      'XO...',
      '.....',
      '.....',
      '.....',
    ]);
    const r = b.play(b.idx(2, 1), BLACK);       // 白の右に打つ（残る呼吸点は下だけ）
    expect(typeof r).not.toBe('string');
    const r2 = (r as Exclude<typeof r, string>).board.play(b.idx(1, 2), BLACK); // 下もふさぐ
    expect(typeof r2 === 'string' ? [] : r2.captured).toEqual([b.idx(1, 1)]);
  });
});
```

第2章で見た「時刻を引数で受け取る」設計（`chargeMove(s, c, elapsed)`）のおかげで、持ち時間のテストも実際に待たずに書けます。

## 3. 結合テスト（本物のサーバーを起動する）

```ts
// apps/server/test/server.test.ts（要点）
const url = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/igo_test';

beforeAll(async () => {
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');   // DB を空にする
  await migrate(db);                                                      // 本物のマイグレーション
  const engines = [new BuiltinEngine(BUILTIN_LEVELS[0], 1), stub];        // シード固定の AI と偽 AI
  const { app } = await buildApp({ ...loadConfig({}), databaseUrl: url }, db,
                                 { engines, moveDelayMs: 0, aiVsAiDelayMs: 0 });
  await app.listen({ port: 0, host: '127.0.0.1' });                       // 空いているポートで起動
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
```

ここで第3章・第8章の設計が効いています。

| 設計 | テストでの効果 |
|---|---|
| `buildApp` が設定・DB・エンジンを引数で受け取る | テスト用 DB と偽 AI を渡せる |
| AI の待ち時間をオプションにしている | `moveDelayMs: 0` でテストが速く終わる |
| 乱数にシードを指定できる | 内蔵 AI の手が毎回同じになり、結果が安定する |
| ポート0で起動 | 他のプロセスとポートがぶつからない |

### 3.1 WebSocket のテスト

```ts
async function connect(cookie?: string): Promise<Client> {
  const s = ioClient(base, { extraHeaders: cookie ? { cookie } : {}, transports: ['websocket'] });
  await new Promise<void>((r) => s.on('connect', () => r()));
  return s;
}

const emit = (s, ev, ...args) => new Promise((r) => s.emit(ev, ...args, r));   // ack を待つ

const nextUpdate = (s, pred = () => true) => new Promise<GameView>((r) => {
  const h = (g) => { if (pred(g)) { s.off('game:update', h); r(g); } };
  s.on('game:update', h);
});
```

登録で受け取った Cookie を `extraHeaders` に付けて接続すると、そのユーザーとして操作できます。
「条件を満たす `game:update` が来るまで待つ」関数を作っておくと、非同期の配信を読みやすくテストできます。

### 3.2 外部プロセスのテスト

`test/fixtures/fake-gtp.mjs` は、GTP の最低限のコマンドだけに答える小さなプログラムです。KataGo をインストールしなくても、子プロセスの起動・通信・タイムアウトの処理をテストできます。

### 3.3 Vitest の設定

```ts
// apps/server/vitest.config.ts
export default defineConfig({
  test: { env: { NODE_ENV: 'test' }, testTimeout: 20_000, fileParallelism: false },
});
```

- `NODE_ENV: 'test'` で Fastify のログを止めます（`app.ts` の `logger` 設定）。
- `fileParallelism: false`：テストファイルを並列に実行しません。同じ `igo_test` DB を使うためです。
- `testTimeout`：AI の対局を最後まで打つテストがあるので、既定より長くしています。

## 4. CI（GitHub Actions）

```yaml
# .github/workflows/ci.yml
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:                   # テスト用の PostgreSQL をコンテナで起動
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: igo_test
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready --health-interval 2s --health-retries 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm              # 依存のダウンロードをキャッシュ
      - run: npm ci               # package-lock.json どおりに入れる
      - run: npm run build
      - run: npm run typecheck
      - run: npm test
```

- main への push とプルリクエストのたびに、ビルド・型検査・テストが自動で走ります。
- `services` で DB を用意するので、結合テストも CI で実行できます。`--health-cmd` で DB が準備できるまで待ちます。
- `npm ci` は `npm install` と違い、`package-lock.json` を書き換えず、そのとおりのバージョンを入れます。CI と本番で同じバージョンになります。

## 5. Docker

### 5.1 マルチステージビルド

```dockerfile
# Dockerfile
FROM node:22-slim AS build              # ① ビルド用
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci                              # 依存だけ先に入れる
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim                       # ② 実行用（ビルド結果だけを持ってくる）
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 WEB_DIST=/app/apps/web/dist
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/migrations apps/server/migrations
COPY --from=build /app/apps/web/dist apps/web/dist
...
USER node                               # root で動かさない
CMD ["node", "apps/server/dist/index.js"]
```

| 工夫 | 効果 |
|---|---|
| ビルドと実行を分ける | TypeScript や Vite などの開発用ツールが実行用イメージに入らず、小さく安全になる |
| `package.json` だけ先にコピーして `npm ci` | ソースを変えても依存が変わらなければ、`npm ci` の層がキャッシュされ速くビルドできる |
| `npm prune --omit=dev` | 開発用の依存を削除 |
| `USER node` | 万一乗っ取られても root 権限を持たない |
| `HOST=0.0.0.0` | コンテナの外から接続できるようにする（既定の 127.0.0.1 では外から届かない） |
| `.dockerignore` | `node_modules` や `dist` をイメージに送らない |

### 5.2 docker compose

```yaml
# docker-compose.yml（要点）
services:
  db:
    image: postgres:16
    volumes:
      - pgdata:/var/lib/postgresql/data     # コンテナを消してもデータが残る
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
  app:
    build: .
    environment:
      DATABASE_URL: postgres://postgres:postgres@db:5432/igo   # ホスト名はサービス名の db
    depends_on:
      db:
        condition: service_healthy          # DB が準備できてから起動
```

```bash
docker compose up --build
```

http://localhost:3000 で、本番に近い構成（サーバーが画面も配信）で動きます。

> **注意**：compose の DB パスワードと `NODE_ENV: development` は手元での確認用です。公開する環境ではそのまま使わないでください（[第6章](06-auth-security.md)）。

## 練習問題

1. `packages/shared/test/engine.test.ts` にフィッシャー方式の持ち時間のテストを追加しましょう（上限 `maxTime` を超えないこと）。
2. CI に `npm audit --omit=dev --audit-level=high` を追加すると、現状では失敗します。なぜでしょうか（[解析レポートの7章](../system-analysis.md#7-古いライブラリ非推奨の機能)）。
3. Dockerfile で `COPY . .` を `npm ci` より前に書くと、ビルドの速さはどう変わるでしょうか。
4. `server.test.ts` は実際の DB を使っています。DB をモック（偽物）に置き換えたテストと比べて、長所と短所を挙げてください。
5. コンテナに `HEALTHCHECK` を追加して `/api/health` を確認するようにしてみましょう。

## 参考資料

- [Vitest 公式ドキュメント](https://vitest.dev/)
- [GitHub Actions ドキュメント](https://docs.github.com/ja/actions)（サービスコンテナ、Node.js のビルドとテスト）
- [Docker: Multi-stage builds](https://docs.docker.com/build/building/multi-stage/)
- [Docker Compose ドキュメント](https://docs.docker.com/compose/)
- [npm ci](https://docs.npmjs.com/cli/commands/npm-ci)
