# macOSセットアップ

`brew install wireguard-tools`等で`wg-quick`を導入します。アプリからのup/downには管理者権限が必要です。MVPは全IPv4通信をトンネルへ通す構成で、IPv6はクライアント側でも無効化または漏れがないことを確認してください。

標準WireGuardには安全で安定したアプリ単位ルーティングAPIがないため、PTCGL限定モードは実装していません。SIPの無効化、未署名カーネル拡張、パケットフィルタの恒久的な書き換えは行いません。

配布版にはApple Developer ID署名と公証が必要です。実機での権限ダイアログと`wg-quick`探索は未検証です。
