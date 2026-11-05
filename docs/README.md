# ドキュメント

igo-server（囲碁対局場）の設計・調査・学習用のドキュメントです。

| ドキュメント | 内容 | 想定読者 |
|---|---|---|
| [システム解析レポート](system-analysis.md) | ディレクトリ構成、使用技術、DB 構成、処理の流れ、外部通信、セキュリティ上の懸念、古い依存、改善候補 | 開発者・レビュアー |
| [技術要件書](technical-requirements.md) | 現行の機能要件・非機能要件・実行環境・REST/Socket.IO の仕様・データ要件・制約と、[今後の開発予定](technical-requirements.md#8-今後の開発予定)（プロフィール管理、お知らせ、AI モデル連携、料金プランと Stripe 課金、動画収録向けの表示（着せ替え・形勢ゲージ）、スマホアプリ・PWA での提供） | 開発者・企画・運用担当 |
| [学習ガイド](learning/README.md) | このリポジトリを教材にした技術別の学習ドキュメント（全9章） | 新しく参加する開発者・学習者 |

## 学習ガイドの章

1. [TypeScript とモノレポ](learning/01-typescript-monorepo.md)
2. [囲碁のルールをコードにする](learning/02-go-rules-engine.md)
3. [Fastify で REST API を作る](learning/03-fastify-rest-api.md)
4. [Socket.IO でリアルタイム通信](learning/04-socketio-realtime.md)
5. [PostgreSQL とマイグレーション](learning/05-postgresql.md)
6. [認証とセキュリティ](learning/06-auth-security.md)
7. [React と Vite でフロントエンド](learning/07-react-vite.md)
8. [囲碁 AI（モンテカルロ探索と GTP）](learning/08-ai-engines.md)
9. [テスト・CI・Docker](learning/09-testing-ci-docker.md)

使い方やセットアップはリポジトリ直下の [README](../README.md) を参照してください。
