# 支援士 過去問演習

情報処理安全確保支援士の対策用アプリです。IPA公式の午前Ⅰ（A-1）33回・990問と、支援士の午前Ⅱ（A-2）17回・425問を演習できます。

| 科目 | 本文・解説つき | 公式冊子で演習 |
| --- | --- | --- |
| 午前Ⅰ（A-1） | 2025年春期・秋期の60問 | 2009〜2024年の31回・930問 |
| 午前Ⅱ（A-2） | 2025年秋期の25問 | 2017〜2025年の他16回・400問 |

「公式冊子で演習」では、IPAの公式PDFの該当ページを別タブで開き、アプリでア〜エを選ぶと採点されます。PDFの閲覧にはインターネット接続が必要です。

どちらの形式も回答履歴、途中再開、要復習マークに対応します。「学習記録」で科目ごとに成績を確認できます。カテゴリ別の弱点集計とAI解説のローカルスタブは、本文・解説つきの問題で利用できます。

## ローカルで起動

Node.js 22 以上と npm が必要です。

```sh
npm ci
npm run setup
npm run dev
```

ブラウザで [http://127.0.0.1:8787](http://127.0.0.1:8787) を開きます。画面上部の「年度・期」で科目と年度を選び、演習を始めます。回ごとの「続きから」で最初の未回答問題に戻れます。

TypeScript と Hono で HTML をサーバー側で描画し、回答は Wrangler のローカル D1（`.wrangler/state/`）に保存します。ローカルでは開発用の固定利用者を使います。Cloudflare アカウントや API キーは不要です。

## Cloudflareの構成管理

検証・本番それぞれのD1、R2、AccessをTerraformで管理し、その出力からWorkerのWrangler設定を生成します。[Cloudflare構成管理の手順](infra/cloudflare/README.md)

## 検証

```sh
npm run check
npm test
npx playwright install webkit
npm run test:e2e
```

Playwright はテスト専用の D1 を作成します。iPhone 13 相当の WebKit で JavaScript を無効にし、午前Ⅰの2025年春期の全30問、午前Ⅱの2025年秋期の全25問、公式冊子での採点と再開、科目別の学習記録、D1 の再送と競合を確認します。Linux で WebKit のシステム依存が不足する場合は `npx playwright install --with-deps webkit` で用意できます。

## 教材の出典と確認

- 年度・期はIPAの掲載見出しに基づきます。各回の問題冊子と解答のURL、SHA-256、問ごとのPDFページを `src/corpus/a1-sources.json` と `src/corpus/a2-sources.json` に記録しています。午前Ⅰの2022年春期の正答は画像の解答表から照合し、元PDFのSHA-256に固定しています。[IPAの過去問題一覧](https://www.ipa.go.jp/shiken/mondai-kaiotu/)
- 2025年の午前Ⅰ春期・秋期と午前Ⅱ秋期は、本文を原題と照合して記号・改行などを画面向けに整え、図表11点を切り出して内容をテキストでも記載しています。解説とカテゴリ分類はアプリ用に作成しました。[IPAの2025年度掲載資料](https://www.ipa.go.jp/shiken/mondai-kaiotu/2025r07.html) ・ [過去問題の利用条件](https://www.ipa.go.jp/shiken/faq.html)
- 公式資料の再取得と照合には Python 3 と Poppler の `pdftotext` が必要です。リポジトリ直下で `python scripts/corpus/catalog.py --subject a1 --refresh` または `python scripts/corpus/catalog.py --subject a2 --refresh` を実行します。照合結果と保存済みマニフェストに差分がある場合は終了コードで知らせます。図表の再生成は PyMuPDF と Pillow を用意して `python scripts/corpus/rebuild.py` を実行します。

午後（B）と模試は後続段階です。
