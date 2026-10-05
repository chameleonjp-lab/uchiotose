# 公開手順

ユーザーの「ページ公開まで作業実施（ランキング連携は対応しない）」に基づき、完成候補を検査し、PRをmainへ統合後、GitHub Pagesへ静的成果物を公開する。文書工程時の未承認という記録は、その工程当時の範囲である。

1. `npm ci --cache /tmp/uchiotose-npm-cache`、`npm test`、`npm run build` を実行する。
2. `PLAYWRIGHT_BROWSERS_PATH=/tmp/uchiotose-browsers npm run test:browser -- --project=chromium` で製品画面を検査する。
3. 公開前の独立レビューを完了し、候補SHAと未確認事項を進捗記録とPRへ残す。
4. mainに統合したSHAをビルドし、`node scripts/prepare-pages.mjs /tmp/uchiotose-pages-<unique>` で空の新規ディレクトリへ成果物を作る。`.nojekyll`と`release.json`を含み、開発検査APIを含まないことを確認する。
5. 静的成果物のみを`gh-pages`ブランチへコミットし、通常pushする。既存ブランチの履歴を強制上書きしない。
6. GitHub Pagesの公開元を`gh-pages`、`/`へ設定する。必要な権限がない場合は公開未完了と明記し、設定の修復に必要な操作だけを利用者へ伝える。
7. Pagesのbuild/deploy成功を確認し、公開URLと`release.json`、JS/CSSのHTTP成功、および公開ページの実入力を検査する。

想定URL: `https://chameleonjp-lab.github.io/uchiotose/`。

## 2026-10-05の公開結果

公開URL: **https://uchiotose.chameleonjp.chatgpt.site**（Sites、一般公開）。[PR #6](https://github.com/chameleonjp-lab/uchiotose/pull/6)をmainへ統合した `aac2b36e651024bc3ccca851e2374f5dd373a3b1` のビルドを公開した。固定検証候補 `da017ad` と製品コード・HTML・依存関係は同じである。

GitHub Pagesの設定APIは `403 Resource not accessible by integration` だったため、同じ検証済み静的ファイルをSitesへ保存・公開した。`gh-pages` は `391ac84cb5fb68cae2aa1332b5b978e6a87cb1bb` に準備済み。GitHub Pagesも利用する場合は、管理者がSettings → Pagesで公開元を `gh-pages` / `/` に設定できる。

Sitesの保存・公開IDは[evidence/publication-hosting.json](evidence/publication-hosting.json)、認証なしのHTTP取得とHTML/JS/CSS等の同一性は[evidence/publication-http.json](evidence/publication-http.json)に記録した。TLS検証を有効にした取得はすべてHTTP 200だった。取得した同一ファイルのローカル操作検査は[evidence/publication.json](evidence/publication.json)で、開始・長押し射撃・一時停止・時計停止・ルール・再開を確認した。

公開URLへの直接Chromium操作は、検査環境のプロキシ証明書の信頼不足で未確認。永続NSS信頼設定の変更は、将来のブラウザ証明書検証への影響を理由に自動承認レビューで拒否された。設定を変更せず、TLS付き取得と同一ファイルの操作検査を代替とした。公開先の証明書不良を確認したという意味ではない。

今後のSites更新では `/workspace/sites/uchiotose/.openai/hosting.json` の既存project_idを再利用し、新しいmainの検証済み静的ファイルを同じSiteへ保存・公開する。今回のSites source commitは `c9fec3d157b82b2bb0f1c30371a85dccd63d5e83`、公開ファイル内release.jsonはゲームの元main commitを示す。SitesにゲームのDBやランキング接続は追加していない。

ランキング、名前入力、外部への得点送信、Supabase等のDB接続を導入しない。設定は本作専用のlocalStorageキーのみを使う。

iPhone実機SafariとモバイルGPUの性能は、実機計測の証拠がない場合は未確認のまま記録する。ブラウザ模擬検査を実機合格へ読み替えない。
