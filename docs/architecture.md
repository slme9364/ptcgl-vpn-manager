# アーキテクチャ

Electron main processだけがGCP SDK、ファイル、OSコマンドへアクセスします。sandbox化されたrendererには固定したIPCメソッドだけをpreload経由で公開し、設定入力をZodで検証します。任意コマンド文字列は受け取らず、子プロセスは`execFile`/`spawn`の引数配列で起動します。

日常操作はCompute Engine API、初期構築はTerraformに分離しています。サーバー秘密鍵はリージョン別VMから分離したSecret Managerに保持し、VMは起動時に最小権限サービスアカウントで取得します。秘密値はTerraform入力やstateへ入りません。各クライアントも個別鍵を持ち、Terraformには公開鍵だけを渡します。

`infrastructure/bootstrap`はプロジェクトにつき一度だけ適用し、SecretとVMサービスアカウントを保持します。`infrastructure/terraform`はリージョンごとに再作成可能です。この分離により、VMやリージョンを変更してもサーバー公開鍵とクライアント設定は変わりません。

bootstrapはバージョニング・公開防止・削除防止を有効にしたGCS bucketも作成します。リージョンごとのTerraform stateは`ptcgl-vpn/<deployment-id>`へ分離して保存され、MacとWindowsから同じstateを参照します。GUIは既存stateの公開Peer一覧を読み、新端末の公開鍵をマージします。秘密鍵はTerraform変数・plan・stateへ入りません。

リージョン切替では短いdeployment IDをリソース名へ付け、新旧環境を並行保持できます。新環境のVPN疎通を確認してから、明示的な確認付きで旧環境をdestroyします。Secret Managerとstate bucketはリージョン環境のdestroy対象外です。

## 接続方式

- Windows公式WireGuard: 安定した全通信トンネル。サービス操作に管理者権限が必要です。
- Windows WireSock: PTCGLプロセスだけを対象にできる任意モード。個人・教育・非営利は無料、商用利用はPROライセンスが必要です。
- macOS: 公式WireGuard互換の`wg-quick`全通信モード。Network Extensionを自作せず、SIP等の保護機構を変更しません。

macOSのアプリ単位経路分離と、PTCGLの接続先IPを列挙する方式は、宛先変更・CDN・DNS挙動により安全性を保証できないためMVP対象外です。

## 終了と安全装置

PTCGL終了後にVPNを切断しますが、他端末利用を権威的に判定する常駐管理面がないためVMを自動停止しません。ユーザー確認後の停止が必要です。停止忘れに備え、VM起動ごとにsystemd timerが最大稼働時間でOSを停止します。処理はCompute APIの現在状態を確認し、停止済みなら何もしません。
