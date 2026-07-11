# Palworld Community Pages

`https://community.xero-x.me` で公開する、GitHub Pages用の静的フロントエンドです。サーバー情報は `https://pal-api.xero-x.me` の公開用・読み取り専用APIから取得します。

公開対象は `index.html`、`site.css`、`app.js`、`motion.js`、`assets/` です。PalServer設定、REST API認証情報、Cloudflare資格情報、ワールドデータは含みません。ゲーム画像の出典と利用方針は `assets/SOURCES.md` に記録しています。

PC版の直接接続先は `218.183.35.208:8211` です。Xbox / PS5版はゲーム内のコミュニティサーバー一覧で「Xero PALServer」を検索します。GitHub PagesはWeb画面、`pal-api.xero-x.me` は安全な公開API、`218.183.35.208:8211` はパルワールドのゲーム接続という役割分担です。

GitHub PagesやDNS自体はパルワールドのUDPゲーム通信を中継しません。直接接続では、公開IPアドレスとポート番号を使ってサーバーへ接続します。

ページは外部ライブラリに依存せず、読み取り専用APIのオンライン・オフライン・取得失敗を分けて表示します。モーションは `prefers-reduced-motion`、Save-Data、端末性能、タブの表示状態を考慮して自動的に軽量化します。

本サイトは非営利の非公式ファン運営コミュニティサイトであり、Pocketpair, Inc. の公式サイトではありません。
