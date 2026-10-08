> UI-only update: the default browser command now uses [short screen checks](UI_ONLY_CHECKS.md). The original acceptance documentation below is preserved as the opt-in legacy suite; it does not describe the default UI-only command. Ordinary unit/type/build checks remain in place; only the three exact long P8 simulation integrations are explicitly opt-in.

# ブラウザ受入検査

## 必須条件

- `npm test` と `npm run build` が成功する
- `npm run test:browser:discovery` が WebKit (`webkit-ui`) と Chromium (`chromium`) の両方で実行可能な検査を1件以上検出する
- `npm run test:browser` で両プロジェクトの全検査が成功する。検出だけではブラウザ動作の合格としない
- 未実行、失敗、skipのみ、期待失敗のみのプロジェクトを合格としない。`--pass-with-no-tests` で空のプロジェクトを隠さない

`pretest:browser` は必ず両プロジェクトの検出を先に検査する。Chromiumの検査件数が多くても、WebKitが0件なら失敗する。CLIを直接実行する場合はこのnpmフックを通らないため、単発の調査結果を全体合格に読み替えない。

`.github/workflows/browser-acceptance.yml` はPRのhead SHA（main pushでは当該SHA）を検査し、既存の単体検査・build・Chromium検査を保ったまま上記条件を実行する。公開・デプロイ・ランキング送信は含めない。

CIではブラウザと必要なシステムパッケージを準備済みの公式環境 `mcr.microsoft.com/playwright:v1.61.1-noble` を使う。毎回の `apt` ダウンロードが遅くなり、ブラウザ検査の開始前に20分の制限へ達する問題を避ける。プロジェクトのパッケージは引き続き `npm ci` で取得する。Playwrightを更新する場合は `package.json`・`package-lock.json` とこの環境のバージョンを一致させる。全検査の実行、失敗の扱い、20分の制限は維持する。[公式の実行環境の説明](https://playwright.dev/docs/docker)

## WebKitの対象

`browser-tests/mobile-settings-ui.spec.ts` は製品の `ControlSettings`、`KeyboardSettings` とCSSをローカルfixtureで読み込む。設定機能をダミーに置き換えず、WebGL・ミッション開始から独立して検査する。

- Normalのタッチ3操作（射撃・宙返り・速度レバー）、Easyの宙返り1操作、PCの9操作
- タッチ配置とキーの保存、再読込、他ゲームの保存キーの保護
- 保存失敗後に明示的に「今回だけ使う」を選ぶまで反映しないこと、再読込での初期値復帰
- 破棄・閉じる・Esc、再度開く操作、フォーカス復帰とTab境界
- 320×568、393×852、568×320の両設定エディターと閉じる/保存ボタンへの到達

同じ7検査をChromiumでも実行し、既存のゲーム全体の検査は削除・置換しない。7件目では速度レバーのキー操作とポインターの捕捉を検査する。WebKit設定fixtureの合格は、ゲーム全体のWebKit描画・iPhone実機Safari・GPU性能の合格を意味しない。

速度レバーの独立fixtureには製品の `main.step` がないため、初期画面の描画とフォーカス移動を待ち、キーとポインターがすべて離れたことを確認してから、製品と同じ `acknowledgeRelease()` で入力開始を受け付ける。この準備は操作検査の開始前に1回だけ行う。短押しの保持、1tickだけの消費、フォーカス離脱による取消、ポインターの捕捉の検査中には入力停止を解除しない。製品の初期化・中断後の入力解除は引き続き実際の `main.step` を通るゲーム全体の検査で確認する。

## 外部通信の遮断

すべての `.spec.ts` は `local-only.ts` の共通fixtureを使用する。ページを作る前にcontextへHTTPとWebSocketの遮断を設定し、service workerを無効化する。

HTTPは現在のcheckoutに存在する製品ファイルと、使用するThree.jsの実ファイルimport graph、Viteのclient/envの完全なパスだけを許可する。GET/HEADかつ用途がdocument/script/stylesheetに一致する場合だけ取得し、全query・未知のファイル・同一originのAPI・fetch/XHR・書込を拒否する。faviconだけは既知の空レスポンスをローカルで返す。取得時にredirectを追わず、3xxも遮断して検査を失敗させる。

受入検査専用 `vite.browser-tests.config.ts` で依存モジュールのprebundleを無効にし、queryなしで実ファイルを読む。製品のVite設定・製品モジュールは変更しない。Viteが注入するHMR client自体は使うが、実際に取得したclient中のtokenから得た完全一致の `ws://127.0.0.1:4176/?token=…` だけを診断上の例外として扱い、context内の通信しないmockとして開いたまま保つ。HMRメッセージはローカルで捨て、serverへの接続・転送・即時closeをしない。即時closeによる再接続・tokenなしping・起動時例外を避ける。contextを閉じて全page/socketを終了させた後に、最後の拒否記録を検査する。同じoriginでも別path・別token・余分なqueryのsocketは遮断したうえで失敗とする。`hmr:false` だけで注入clientの通信試行がなくなるとは扱わない。

設定用HTMLと入力fixtureは完全一致のローカルURLでのみ応答し、GETかつdocument以外はcontextの拒否処理へfallbackする。外部origin・余分なquery・POST/fetchをpage routeが隠さない。Playwrightは受入専用serverを起動し、すでに動いている別設定のserverを再利用しない。

依存パッケージやブラウザのCI準備ダウンロードと、ブラウザ検査中の通信は区別する。外部サービスや公開サイトへのテストアクセスは不要。

## 手元での再検査

```sh
npm ci
npm test
npm run build
npm run test:browser:discovery
npx --no-install playwright install --with-deps chromium webkit
npm run test:browser
```

Playwrightは既存の1.61.1を維持する。対応するブラウザ実行ファイルがない環境では、検出成功とブラウザ未実行を分けて報告する。実機検査は別途必要。
