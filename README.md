# 囲碁対局場

パンダネット・東洋囲碁・野狐囲碁のようなオンライン囲碁対局サービスの MVP です。

## できること

- アカウント登録・ログイン（自己申告の棋力から初期レーティングを設定）
- ロビー：対局の募集・受諾、対局中の一覧、オンラインユーザー一覧
- 9 / 13 / 19 路の対局（置き碁 2〜9 子、コミ自由、日本ルール / 中国ルール）
- 石の取り上げ、コウ、自殺手禁止、パス、投了
- 二連続パスで整地へ：死に石をクリックで指定し、双方が合意すると終局
- 持ち時間：日本式秒読み / フィッシャー。時間はサーバー側で管理し、時間切れは自動で負け
- 観戦、対局チャット、着手音
- 棋譜：SGF ダウンロード、終局後の棋譜再生（← → キー対応）
- レーティング（Elo 方式、100 点 = 1 段級）とプロフィールの対局履歴
- 対局モードの切り替え：人対人（募集・受諾）／人対AI／AI対AI（観戦）。AI との対局はレーティングに影響しません

## AI（コンピューター）

ロビーの「対局を始める」で **人対AI** か **AI対AI** を選ぶと、すぐに対局が始まります。AI 同士の対局はロビーの「対局中」から誰でも観戦できます（1 人 1 局、全体で 4 局まで）。

- **内蔵 AI**（追加インストール不要）：モンテカルロ探索（ランダム対局 + AMAF）。入門 Lv1 / 初級 Lv2 / 中級 Lv3 の 3 段階で、強さは 1 手あたりの読みの量の違いです。9 路で遊ぶのが一番楽しめます。19 路では弱めです。
- AI はアカウント（`AI-Lv1` など）として対局に参加します。名前に `-` が入るので人のアカウントと重なりません。ログインはできません。
- 二連続パスのあとは AI が死に石を指定して合意します。人が死に石を直すと、AI はそのまま合意し直します。
- 対局中にサーバーを再起動しても、AI の手番から続きを打ちます。

### KataGo など外部エンジンをつなぐ

GTP（Go Text Protocol）に対応したエンジンなら、設定を JSON で書くだけで AI の選択肢に加わります。例：KataGo を Windows で使う場合、`ai-engines.json` を作って

```json
[
  {
    "id": "katago",
    "name": "KataGo",
    "label": "KataGo（最強）",
    "rank": "9d",
    "command": "C:/katago/katago.exe",
    "args": ["gtp", "-model", "C:/katago/model.bin.gz", "-config", "C:/katago/gtp_example.cfg"]
  }
]
```

環境変数 `AI_GTP_ENGINES` にそのファイルの場所（または JSON そのもの）を入れてから起動します。

```bat
set AI_GTP_ENGINES=C:\Users\PC\Desktop\ai-site\igo-server\ai-engines.json
npm run dev
```

- `name` は英数字と `_`（アカウント名は `AI-KataGo` になります）、`rank` は表示用の棋力（`9d`、`5k` など）
- 1 手あたりの考える時間は KataGo の設定ファイル（`maxVisits` や `maxTime`）で調整します
- 新しいエンジンの組み込み方：`apps/server/src/ai/engine.ts` の `Engine` を実装して `apps/server/src/ai/index.ts` の `loadEngines` に加えます

## 構成

| 場所 | 中身 |
| --- | --- |
| `packages/shared` | 囲碁ルールエンジン（盤・コウ・整地）、持ち時間、SGF、レーティング、通信の型。サーバーとブラウザで共通 |
| `apps/server` | Fastify（REST API）+ Socket.IO（リアルタイム対局）+ PostgreSQL。`src/ai` に AI エンジン |
| `apps/web` | React + Vite の画面 |

対局中の状態はサーバーのメモリにあり、一手ごとに PostgreSQL へ保存します。サーバーを再起動しても対局中の碁は復元されます。

## 開発環境で動かす

必要なもの：Node.js 22、PostgreSQL 16

```bash
npm install
createdb igo            # DATABASE_URL の既定値は postgres://postgres:postgres@localhost:5432/igo
npm run migrate
npm run dev             # API: http://127.0.0.1:3000 / 画面: http://localhost:5173
```

サーバーは既定で 127.0.0.1 だけで待ち受けるので、ほかのPCからは接続できません（Docker イメージでは 0.0.0.0）。

PostgreSQL をインストールしていない場合は、Docker で起動できます。

```bash
docker run -d --name igo-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=igo -p 127.0.0.1:5432:5432 postgres:16
```

Windows の PowerShell で「スクリプトの実行が無効」と出る場合は、`npm` の代わりに `npm.cmd` を使うか、コマンドプロンプトで実行してください。

テスト（`igo_test` データベースを使います。中身は毎回消去されます）：

```bash
createdb igo_test
npm test
```

## 本番用に動かす

```bash
docker compose up --build   # http://localhost:3000
```

単体のコンテナとして Fly.io、Render、Google Cloud Run、AWS ECS などに載せられます。環境変数は `DATABASE_URL`、`PORT`、`NODE_ENV=production`（HTTPS 必須。Cookie が Secure になります）です。

## 今後の計画

### 公開前に必要なこと

- メール認証、パスワード再設定、利用規約・プライバシーポリシー
- 切断時の扱い（再接続猶予、放置による自動負け）、整地フェーズの時間制限
- 不正対策：AI 使用の検知（着手一致率）、通報、ブロック、チャットのモデレーション
- 監視（エラー通知、メトリクス）、DB バックアップ

### 規模拡大

- Socket.IO の Redis アダプタで複数サーバー化し、対局ごとに担当サーバーを決める
- ロビーの募集・オンライン情報を Redis に移す

### 収益化の案

- **プレミアム会員（月額）**：AI による対局後の検討・形勢グラフ、棋譜の無制限保存、広告なし、プロフィールの装飾
- **広告**：無料会員のロビー・観戦画面
- **大会・リーグ**：参加費制の大会、スポンサー付きのリーグ戦
- **指導碁・講座**：プロ棋士やインストラクターによる有料指導碁（手数料モデル）
- **観戦**：プロ・強豪の対局中継と解説

データベースの `users.plan` 列にプレミアム会員の印を用意してあります。決済は Stripe の定期課金を想定しています。
