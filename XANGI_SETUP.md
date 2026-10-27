# セットアップ

## 前提と準備

Node.js 22以上、managed HTTP/WebSocket拡張に対応したxangi、同じPCの127.0.0.1で接続できるVNCサーバーが必要です。拡張の起動にはLinux／macOSのPOSIXシェルを使います。[OS別の対応状況](docs/usage.md#対応状況)も確認してください。

リポジトリのディレクトリで実行します。

```sh
npm ci
npm run build
# 初回のみ。既存の.envは上書きしないでください。
cp .env.example .env
```

VNCサーバーは別途準備し、認証を設定して外部へ直接公開しない構成にします。Linux X11の既存画面にはx11vnc等、macOSには標準の画面共有が候補です。VNCのインストールやOS設定変更は自動では行いません。RDPには接続できません。

MacからLinux X11を操作する場合、[Shift・英数キーとGTK4の日本語入力](docs/usage.md#macからlinux-x11へのキー入力)も参照してください。特定環境で確認した対処と未解決の制限をまとめています。

## 設定

`.env`で設定します。変更後は拡張の停止・起動が必要です。親プロセスの同名環境変数があれば、その値が優先されます。

| 設定 | 既定値 | 内容 |
| --- | --- | --- |
| `REMOTE_DESKTOP_VNC_PORT` | 空 | VNCのポート（1〜65535）。空なら接続無効 |
| `REMOTE_DESKTOP_VNC_PASSWORD_FILE` | 空 | 自動認証用パスワードファイルの絶対パス。空なら接続時に手入力 |
| `REMOTE_DESKTOP_BROWSER_KEY_FILE` | 空 | 自動認証で使う登録コードファイルの絶対パス。未作成なら生成 |
| `REMOTE_DESKTOP_COOKIE_SECURE` | `true` | HTTPS用Cookie。保護されたHTTP試用のみ`false`を指定可能 |

自動認証を使う場合、パスワードファイルにはVNCパスワードだけを保存します（1〜8文字の印字可能ASCII、末尾改行可）。POSIXでは実行ユーザーの所有、所有者だけが読み書きできる権限（0600）が必要です。秘密ファイルはGit管理対象やWeb配信ディレクトリに置かないでください。

HTTPSを既定とします。`REMOTE_DESKTOP_COOKIE_SECURE=false`はTailscale等で通信が暗号化され、アクセスも制限済みのHTTP環境に限ります。一般のLAN HTTPや公開HTTPには使いません。`XANGI_EXTENSION_AUTH_TOKEN`はxangiが供給するため、利用者は設定しません。

## 登録コードの確認

自動認証の設定後、本人の端末で実行します。

```sh
npm run setup                      # 設定確認・コード生成と表示。既存コードは維持
npm run registration -- show       # 再表示
```

表示されたコードを画面の「このブラウザを登録」に入力します。管理者が導入した場合は、許可した利用者に個別に渡してください。VNCパスワードは表示しませんが、コマンド出力の登録コードも秘密です。共有ログ・公開チャット・URLには残さないでください。

登録は既定で30日。「この端末を期限なしで登録」も選べます。期限なしでもブラウザによるCookie削除・保存期限切れでは再登録が必要です。期限を変更する場合は、画面で登録を解除して同じコードで登録し直します。

全ブラウザの登録を無効にする場合は、拡張を停止して`npm run registration -- rotate`を実行し、拡張を起動します。**停止・起動するまでは古いコードが有効です。** 画面の「登録を解除」は、そのブラウザのCookieだけを削除します。

`setup`は設定検証のみで、VNCへの実接続、OS設定変更、xangiへの登録・再起動は行いません。

## xangiへ登録

`XANGI_BIN`をインストール済みxangiの絶対パスに設定します。

```sh
XANGI_BIN="/absolute/path/to/xangi"
"$XANGI_BIN" extension --help
"$XANGI_BIN" extension link "$PWD/xangi-extension.json"
"$XANGI_BIN" extension start xangi-remote-desktop
"$XANGI_BIN" extension doctor xangi-remote-desktop
```

拡張一覧から「xangi-remote-desktop」を開き、「接続する」で確認します。自動認証では先にブラウザ登録が必要です。`doctor`の成功だけではVNC認証・画面取得の成功を意味しません。

## 更新・停止・削除

```sh
"$XANGI_BIN" extension stop xangi-remote-desktop
# 確認したソースへ更新。.envと秘密ファイルは維持します。
npm ci
npm run build
"$XANGI_BIN" extension start xangi-remote-desktop
```

削除時は停止後に`"$XANGI_BIN" extension unlink xangi-remote-desktop`を実行します。VNCサーバーは別管理のため、不要になったらOS側で停止してください。拡張の更新・設定変更にxangi本体の再起動は不要です。
