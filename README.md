# PTCGL VPN Manager

GCPのWireGuard VMを必要な時間だけ起動し、PTCGLの起動とVPN接続をまとめて扱うWindows/macOS向けElectronアプリです。固定IPv4、Cloud NAT、ロードバランサー、常駐管理サーバーは使いません。

> このプロジェクトは地域制限の回避を保証・支援するものではありません。PTCGLおよび各サービスの利用規約・地域要件に従ってください。アクセスが拒否された場合に回避を試みる機能はありません。

## 現在の実装範囲

- Terraform: 専用VPC、e2-micro VM、エフェメラルIPv4、UDP 51820のみの受信、WireGuard、NAT、IPv6無効化、最大稼働時間タイマー
- Electron: ADC認証によるVM状態取得・起動・停止、動的Endpoint更新、VPN接続・切断、PTCGL起動・終了監視、安全なIPC
- Update: GitHub Releaseの起動時確認、手動確認、ダウンロード、再起動適用
- GUI IaC: 対応リージョンの選択、Terraform planログ確認、apply、リージョン環境削除
- 共有state: バージョニング付きGCS backendでMac/Windows間のPeerをマージ
- Windows: 公式WireGuardサービス、任意でWireSockによるPTCGL単位モード、x64パッケージ生成確認済み
- macOS: `wg-quick`による全通信モード。アプリ単位モードは未対応
- 単体テスト: 料金計算、WireGuard Endpoint更新・入力拒否

GCP（Singapore）への実デプロイ、macOSからのWireGuard接続、VPN経由のIPv4出口、IPv6遮断、VM停止時の一時IPv4解放を確認済みです。Windows版はビルド確認済みですが、Windows実機での接続、コード署名、PTCGLを含む最終疎通は未検証です。

## リリース上の注意

[最新版のダウンロード（GitHub Releases）](https://github.com/slme9364/ptcgl-vpn-manager/releases/latest)

`v0.1.8`ではWindowsの黒い画面、WireGuardサービスの設定ファイル読み込み、接続済みの誤表示を修正しています。詳細は[リリースノート](docs/releases/v0.1.8.md)を参照してください。

配布バイナリはコード署名・macOS公証を行っていないため、OSの警告が表示される場合があります。利用前に各OS向けセットアップ手順と[セキュリティ設計](docs/security.md)を確認してください。

## 必要条件

- Node.js 22以降、pnpm 10以降
- Terraform 1.6以降、gcloud CLI
- GCPプロジェクト（Compute Engine APIと課金が有効）
- Windows: WireGuard公式クライアント、または個人利用条件を満たすWireSock
- macOS: Homebrew等で導入した `wireguard-tools`

## 開発

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm dev
```

パッケージ作成は `pnpm --filter @ptcgl/desktop package`。署名・公証は別途必要です。Windowsでは通常のNSISインストーラーに加え、インストーラーの整合性エラー時に利用できるZIP版もReleaseへ添付します。

## 初期セットアップ

1. [GCPセットアップ](docs/setup-gcp.md)で基盤を作成します。
2. 端末ごとに独自のWireGuard鍵を生成し、公開鍵だけをTerraformへ渡します。
3. [Windows](docs/setup-windows.md)または[macOS](docs/setup-macos.md)の手順でクライアントを準備します。
4. `gcloud auth application-default login` を実行し、アプリの設定画面へProject ID、VM、リージョン、ゾーン、設定ファイルを入力します。

詳細は[アーキテクチャ](docs/architecture.md)、[セキュリティ](docs/security.md)、[トラブルシューティング](docs/troubleshooting.md)を参照してください。
