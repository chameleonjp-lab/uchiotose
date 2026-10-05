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

ランキング、名前入力、外部への得点送信、Supabase等のDB接続を導入しない。設定は本作専用のlocalStorageキーのみを使う。

iPhone実機SafariとモバイルGPUの性能は、実機計測の証拠がない場合は未確認のまま記録する。ブラウザ模擬検査を実機合格へ読み替えない。
