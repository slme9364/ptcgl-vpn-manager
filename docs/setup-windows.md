# Windowsセットアップ

## 壊れたインストールのクリーンアップ

インストーラーやアンインストーラーが完了しない場合は、管理者PowerShellで次を実行します。PTCGL、WireGuard、GCP認証情報は削除しません。

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\cleanup-windows.ps1
```

削除対象を事前確認する場合は `-WhatIf`、VPN Managerの保存設定も削除する場合は `-RemoveSettings` を付けます。

## 必要なソフトウェア

- Google Cloud CLI（`gcloud auth application-default login`を一度実行）
- Terraform 1.6以降（GUIからのリージョン管理を使う場合）
- WireGuard公式Windowsクライアント
- アプリ単位分離を使う場合だけWireSock Secure Connect

Windows端末ではMacと同じ鍵をコピーせず、PowerShellで端末専用設定を作ります。

```powershell
.\scripts\generate-client-config.ps1 `
  -ServerPublicKey "SERVER_PUBLIC_KEY" `
  -ClientAddress "10.66.0.3/32" `
  -OutputFile "$env:USERPROFILE\ptcgl-windows.conf"
```

表示された公開鍵はアプリ設定へ自動導出できます。共有GCS Terraform stateから既存Peerを読み取り、重複しないトンネルIPへ調整してからplanします。

## 公式WireGuard（推奨・全通信）

WireGuard公式クライアントをインストールし、アプリを管理者権限で実行します。アプリは設定ファイルを更新して `wireguard.exe /installtunnelservice` を使います。設定ファイルは現在ユーザーとAdministratorsだけが読めるACLにしてください。

## WireSock（任意・PTCGLのみ）

WireSock Secure Connectを別途インストールし、設定でVPNクライアントをWireSockにします。PTCGL本体だけでなくランチャーや補助プロセスが通信する場合は、それらもWireSock側のAllowedAppsへ追加する必要があります。DNSはWindowsでシステム全体のため、完全なアプリ単位分離にはならない点に注意してください。

WireSockは個人・教育・非営利利用が無料で、商用利用はPROライセンスが必要です。アプリへ同梱・再配布はしません。

公式WireGuardのトンネルサービス操作には管理者権限が必要なため、Windows版PTCGL VPN Managerは管理者として起動するmanifestでビルドされます。RendererのsandboxとIPC検証は引き続き有効です。

初回はVPN接続後にPTCGLをインストールし、設定画面の「PTCGLを自動検出」または実行ファイルパス指定を行います。接続後にPTCGLの疎通を確認し、WireSock利用時はブラウザ、Discord、他ゲームの送信元IPが変わらないことを別途確認してください。Windows実機検証は未実施です。
