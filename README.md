# Palworld Community Pages

`https://community.xero-x.me` で公開する、GitHub Pages用の静的フロントエンドです。サーバー情報は `https://pal-api.xero-x.me` の公開用・読み取り専用APIから取得します。

公開対象は `index.html`、`site.css`、`app.js` のみです。PalServer設定、REST API認証情報、Cloudflare資格情報、ワールドデータは含みません。

ゲームへの接続先は `pal.xero-x.me:8211` です。GitHub PagesはWeb画面、`pal-api.xero-x.me` は安全な公開API、`pal.xero-x.me:8211` はPalworldゲーム接続という役割分担です。

GitHub PagesやDNS自体はPalworldのUDPゲーム通信を中継しません。ゲーム接続は `pal.xero-x.me` のDNSが指定するサーバーへ直接行われます。
