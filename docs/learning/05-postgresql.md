# 第5章 PostgreSQL とマイグレーション

[← 第4章](04-socketio-realtime.md) ｜ [目次](README.md) ｜ [次へ：第6章 認証とセキュリティ →](06-auth-security.md)

## この章で学ぶこと

- テーブル設計（主キー、外部キー、インデックス、JSONB）
- `pg` ドライバでの SQL 実行と、プレースホルダの重要性
- マイグレーションの仕組みと、アドバイザリロックによる排他
- トランザクションと行ロック（`FOR UPDATE`）

## 1. テーブル設計

```sql
-- apps/server/migrations/001_init.sql（抜粋）
CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  rating        DOUBLE PRECISION NOT NULL,
  ...
);
CREATE UNIQUE INDEX users_username_lower ON users (lower(username));

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  ...
);
```

| 仕組み | このリポジトリでの例 | 役割 |
|---|---|---|
| `BIGSERIAL PRIMARY KEY` | `users.id`, `games.id` | 自動で増える一意の番号 |
| `REFERENCES` | `sessions.user_id`, `games.black_id` | 存在しないユーザーを参照できない（外部キー） |
| `ON DELETE CASCADE` | `sessions.user_id` | ユーザーを消すとセッションも消える |
| 式インデックス | `lower(username)` の UNIQUE | 大文字小文字を区別せず重複を禁止 |
| 部分インデックス | `games (status) WHERE status = 'active'` | 対局中の行だけを索引にする（再起動時の検索用） |
| 複合インデックス | `games (black_id, started_at DESC)` | 「あるユーザーの新しい対局順」の検索を速くする |
| `TIMESTAMPTZ` | `created_at` など | タイムゾーン付きの時刻 |

### 1.1 式インデックスで大文字小文字を無視する

`Alice` と `alice` を別人として登録させないために、`lower(username)` にユニークインデックスを張っています。
検索側も同じ式を使わないとインデックスが使われません。

```ts
// apps/server/src/users.ts
'SELECT * FROM users WHERE lower(username) = lower($1)'
```

### 1.2 JSONB の使いどころ

```sql
settings        JSONB NOT NULL,   -- { size, komi, handicap, ruleset }
clock_settings  JSONB NOT NULL,
moves           JSONB NOT NULL DEFAULT '[]',   -- [{ c: 1, p: 72 }, ...]
```

JSONB は JSON をバイナリで保存する型です。構造が変わりやすい設定や、まとめて読み書きする配列に向いています。

| 方法 | 長所 | 短所 |
|---|---|---|
| JSONB に配列で保存（現在） | 1行で完結し、読み書きが簡単 | 一手ごとに配列全体を書き直す。特定の手での検索は苦手 |
| `moves` テーブルに1手1行 | 追記だけで済む。手単位で検索できる | テーブルと JOIN が増える |

小さな MVP では JSONB で十分ですが、規模が大きくなると改善候補になります（[解析レポート](../system-analysis.md#9-改善候補優先度順)）。

## 2. pg ドライバと接続プール

```ts
// apps/server/src/db.ts
export function createDb(url: string): Db {
  return new pg.Pool({ connectionString: url, max: 10 });
}
```

DB への接続を作るのは時間がかかるので、**接続プール**で最大10本を使い回します。
`pool.query()` は空いている接続を自動で借りて返します。トランザクションのように同じ接続で複数の SQL を実行したいときは `pool.connect()` で接続を1本借ります（4章で後述）。

### 2.1 プレースホルダ（SQL インジェクション対策）

```ts
// 正しい：値は $1, $2 で別に渡す
await db.query('SELECT * FROM users WHERE id = $1', [id]);

// 危険：文字列をつなげて SQL を作る（このリポジトリでは使っていません）
await db.query(`SELECT * FROM users WHERE username = '${username}'`);
```

後者に `' OR '1'='1` のような値を入れられると、SQL の意味が変わってしまいます（SQL インジェクション）。
プレースホルダを使うと、値は SQL の構文として解釈されません。

### 2.2 よく使う SQL の書き方

```sql
-- 登録：重複なら何もしない。挿入できたら行を返す
INSERT INTO users (username, password_hash, rating) VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING RETURNING *

-- AI アカウント：あれば更新、なければ作成（UPSERT）
INSERT INTO users (...) VALUES (...)
ON CONFLICT (lower(username)) DO UPDATE SET bot = EXCLUDED.bot, rating = EXCLUDED.rating

-- 期限付きのセッション
INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))

-- 結合した行を JSON でまとめて取る
SELECT g.*, row_to_json(b) AS b, row_to_json(w) AS w FROM games g
JOIN users b ON b.id = g.black_id JOIN users w ON w.id = g.white_id
```

`ON CONFLICT DO NOTHING RETURNING *` は、「先に存在確認してから INSERT」と違い、**同時に2人が同じ名前で登録しても**片方だけが成功します。確認と挿入の間に割り込まれる心配がありません。

## 3. マイグレーション

マイグレーションは、DB の構造の変更を順番付きのファイルで管理する仕組みです。

```
apps/server/migrations/
├── 001_init.sql     # テーブル作成
└── 002_bots.sql     # ALTER TABLE users ADD COLUMN bot TEXT;
```

```ts
// apps/server/src/db.ts（要点）
await client.query('SELECT pg_advisory_lock(727272)');      // ① 排他ロック
await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (...)');
const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
for (const f of files) {                                      // ファイル名順
  if (done.has(f)) continue;                                  // ② 適用済みはとばす
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
  await client.query('COMMIT');                               // ③ 1ファイル1トランザクション
}
...
await client.query('SELECT pg_advisory_unlock(727272)');
```

1. **アドバイザリロック**：アプリが決めた番号（727272）でロックを取ります。サーバーが2台同時に起動しても、マイグレーションは1台ずつしか走りません。
2. **適用済みの記録**：`schema_migrations` に適用したファイル名を残し、二度実行しません。
3. **トランザクション**：PostgreSQL は `CREATE TABLE` などもトランザクションの中で実行できます。途中で失敗すると、そのファイルの変更はすべて取り消されます。

> 一度適用したマイグレーションファイルは**書き換えない**のが原則です。変更は新しい番号のファイル（`003_...sql`）で追加します。

## 4. トランザクションと行ロック

終局時は「両者のレーティング更新」と「対局結果の保存」を必ずまとめて行う必要があります。

```ts
// apps/server/src/games.ts（finalize の要点）
const client = await this.db.connect();     // 接続を1本借りる
try {
  await client.query('BEGIN');
  const users = await client.query('SELECT * FROM users WHERE id = ANY($1) FOR UPDATE', [[g.black.id, g.white.id]]);
  // ... 新しいレーティングを計算
  await client.query('UPDATE users SET rating = $2, games_played = games_played + 1 WHERE id = $1', [b.id, nr.black]);
  await client.query('UPDATE users SET rating = $2, games_played = games_played + 1 WHERE id = $1', [w.id, nr.white]);
  await client.query(`UPDATE games SET status = 'finished', ... WHERE id = $1`, [...]);
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  client.release();                         // 必ず接続を返す
}
```

- `BEGIN` 〜 `COMMIT` の間の変更は、**全部反映されるか、全部取り消されるか**のどちらかです（原子性）。
- `FOR UPDATE` は読んだ行にロックをかけます。同じユーザーの別の対局が同時に終わっても、レーティングの計算が上書きし合いません（読んでから書くまでの間に他が書けない）。
- `finally` で `release()` しないと、接続がプールに戻らず、やがて全接続が使い切られます。

## 5. 便利な確認コマンド

```bash
psql postgres://postgres:postgres@localhost:5432/igo
```

```sql
\dt                                  -- テーブル一覧
\d games                             -- テーブル定義とインデックス
SELECT * FROM schema_migrations;     -- 適用済みマイグレーション
SELECT id, status, jsonb_array_length(moves) FROM games ORDER BY id DESC LIMIT 5;
EXPLAIN ANALYZE SELECT * FROM games WHERE black_id = 1 ORDER BY started_at DESC LIMIT 50;
```

`EXPLAIN ANALYZE` で、インデックスが使われているか（`Index Scan` か `Seq Scan` か）を確認できます。

## 練習問題

1. 期限切れのセッションを削除する SQL を書きましょう。それを定期的に実行するには、アプリのどこに処理を置けばよいでしょうか。
2. `games.status` に `'active'` と `'finished'` 以外が入らないようにする `CHECK` 制約を、新しいマイグレーション `003_...sql` として書いてください。
3. `finalize` から `FOR UPDATE` を外すと、どんなタイミングで何が起こりうるでしょうか。2つの対局が同時に終わる場面で説明してください。
4. `moves` を別テーブルに分ける設計を考え、`CREATE TABLE` 文と、一手追加するときの SQL を書いてみましょう。

## 参考資料

- [PostgreSQL 16 文書（日本語）](https://www.postgresql.jp/document/16/html/)（データ定義、インデックス、明示的ロック、JSON 型）
- [node-postgres（pg）ドキュメント](https://node-postgres.com/)（Pooling, Transactions）
- [OWASP: SQL Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html)
