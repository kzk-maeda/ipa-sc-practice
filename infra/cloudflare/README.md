# Cloudflareの構成管理

| リソース | 管理方法 |
| --- | --- |
| D1、Cloudflare Accessのアプリケーションと許可メールのポリシー | Terraform |
| 教材用R2バケットと `r2.dev` の無効化 | Terraform。必要な環境で `enable_r2 = true` |
| Worker、カスタムドメイン、D1・R2のバインディング、静的アセット | Wrangler。共通設定とTerraformの出力から環境別の設定を生成 |
| D1のテーブル | `migrations/` とWranglerのD1マイグレーション |

`staging` と `production` はTerraformワークスペース、Worker、D1をそれぞれ分けます。各環境に別の専用ホスト名を割り当ててください。Workerの `workers.dev` とプレビューURLは無効にします。Accessでホスト全体を保護し、Workerもルートやアセットを処理する前に署名、発行元、対象アプリ、期限を検証します。認証済みユーザーの履歴は発行元とユーザー識別子から分離されます。

R2を有効にした場合、Workerに `CORPUS` が渡ります。現時点の図表はWranglerの静的アセットで配信します。

## Terraformで構成を作る

Terraform 1.11以上、Node.js 22以上、Cloudflare管理下のDNSゾーンと、利用する認証方式が設定済みのCloudflare Zero Trustチームが必要です。R2を作成する場合は対象アカウントでR2を有効にします。

CloudflareのAPIトークンは `CLOUDFLARE_API_TOKEN` に設定します。Terraformには対象アカウントのD1とAccessの Apps and Policies の編集権限、R2を作る場合は Workers R2 Storage の編集権限を付与します。Wranglerには対象アカウントの Workers Scripts・D1 の編集権限と、対象ゾーンの読み取り権限が必要です。

以下はリポジトリ直下から検証環境を作る例です。

```sh
npm ci
terraform -chdir=infra/cloudflare init
cp infra/cloudflare/environment.tfvars.example infra/cloudflare/staging.tfvars
```

`staging.tfvars` を編集し、アカウントID、専用ホスト名、Zero Trustのチーム名、許可するメールアドレスを指定します。

```sh
terraform -chdir=infra/cloudflare workspace select -or-create staging
terraform -chdir=infra/cloudflare plan -var-file=staging.tfvars -out=staging.tfplan
terraform -chdir=infra/cloudflare apply staging.tfplan
```

Terraformの状態はデフォルトでローカルの `infra/cloudflare/terraform.tfstate.d/` に保存されます。状態にはAccessで許可したメールアドレスが含まれます。状態ファイル、変数ファイル、保存済みplan、生成したWrangler設定はGitの管理対象外です。環境ごとに状態をバックアップし、共同運用する場合は組織のロック付きリモートバックエンドを設定してから状態を移行してください。D1とR2にはTerraformでの削除や置換を防ぐ `prevent_destroy` を設定しています。

既存のD1を取り込む場合は、対象ワークスペースを選択した上で `terraform -chdir=infra/cloudflare import -var-file=staging.tfvars cloudflare_d1_database.study '<account_id>/<database_id>'` を実行し、planで意図した差分か確認します。

## Workerを配備する

Terraformの適用後、次の順序で設定生成、DBのマイグレーション、配備を行います。

```sh
npm run cloudflare:config -- staging &&
npx wrangler d1 migrations apply DB --remote --config wrangler.staging.generated.json &&
npx wrangler deploy --config wrangler.staging.generated.json
```

設定生成は指定されたTerraformワークスペースの出力を読みます。本番用は `production` ワークスペースと `production.tfvars` を使い、生成コマンドの引数とWrangler設定のファイル名も `production` に変更します。配備後、専用ホストで許可済みアカウントの演習と未認証時のブロックを確認します。

## OpenAI連携を有効にする

対象環境の `*.tfvars` に、例の `ai` ブロックを設定します。料金設定には選んだモデルの通常入力・出力単価（100万トークンあたりの USD）を入れてください。Terraformを適用し、Wrangler設定を再生成してD1のマイグレーションを適用したあと、同じ環境のWorkerにAPIキーを登録して配備します。

```sh
npx wrangler secret put OPENAI_API_KEY --config wrangler.staging.generated.json
npx wrangler deploy --config wrangler.staging.generated.json
```

キーは `*.tfvars` やGitに入れず、環境ごとのWorkerシークレットを使います。配備済みWorkerで会話の30日削除を毎日3時（日本時間）に実行します。利用枠はD1に記録し、先に月額の概算を予約します。APIがトークン実績を返した場合は実績で精算し、取得できない場合は予約額を記録します。

## リソースを作らずに検証する

```sh
terraform -chdir=infra/cloudflare fmt -check -recursive
terraform -chdir=infra/cloudflare init -backend=false
terraform -chdir=infra/cloudflare validate
TF_WORKSPACE=staging terraform -chdir=infra/cloudflare test
TF_WORKSPACE=production terraform -chdir=infra/cloudflare test
npm run check
npm test
```

TerraformテストではCloudflareプロバイダーをモックします。アプリのローカル開発は従来の `npm run setup` と `npm run dev` で行えます。
