# セキュリティ

- Rendererは`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`。
- IPC入力はZodで型・形式・範囲を検証し、任意の実行ファイル名や追加コマンド引数を受け取りません。
- GCPはApplication Default Credentialsを使用し、サービスアカウントJSON鍵を保存しません。
- VMサービスアカウントにプロジェクト全体のIAMロールを与えず、特定のSecretに対する`secretAccessor`だけを付与します。VMのOAuth scopeはCloud API呼び出しを可能にしますが、実際の権限はこのIAMに制限されます。
- WireGuardサーバー秘密鍵はSecret Managerに保存し、VM上ではモード0600で展開します。Secretには削除保護とTerraformの`prevent_destroy`を設定します。クライアント秘密鍵は端末ごとに生成します。
- FirewallはUDP 51820のみ。SSHの公開Firewall ruleは作らず、OS Loginとproject SSH key遮断を有効化します。
- IPv4 forwardingはwg0から外部IFへの確立済み通信だけ許可し、IPv6はサーバーで無効化します。
- Debian unattended-upgradesを導入します。長期間停止したVMは起動時startup scriptで更新されます。

設定ファイルのPrivateKeyはアプリログへ出しません。`electron-store`の暗号化は難読化であり資格情報保管庫ではないため、秘密鍵自体は保存せずパスだけを保持します。
