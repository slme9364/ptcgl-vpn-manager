# Windowsの起動と接続確認

## 黒い画面

sandboxが有効なElectron preloadではES moduleのimportを実行できません。
preloadをCommonJS形式の `out/preload/index.cjs` としてビルドし、BrowserWindow側も同じファイルを参照します。
sandbox、contextIsolation、nodeIntegrationの保護設定は維持します。

ビルド後に `scripts/check-desktop-startup.cjs` が実際の成果物を読み、起動用IPCとイベント購読解除を確認します。

## 接続済みの意味

WireGuardサービスが起動しただけでは、サーバーと通信できているとは限りません。
接続後に設定されたサーバーPeerの新しいハンドシェイクを待ち、確認できなければ接続失敗とし、トンネルを解除して経路を戻します。

画面には最終ハンドシェイクと送受信量を表示します。VMの外部IPv4は、Chrome等の出口IPを測定した値ではありません。
サービスの地域判定は、このアプリの接続判定とは別です。

## リリース

desktopのバージョンを更新し、対応する `docs/releases/vX.Y.Z.md` を用意してから `vX.Y.Z` タグをpushします。
GitHub ActionsでWindows/macOS両方のテスト・型チェック・ビルドを実行し、成功した配布物をReleaseへ公開します。
署名・公証用の秘密情報はリポジトリや配布物に含めません。
