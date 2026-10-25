# 設計

[使い方](usage.md) / [セットアップ](../XANGI_SETUP.md) / [README](../README.md)

## 構成と接続

ブラウザのnoVNC → xangiのHTTP/WebSocket中継 → Node.js拡張 → 127.0.0.1のVNCサーバー、の順に接続します。ブラウザから宛先は変更できません。OS側のVNCサービスは別管理です。

`src/extension.mjs`がready通知を返し、stdin終了・SIGINT・SIGTERMで接続とHTTPサーバーを終了します。POSIXランチャーは`scripts/xangi-extension`です。

- `/ui`：xangi配下の操作画面へHTMLで転送。ホストのCSP・base挿入に対応
- `/health`・`/api/status`：設定・接続・登録状態。秘密は返さない
- `/api/register`・`/api/forget`：ブラウザ登録・Cookie削除。同一OriginのPOSTのみ
- `/ws`：VNCとの双方向中継。同時接続1件、バイナリのみ、1MiB/メッセージ・8MiB/キュー

TCP接続待ちは5秒、自動認証完了までは10秒、ブラウザ側の接続待ちは90秒です。送信完了を待ってTCP読み取りを再開し、ping/pongで切断を検出します。

## 認証

全HTTP/WebSocketで拡張専用Bearerを検証し、WebSocketではxangiが書き換えた内部Originも検証します。Bearerはブラウザへ渡しません。これは中継元の認証で、個人の利用者IDではありません。

- **手入力**：noVNCとVNC間の認証を中継。認証情報はブラウザの接続中メモリだけに保持
- **自動認証**：所有者限定ファイルからパスワードを読み、標準VNC認証だけをサーバーで処理。パスワード・チャレンジ応答をブラウザへ渡さず、認証後はRFBをそのまま中継

自動認証にはHMAC署名付きの登録Cookieを要求します。既定30日、任意でサーバー期限なし。期限なしCookieはアクセス時に保存期間400日へ更新しますが、ブラウザによる削除は防げません。CookieはHttpOnly/SameSite=Strict、既定Secureで、xangiの名前空間分離を利用します。登録失敗は全体で毎分5回まで。コードの再発行と拡張再起動で全登録が失効します。操作手順は[セットアップ](../XANGI_SETUP.md#登録コードの確認)にまとめています。

「入力停止」はnoVNCの操作モードであり、サーバー側の閲覧専用権限ではありません。同じOSユーザーの別プロセスや、VNCへの直接接続はこの拡張の制御対象外です。

## UI

xangiの暗色と緑のアクセント、44px以上の操作要素、家アイコンのホームボタンにそろえます。接続直後は閲覧のみとし、操作開始を明示します。外部CDNは使用しません。

## 採用判断とライセンス

- noVNC 1.7.0: MPL-2.0を中心とするライセンス。npm配布物のcore・vendor・AUTHORS・LICENSE.txt・docsのライセンス全文を改変せず配信します。独自UIは別ファイルです。
- noVNC内のpako等: 上流同梱の著作権表示とライセンスをそのまま保持します。
- ws 8.22.0: MIT。build時にライセンスを同梱します。
- 独自コード: MIT。
- OS側のVNCサーバー: 同梱・コードコピーは行いません。別製品として導入・配布条件を判断します。

`scripts/build.mjs`はnoVNCの読みやすいソースをそのまま`dist/vendor/novnc/`へコピーし、UIからライセンスと当該版ソースを案内します。ビルド済み画面を配布する場合も`dist/`全体を含めます。将来noVNCを修正する場合は、その変更もMPLの条件に従って提供します。[Mozilla FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)参照。

## 参考にした構成

- [OpenClaw Host Desktop](https://github.com/openclaw/openclaw/blob/60546ded418ce14507c607570f0e463d28b737cb/docs/gateway/config-browser-ui-desktop.md#desktop): noVNC、loopback接続、OS別の画面共有。Labs機能である点も確認。
- [Hermes Bot Screen](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/bot-screen.md): Linux仮想デスクトップ、認証付き中継、操作権の扱い。
- [noVNC API](https://github.com/novnc/noVNC/blob/v1.7.0/docs/API.md): RFB、認証イベント、viewOnly、表示倍率。

構成・仕様を参考にしており、OpenClaw・Hermes・GPLのVNCサーバーの実装コードはコピーしていません。
