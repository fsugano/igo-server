# 第6章 認証とセキュリティ

[← 第5章](05-postgresql.md) ｜ [目次](README.md) ｜ [次へ：第7章 React と Vite →](07-react-vite.md)

## この章で学ぶこと

- パスワードを安全に保存する方法（ソルト、遅いハッシュ関数）
- Cookie セッション方式のログインと、Cookie の属性
- 回数制限、入力検証、認可（誰が何をしてよいか）
- このリポジトリに残っている課題から、攻撃の考え方を学ぶ

## 1. パスワードの保存

### 1.1 なぜそのまま保存してはいけないか

DB が漏れたとき、パスワードがそのまま入っていると、他のサービスでも同じパスワードを使っている人が被害を受けます。
そこで、元に戻せない**ハッシュ値**だけを保存し、ログイン時は入力をハッシュして比べます。

### 1.2 scrypt とソルト

```ts
// apps/server/src/users.ts
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);                    // ユーザーごとに違う乱数
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [algo, saltB64, keyB64] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const key = Buffer.from(keyB64, 'base64');
  const got = await scrypt(pw, Buffer.from(saltB64, 'base64'), key.length);
  return timingSafeEqual(key, got);
}
```

| 工夫 | 理由 |
|---|---|
| **ソルト**（ユーザーごとの乱数） | 同じパスワードでも違うハッシュになる。事前計算した対応表（レインボーテーブル）が使えない |
| **scrypt**（わざと遅く、メモリも使う関数） | SHA-256 のような速い関数だと、総当たりが毎秒何十億回もできてしまう |
| **`timingSafeEqual`** | 先頭から比べて違ったらすぐ終わる比較だと、応答時間の差から情報が漏れる |
| **形式に `scrypt$` を付ける** | 将来アルゴリズムを変えても、どの方式で作ったハッシュか区別できる |

AI アカウントのハッシュは `'!'` です。`split('$')` の結果が `scrypt` で始まらないので、どんなパスワードでもログインできません。

## 2. セッション（ログイン状態の保持）

```ts
// apps/server/src/users.ts
async createSession(userId: string, days: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');   // 256ビットの乱数
  await this.db.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`,
    [hashToken(token), userId, days],                     // DB には SHA-256 だけ
  );
  return token;                                           // 本体は Cookie でブラウザへ
}
```

- トークンは推測できない十分な長さの乱数です。
- DB にはトークンのハッシュだけを保存します。DB が漏れても、そこから有効な Cookie は作れません。
  （トークン自体が十分ランダムなので、ここではソルトや遅いハッシュは不要です。）
- ログアウトでは DB の行を消すので、サーバー側でセッションを確実に無効にできます。

### 2.1 Cookie の属性

```ts
// apps/server/src/app.ts
const cookieOpts = {
  path: '/',
  httpOnly: true,                  // JavaScript から読めない
  sameSite: 'lax' as const,        // 他サイトからの POST などに Cookie を付けない
  secure: config.secureCookies,    // HTTPS のときだけ送る（本番）
  maxAge: config.sessionDays * 86400,
};
```

| 属性 | 防ぐもの |
|---|---|
| `HttpOnly` | XSS（悪意ある JavaScript）による Cookie の盗み出し |
| `SameSite=Lax` | CSRF（他サイトに仕込まれたフォームから勝手に操作される） |
| `Secure` | 暗号化されていない通信での盗聴 |

## 3. 認可（誰が何をしてよいか）

認証は「誰か」を確かめること、認可は「その人がその操作をしてよいか」を確かめることです。

```ts
// apps/server/src/games.ts
const color = colorOf(g);                                   // このユーザーは黒か白か
if (playerOnly && !color) return { ok: false, error: 'not_a_player' };
```

対局者でない人は、どの対局にも着手や投了ができません。**画面でボタンを隠すだけでは不十分**で、サーバーで必ず確かめる必要があります。

## 4. 回数制限と入力検証

```ts
const authLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };
```

ログインを1分10回までにして、パスワードの総当たりを遅くします。入力は zod で検証し（第3章）、SQL はプレースホルダで渡します（第5章）。
React は表示する文字列を自動でエスケープするので、チャットに `<script>` と書かれても実行されません（第7章）。

## 5. 残っている課題から学ぶ

[解析レポート](../system-analysis.md#6-セキュリティ上の懸念点) で挙げた課題を、攻撃する側の視点で見てみましょう。

### 5.1 `trustProxy: true` と回数制限の回避

```ts
const app = Fastify({ logger: ..., trustProxy: true });
```

`trustProxy: true` にすると、Fastify は `X-Forwarded-For` ヘッダーの値をクライアントの IP として使います。
本来は前段のプロキシが付けるヘッダーですが、**誰でも自由に付けられます**。攻撃者が毎回違う値を付ければ、IP ごとの回数制限は効きません。

```bash
# 攻撃のイメージ（自分の環境以外で試してはいけません）
curl -H "X-Forwarded-For: 10.0.0.$RANDOM" -X POST http://localhost:3000/api/auth/login ...
```

対策は、信頼するプロキシの段数（`trustProxy: 1`）や IP アドレスだけを指定することです。

### 5.2 応答時間でユーザーの存在がわかる

```ts
const u = await users.byName(p.data.username);
if (!u || !(await verifyPassword(p.data.password, u.password_hash))) { ... }
```

ユーザーがいなければ scrypt を計算しないので、すぐに 401 が返ります。いれば scrypt の分だけ遅くなります。
応答時間を測れば、そのユーザー名が登録されているかがわかります。ユーザーがいないときもダミーのハッシュで照合すれば、時間がそろいます。

### 5.3 WebSocket の Origin

WebSocket には、通常の fetch のような CORS の制限がかかりません。Cookie で認証している場合、別のサイトのページから接続されるおそれがあります（Cross-Site WebSocket Hijacking）。
`SameSite=Lax` で多くは防げますが、同じサイト扱いになるサブドメインからは防げません。接続時に `Origin` ヘッダーを確かめるのが確実です。

### 5.4 リソースを使い切らせる攻撃

内蔵 AI は1手に最大4秒 CPU を使います。人対AI の対局数に全体の上限がないので、アカウントを多く作れば CPU を使い切らせることができます。
「1回の操作でサーバーにどれだけ負荷がかかるか」を考え、重い処理には上限を設けることが大切です。

## 6. チェックリスト

新しい機能を作るときに確かめましょう。

- [ ] 外部からの入力をすべて実行時に検証しているか（型注釈だけで済ませていないか）
- [ ] SQL はプレースホルダで渡しているか
- [ ] 操作する前に、その人がその対象を操作してよいかサーバーで確かめているか
- [ ] パスワードやトークンをログ・レスポンスに出していないか（`SELECT *` に注意）
- [ ] 1回の操作で使える CPU・メモリ・DB に上限があるか
- [ ] 回数制限の「誰か」の判定（IP など）は偽装できないか
- [ ] エラーメッセージから内部情報が漏れていないか

## 練習問題

1. ログインの応答時間をそろえるように `app.ts` のログイン処理を書き換えてみましょう。ダミーのハッシュは起動時に1回だけ作れば十分です。
2. Socket.IO で `Origin` を確かめるには、`new Server(..., { allowRequest })` をどう書けばよいでしょうか。開発時（Vite のポート 5173）も動くようにする必要があります。
3. `toPublicUser` を使い忘れて `res.send(userRow)` と書くと何が漏れるでしょうか。このミスを起こりにくくする方法を2つ挙げてください。
4. `SameSite=Strict` にすると何が変わるでしょうか。ユーザーにとって不便になる場面を考えてください。

## 参考資料

- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/)（Password Storage, Session Management, Authentication, Cross-Site Request Forgery）
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [MDN: HTTP Cookie の使用](https://developer.mozilla.org/ja/docs/Web/HTTP/Cookies)
- [Node.js: crypto.scrypt](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)
- [Fastify: trustProxy](https://fastify.dev/docs/latest/Reference/Server/#trustproxy)
- [IPA「安全なウェブサイトの作り方」](https://www.ipa.go.jp/security/vuln/websecurity/about.html)
