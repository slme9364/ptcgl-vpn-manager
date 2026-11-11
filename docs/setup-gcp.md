# GCPセットアップ

この操作は課金対象リソースを作成します。`terraform apply`のplanを確認してから明示的に実行してください。

```bash
gcloud auth login
gcloud auth application-default login
gcloud config set project YOUR_PROJECT_ID
cd infrastructure/bootstrap
cp example.tfvars local.tfvars
terraform init
terraform apply -var-file=local.tfvars
../../scripts/ensure-server-key.sh YOUR_PROJECT_ID

cd infrastructure/terraform
cp example.tfvars local.tfvars
terraform init
terraform plan -var-file=local.tfvars
terraform apply -var-file=local.tfvars
```

bootstrapが作る`PROJECT_ID-tfstate` bucketはMac/Windows共通のTerraform state保存先です。既存のローカルstateがある場合は、bucket作成後に`terraform init -migrate-state`で一度だけ移行します。bucketとSecretには削除防止があるため、リージョン環境の通常のdestroyでは削除されません。

bootstrapはプロジェクトごとに一度だけ適用します。サーバー秘密鍵は`ensure-server-key.sh`がSecret Managerに初回だけ登録し、既存の有効な鍵があれば変更しません。リージョン環境をdestroyしてもbootstrap側は残してください。

クライアント鍵は端末ごとに生成します。`scripts/generate-client-config.sh SERVER_PUBLIC_KEY 10.66.0.2/32 client.conf`を使い、表示された公開鍵を`client_peers`へ追加して再度applyします。秘密鍵・`.conf`・stateをGitへ追加しないでください。

アプリ用の推奨カスタムロール権限は `compute.instances.get`, `compute.instances.start`, `compute.instances.stop`, `compute.zoneOperations.get` です。ユーザーへ対象プロジェクトまたは可能なら対象リソース条件付きで付与します。サービスアカウントJSON鍵は作成しません。

予算アラートはBilling画面で別途設定してください。通知であり、課金を自動停止するものではありません。リージョン変更はtfvarsを別ディレクトリ/stateで管理して新規デプロイし、疎通確認後に旧環境をdestroyします。

料金はVM、稼働中の外部IPv4、常時残る10GBディスク、インターネット下り（GCPから見たegress）で構成されます。単価と無料枠は変更されるため、デプロイ時に[GCP Pricing Calculator](https://cloud.google.com/products/calculator)と請求先通貨で確認してください。
