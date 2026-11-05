# igo-server 技術要件書

> 対象コミット: `3c0c9b9`。この文書は**現在のコードが満たしている要件**を、ソースコードから逆算して整理したものです。
> 「今後の要件（未実装）」は README の計画と [システム解析レポート](system-analysis.md) の改善候補から抜き出しています。

## 目次

1. [システム概要](#1-システム概要)
2. [機能要件](#2-機能要件)
3. [非機能要件](#3-非機能要件)
4. [実行環境・インフラ要件](#4-実行環境インフラ要件)
5. [インターフェース仕様](#5-インターフェース仕様)
6. [データ要件](#6-データ要件)
7. [制約・前提](#7-制約前提)
8. [今後の要件（未実装）](#8-今後の要件未実装)

---

## 1. システム概要

| 項目 | 内容 |
|---|---|
| 名称 | 囲碁対局場（igo） |
| 目的 | ブラウザで人と人、人と AI、AI 同士が囲碁を打てるオンライン対局サービスの MVP |
| 利用者 | 登録ユーザー（対局・募集・チャット）、未ログインの閲覧者（観戦・棋譜閲覧） |
| 構成 | SPA（React）＋ API/リアルタイムサーバー（Fastify + Socket.IO）＋ PostgreSQL の3層 |
| 配置 | 1台の Node.js プロセスが API・WebSocket・静的ファイル配信をすべて担う |

## 2. 機能要件

### 2.1 アカウント

| ID | 要件 | 実装箇所 |
|---|---|---|
| F-ACC-01 | ユーザー名・パスワード・自己申告の棋力で登録できる | `POST /api/auth/register`（`apps/server/src/app.ts`） |
| F-ACC-02 | ユーザー名は半角英数字と `_` の3〜16文字。大文字小文字を区別せず一意 | `registerSchema`、`users_username_lower` インデックス |
| F-ACC-03 | パスワードは8〜200文字 | `registerSchema` |
| F-ACC-04 | 棋力は 30級〜1級、1段〜9段から選び、初期レーティングに変換する | `ratingForRank`（`packages/shared/src/rating.ts`） |
| F-ACC-05 | ログイン・ログアウトできる。ログイン状態は Cookie で30日保持 | `/api/auth/login`, `/api/auth/logout`, `SESSION_DAYS` |
| F-ACC-06 | 登録エラーはどの項目が悪いかを返す（`invalid_username` など） | `app.ts` の register ハンドラ |
| F-ACC-07 | プロフィールで棋力・レーティング・直近50局の履歴を見られる | `GET /api/users/:username`、`ProfilePage.tsx` |

### 2.2 ロビー・対局の開始

| ID | 要件 | 実装箇所 |
|---|---|---|
| F-LOB-01 | ロビーで募集一覧・対局中一覧・オンラインユーザー一覧をリアルタイムに見られる | `lobby:join` / `lobby:state` |
| F-LOB-02 | 盤の大きさ（9/13/19）、コミ（0.5刻み、±50）、置き石（0, 2〜9。9路・13路は5子まで）、ルール（日本/中国）、持ち時間、レーティング対象か、手番の色を指定して募集できる | `seekSchema`, `validHandicap`（`lobby.ts`） |
| F-LOB-03 | 1人が同時に出せる募集は3件まで | `MAX_SEEKS_PER_USER` |
| F-LOB-04 | 他人の募集を受諾すると対局が始まり、双方の画面が対局画面へ移る | `seek:accept` → `game:start` |
| F-LOB-05 | 対局中のユーザーは新しい募集・受諾ができない。対局が始まるとその人の他の募集は消える | `userInGame`, `seek:accept` |
| F-LOB-06 | 最後の接続が切れるとその人の募集は消える | `Lobby.disconnect` |

### 2.3 AI 対局

| ID | 要件 | 実装箇所 |
|---|---|---|
| F-AI-01 | 人対AI、AI対AI を選んですぐ始められる | `ai:start` |
| F-AI-02 | 内蔵 AI を3段階（Lv1〜Lv3）提供し、追加インストールを要しない | `BUILTIN_LEVELS`（`ai/builtin.ts`） |
| F-AI-03 | GTP 対応の外部エンジン（KataGo など）を設定ファイルだけで追加できる | `AI_GTP_ENGINES`, `ai/gtp.ts` |
| F-AI-04 | AI 対局はレーティングに影響しない | `rated: false` |
| F-AI-05 | AI 対 AI は1人1局、全体で4局まで | `MAX_AI_ONLY_GAMES(_PER_USER)` |
| F-AI-06 | AI は終局時に死に石を指定し、人が直したら合意し直す | `GameService.driveBots` |
| F-AI-07 | AI の着手に最低待ち時間を設ける（対人 0.4秒、AI同士 1秒） | `moveDelayMs`, `aiVsAiDelayMs` |

### 2.4 対局

| ID | 要件 | 実装箇所 |
|---|---|---|
| F-GAME-01 | 石を打つ、パス、投了ができる | `game:move` / `game:pass` / `game:resign` |
| F-GAME-02 | 取り、自殺手禁止、単純コウを判定する | `Board.play`（`packages/shared/src/board.ts`） |
| F-GAME-03 | 二連続パスで整地に入り、死に石を連単位で指定し、双方の合意で終局する | `Game.pass`, `toggleDead`, `acceptScore` |
| F-GAME-04 | 整地中に「再開」すると対局に戻れる | `game:resume` |
| F-GAME-05 | 日本ルール（地＋アゲハマ）と中国ルール（地＋盤上の石）で計算する | `score`（`scoring.ts`） |
| F-GAME-06 | 持ち時間は日本式秒読みとフィッシャーに対応し、サーバー側で時間切れを判定する | `clock.ts`, `GameService.schedule` |
| F-GAME-07 | 古い盤面に基づく着手（手数の食い違い）は拒否する | `moveNumber` の照合（`stale_move`） |
| F-GAME-08 | 誰でも観戦でき、観戦者数を表示する | `game:join`, `spectators()` |
| F-GAME-09 | 対局中にチャットでき、最大300文字、1局あたり直近200件を保持する | `game:chat`, `GameService.chat` |
| F-GAME-10 | 着手時に効果音を鳴らす | `clickSound`（`GamePage.tsx`） |

### 2.5 終局後・記録

| ID | 要件 | 実装箇所 |
|---|---|---|
| F-REC-01 | レーティング対象で双方合わせて4手以上の対局は Elo でレーティングを更新する（K=40、20局以降は20、置き石1子＝100点補正） | `finalize`, `updateRatings` |
| F-REC-02 | 棋譜を SGF でダウンロードできる（対局中も可） | `GET /api/games/:id/sgf` |
| F-REC-03 | 終局した対局を再生できる（← → キー対応） | `GET /api/games/:id`, `Replay` |
| F-REC-04 | サーバーを再起動しても対局中の碁を復元する | `GameService.loadActive` |

## 3. 非機能要件

### 3.1 性能・負荷

| ID | 要件 | 現状 |
|---|---|---|
| N-PERF-01 | 一手の処理は対局ごとに直列化し、同時操作で状態が壊れない | 対局ごとの Promise キュー（`GameService.run`） |
| N-PERF-02 | ロビーの配信は100ms単位でまとめ、配信回数を抑える | `broadcastLobby` |
| N-PERF-03 | 内蔵 AI の探索がサーバーを止めない | 15msごとに `setImmediate` で処理を返す。ただしメインスレッドで実行 |
| N-PERF-04 | DB 接続は最大10本 | `pg.Pool({ max: 10 })` |
| N-PERF-05 | GTP エンジンの1手は既定60秒で打ち切り、パス扱いにする | `timeoutMs` |

### 3.2 可用性・信頼性

| ID | 要件 | 現状 |
|---|---|---|
| N-REL-01 | 一手ごとに DB へ保存し、再起動後に続きから打てる | `commit` → `UPDATE games` |
| N-REL-02 | 終局処理（レーティング更新と結果保存）は1トランザクションで行う | `finalize`（`BEGIN`〜`COMMIT`、`FOR UPDATE`） |
| N-REL-03 | マイグレーションは複数プロセスが同時に起動しても二重に適用しない | `pg_advisory_lock` |
| N-REL-04 | 外部エンジンが異常終了・不正な手を返しても対局を続ける | プロセス再起動、不正な手はパスに変換 |
| N-REL-05 | SIGINT/SIGTERM で接続を閉じて終了する | `index.ts` |
| N-REL-06 | 冗長化（複数台構成） | **未対応**。ロビーと対局状態はメモリ上にある |

### 3.3 セキュリティ

| ID | 要件 | 現状 |
|---|---|---|
| N-SEC-01 | パスワードはソルト付き scrypt で保存する | `hashPassword` |
| N-SEC-02 | セッショントークンは推測できない乱数で、DB にはハッシュだけを保存する | 32バイト乱数＋SHA-256 |
| N-SEC-03 | Cookie は HttpOnly・SameSite=Lax。本番では Secure | `cookieOpts` |
| N-SEC-04 | ログイン・登録は1分あたり10回まで | `@fastify/rate-limit` |
| N-SEC-05 | 外部からの入力はすべてスキーマで検証する | zod |
| N-SEC-06 | SQL インジェクションを防ぐ | すべてプレースホルダ |
| N-SEC-07 | 対局操作は対局者本人だけが行える | `colorOf` による `not_a_player` |
| N-SEC-08 | コンテナは root 以外で動かす | Dockerfile の `USER node` |

既知の不足点は [システム解析レポートの6章](system-analysis.md#6-セキュリティ上の懸念点) を参照してください。

### 3.4 保守性

| ID | 要件 | 現状 |
|---|---|---|
| N-MNT-01 | ルールエンジンはサーバーとブラウザで同じコードを使う | `packages/shared` |
| N-MNT-02 | 通信の型をサーバーとクライアントで共有する | `protocol.ts` の `ClientToServerEvents` など |
| N-MNT-03 | 自動テストと型検査を CI で毎回実行する | `.github/workflows/ci.yml` |
| N-MNT-04 | AI エンジンは共通インターフェースで差し替えられる | `Engine`（`ai/engine.ts`） |

## 4. 実行環境・インフラ要件

### 4.1 ソフトウェア

| 種別 | バージョン | 用途 |
|---|---|---|
| Node.js | 22 | サーバー実行、ビルド |
| npm | 10（workspaces 対応） | 依存管理 |
| PostgreSQL | 16 | 永続化（本番 `igo`、テスト `igo_test`） |
| Docker / docker compose | 任意 | 本番相当の起動 |
| ブラウザ | ES2022・WebSocket・Web Audio 対応 | クライアント |
| GTP エンジン | 任意（KataGo など） | 強い AI を追加する場合 |

### 4.2 環境変数

| 変数 | 既定値 | 説明 |
|---|---|---|
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/igo` | 接続先 DB。本番では必ず指定する |
| `PORT` | `3000` | 待ち受けポート |
| `HOST` | `127.0.0.1`（Docker では `0.0.0.0`） | 待ち受けアドレス |
| `NODE_ENV` | なし | `production` で Cookie に Secure を付ける（HTTPS が必須）。`test` でログを止める |
| `SESSION_DAYS` | `30` | ログインを保持する日数 |
| `WEB_DIST` | なし（Docker では `/app/apps/web/dist`） | 配信する SPA のビルド結果 |
| `AI_GTP_ENGINES` | なし | 外部エンジン設定（JSON そのもの、またはファイルのパス） |
| `API_URL` | `http://localhost:3000` | 開発時に Vite が API を転送する先 |
| `TEST_DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/igo_test` | テスト用 DB（テストの最初に中身を消す） |

### 4.3 ポート・ネットワーク

| ポート | 用途 |
|---|---|
| 3000 | API・WebSocket・静的ファイル（本番は前段に HTTPS 終端のプロキシを置く前提） |
| 5173 | 開発時の Vite サーバー |
| 5432 | PostgreSQL |

## 5. インターフェース仕様

### 5.1 REST API

| メソッド | パス | 認証 | 説明 | 主なエラー |
|---|---|---|---|---|
| GET | `/api/health` | 不要 | 死活確認 `{ ok: true }` | — |
| POST | `/api/auth/register` | 不要 | `{ username, password, rank }` で登録し、ログイン状態にする | 400 `invalid_*`, 409 `username_taken`, 429 |
| POST | `/api/auth/login` | 不要 | `{ username, password }` でログイン | 400, 401 `bad_credentials`, 429 |
| POST | `/api/auth/logout` | 任意 | セッションを削除して Cookie を消す | — |
| GET | `/api/me` | 任意 | ログイン中のユーザー（未ログインなら `null`） | — |
| GET | `/api/users/:username` | 不要 | 公開プロフィールと直近50局 | 404 |
| GET | `/api/games/:id` | 不要 | 対局記録（再生用） | 404 |
| GET | `/api/games/:id/sgf` | 不要 | SGF ファイル（`application/x-go-sgf`） | 404 |

### 5.2 Socket.IO イベント

クライアントからサーバーへ送るイベントは、最後の引数の ack コールバックで `{ ok: true, ... }` か `{ ok: false, error }` を受け取ります（`lobby:leave` と `game:leave` だけは ack なし）。

| イベント | 引数 | ログイン | 説明 |
|---|---|---|---|
| `lobby:join` / `lobby:leave` | — | 不要 | ロビーの配信を受け取る／やめる |
| `seek:create` | `SeekRequest` | 必要 | 募集を出す |
| `seek:cancel` | `seekId` | 必要 | 自分の募集を取り消す |
| `seek:accept` | `seekId` | 必要 | 募集を受けて対局を始める |
| `ai:engines` | — | 不要 | 選べる AI の一覧 |
| `ai:start` | `AiGameRequest` | 必要 | AI 対局を始める |
| `game:join` / `game:leave` | `gameId` | 不要 | 対局の配信を受け取る（観戦）／やめる |
| `game:move` | `gameId, point, moveNumber` | 対局者 | 着手（`point = y * size + x`） |
| `game:pass` | `gameId, moveNumber` | 対局者 | パス |
| `game:resign` | `gameId` | 対局者 | 投了 |
| `game:toggleDead` | `gameId, point` | 対局者 | 整地中に死に石を切り替える |
| `game:acceptScore` | `gameId` | 対局者 | 整地結果に合意する |
| `game:resume` | `gameId` | 対局者 | 整地をやめて対局に戻る |
| `game:chat` | `gameId, text` | 必要 | チャットを送る |

サーバーからクライアントへ送るイベントです。

| イベント | 内容 |
|---|---|
| `lobby:state` | `LobbyState`（募集・対局中・オンライン） |
| `game:start` | 自分の対局が始まった（`gameId`） |
| `game:update` | `GameView`（盤面・持ち時間・サーバー時刻・チャットなど） |
| `game:chat` | 新しいチャット 1件 |

### 5.3 結果文字列

| 形式 | 意味 |
|---|---|
| `B+6.5` / `W+0.5` | 黒／白の目数勝ち |
| `B+R` / `W+R` | 中押し勝ち（相手の投了） |
| `B+T` / `W+T` | 時間勝ち |
| `Draw` | 持碁 |

### 5.4 外部エンジン（GTP）

| 送るコマンド | 用途 |
|---|---|
| `boardsize`, `clear_board`, `komi`, `set_free_handicap`, `play` | 盤面を毎回最初から再現する |
| `kata-set-rules` | KataGo 専用のルール指定。他のエンジンがエラーを返しても無視する |
| `genmove b/w` | 次の一手を求める |
| `final_status_list dead` | 死に石を求める |

## 6. データ要件

| データ | 保存先 | 保存期間 | 備考 |
|---|---|---|---|
| ユーザー | `users` | 無期限 | AI も1行として登録 |
| セッション | `sessions` | `expires_at` まで（期限切れも行は残る） | トークン本体は保存しない |
| 対局 | `games` | 無期限 | 着手は JSONB 配列、終局時に SGF も保存 |
| 適用済みマイグレーション | `schema_migrations` | 無期限 | — |
| 募集・オンライン一覧 | メモリ | プロセスが動いている間 | 再起動で消える |
| チャット | メモリ | 対局が終わるまで | DB に保存しない |

ER 図は [システム解析レポートの3章](system-analysis.md#3-データベースとテーブルの関連) を参照してください。

## 7. 制約・前提

- サーバーは1台で動かす前提です。対局状態・ロビー・回数制限の記録がプロセスのメモリにあるためです。
- 本番では前段のリバースプロキシで HTTPS を終端します（`NODE_ENV=production` で Cookie に Secure が付きます）。
- 再起動すると、手番側の持ち時間はその時点から計り直しになります。
- 日本ルールの整地では、セキの中の眼も地として数えます（MVP の制限、`scoring.ts` のコメント）。
- コウは単純コウだけを判定します。三コウなどの同形反復は、内蔵 AI の手数上限（盤の点数の2倍）でパスさせて止めています。

## 8. 今後の要件（未実装）

README の「今後の計画」と解析レポートから、優先度の高いものを挙げます。

| 区分 | 要件 |
|---|---|
| 公開前 | メール認証、パスワード再設定、利用規約・プライバシーポリシー |
| 公開前 | 切断時の扱い（再接続の猶予、放置による自動負け）、整地フェーズの時間制限 |
| 公開前 | 不正対策（AI 使用の検知、通報、ブロック、チャットのモデレーション） |
| 公開前 | 監視（エラー通知、メトリクス）、DB バックアップ |
| セキュリティ | `@fastify/static` の更新、`trustProxy` の限定、Socket.IO の Origin 検証、イベントの回数制限、セキュリティヘッダー |
| 規模拡大 | Redis アダプタによる複数台構成、ロビー情報の Redis 移行、AI の worker_threads 化 |
| 収益化 | プレミアム会員（`users.plan` を利用、Stripe の定期課金を想定）、広告、大会、指導碁 |
