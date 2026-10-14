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

## 2026-10-14 GitHub Pages更新

公開先は **https://chameleonjp-lab.github.io/uchiotose/**。既存のChatGPT Sites版（https://uchiotose.chameleonjp.chatgpt.site）は削除せず、別ホストの補助公開として維持する。

今回の公開対象はmain `ada778d6e6a7a7ef34b609dacdaa4617ec5bf985`（tree `5db8b3800691fcb1699ecdecd1dc4a1ecd9e6b9e`）。浮遊島の城を含み、城の高さは2,400 m、島の最大幅は2,000 m。公開前に `npm ci`、`npm test`（217件成功）、`npm run test:ui:types`、`npm run build` が成功し、独立read-onlyレビューもPASS。main CI run `38335995882` も成功している。

旧 `gh-pages` は `df1827e37d962d14cb75ca8038d0c6bf36c9435b`（deployment.jsonのsource commit `0d00ef31a44786e23a0e93aae2bda6d78c15ccdf`）。旧版にはrelease.jsonがなく、旧版の `release.json` URL の取得は404だった。静的成果物をその履歴の子コミット `20bc340c37a0449c3b3641c81b60d70982b1bc9e` としてfast-forward更新し、履歴の強制上書きはしていない。`.nojekyll`、ライセンス表示、および既存のhashed JS assetを保持し、`release.json`を追加、`deployment.json`を更新した。Pages設定やCNAMEは変更していない。

GitHub Pages公開run [38519284449](https://github.com/chameleonjp-lab/uchiotose/actions/runs/38519284449) は成功。TLS検証を有効にした公開URLからのHTTP取得で、HTML、JS、CSS、release.json、deployment.json、third-party-notices.txtの6件がローカル成果物とバイト単位で一致した。公開release.commitは `ada778d6e6a7a7ef34b609dacdaa4617ec5bf985`、公開JSには `floating-island-castle` が含まれる。HTMLは `./assets/index-DnuEAYz2.js` を参照している。

主要公開ファイルのSHA-256:

| ファイル | SHA-256 |
| --- | --- |
| index.html | 47cac6e40f562bbb6ec2c8a8eca9430a455c8b332c75be0c27894dfa98dea7d0 |
| assets/index-DnuEAYz2.js | 70cf9d483e5cdb5443e7b218b65fbc74551fc19ee36d0633a89643a2e1134f3c |
| assets/index-CM_NdGef.css | da43ec868b2376e44fca82231ce10e744bf4435d158bdfc3698576a6aca177b7 |
| release.json | 48d0709cad1e08ba9b9cb51417207eb5d9198b94a3b09e70ef4fdad4cda0150b |
| deployment.json | 2e4fc73d60c33bd37e4444c9a5cba45d398f145a3dabd4b673903f7ff298e77b |
| third-party-notices.txt | 97de7ac302052bcea7f20e5ae89635c10e049614f56409288d554d63fceb614f |

この記録とREADMEの公開先案内は別の文書PRで提出する。mainへの直接変更やmergeは行っていない。実iPhoneのSafariでの再確認は未実施であり、公開ファイルの一致と実機合格を区別する。今後も指定された公開先を確認し、別ホストの更新をGitHub Pagesへの反映と同一視しない。
