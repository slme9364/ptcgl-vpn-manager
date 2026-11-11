# トラブルシューティング

- `Could not load the default credentials`: `gcloud auth application-default login`を実行し、同じOSユーザーでアプリを起動します。
- VMが起動しない: Compute Engine API、IAM、ゾーン、quota、Billingを確認します。
- 外部IPがない: VMがRUNNINGになるまで待ち、状態更新します。IPは停止・起動ごとに変わり得ます。
- VPN接続失敗: UDP 51820、クライアント公開鍵、Peerアドレス、OS管理者権限、時刻を確認します。
- 接続後に通信不能: `AllowedIPs = 0.0.0.0/0`、DNS、サーバーの`wg show`、`nft list ruleset`を確認します。
- macOSで`wg-quick`が見つからない: GUIアプリのPATHにはHomebrewが入らない場合があります。現MVPの未解決事項です。
- VM停止に失敗: コンソールまたは `gcloud compute instances stop VM --zone ZONE`で停止します。最大時間タイマーもありますが、API状態を必ず確認してください。

秘密鍵、ADCトークン、完全なWireGuard設定をissueやログへ貼らないでください。
