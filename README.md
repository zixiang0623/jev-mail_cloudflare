# jev-mail_cloudflare

Cloudflare Workers + 静的アセット + Workers AI binding によるメール仕分けアプリのフロントエンド/分類API。
[jev-mail_vercel](https://github.com/zixiang0623/jev-mail_vercel) が返すメール一覧を、Jev(`env.AI.run("typesafe/jev", ...)`)で通知・支払い・重要・その他に分類する。

## 構成

- `public/index.html` — フロントエンド(単一HTMLファイル)。「メールを取得」を押すとVercel APIを叩き、10件ずつ `/api/classify` に投げて仕分け結果を表示する
- `src/index.js` — Worker本体。`/api/classify` へのPOSTをJevで処理し、それ以外は静的アセットを返す
- `wrangler.toml` — `[ai]` binding と `[assets]` (public/ を配信)を設定済み

## デプロイ

```bash
npx wrangler deploy
```

Workers AI binding を使うため、環境変数やAPIキーの設定は不要(Cloudflareアカウントの認証のみで完結)。

## 使い方

1. デプロイ後に表示されるWorkerのURL(例: `https://jev-mail-cloudflare.xxx.workers.dev`)を開く
2. 画面上部の入力欄に、Vercel側の `/api/fetch-mail` のフルURLを入力(ブラウザのlocalStorageに保存される)
3. 「メールを取得」を押すと、IMAP取得→10件ずつバッチでJev分類→カテゴリ別表示、まで自動で進む

## 分類ロジックについて

Jevは「1つのstateに対して複数questionsを並列評価する」仕組みなので、10件をまとめて1リクエストで処理するために、バッチ内のメールを配列にした1つのstateと、メールごとに1問(`cat_0`, `cat_1`, ...)のquestionsを組み立てている(`src/index.js` の `buildQuestions` / `classifyBatch`)。1バッチ = Jev API 1コールになる。

## 未対応・今後の課題

- CORS: `public/index.html` から `/api/classify` は同一オリジンなので問題ないが、Vercel側のURLは別オリジン。Vercel側の `ALLOWED_ORIGIN` にこのWorkerのURLを設定しておくこと
- 認証: 現状は誰でもこのWorkerにアクセスすればメールが見える状態。個人利用前提だが、公開する場合はCloudflare Access等でのアクセス制限を検討
