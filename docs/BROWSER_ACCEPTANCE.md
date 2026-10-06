# ブラウザ受入検査

## 必須条件

- `npm test` と `npm run build` が成功する
- `npm run test:browser:discovery` が WebKit (`webkit-ui`) と Chromium (`chromium`) の両方で実行可能な検査を1件以上検出する
- `npm run test:browser` で両プロジェクトの全検査が成功する。検出だけではブラウザ動作の合格としない
- 未実行、失敗、skipのみ、期待失敗のみのプロジェクトを合格としない。`--pass-with-no-tests` で空のプロジェクトを隠さない

`pretest:browser` は必ず両プロジェクトの検出を先に検査する。Chromiumの検査件数が多くても、WebKitが0件なら失敗する。CLIを直接実行する場合はこのnpmフックを通らないため、単発の調査結果を全体合格に読み替えない。

`.github/workflows/browser-acceptance.yml` はPRのhead SHA（main pushでは当該SHA）を検査し、既存の単体検査・build・Chromium検査を保ったまま上記条件を実行する。公開・デプロイ・ランキング送信は含めない。

## WebKitの対象

`browser-tests/mobile-settings-ui.spec.ts` は製品の `ControlSettings`、`KeyboardSettings` とCSSをローカルfixtureで読み込む。設定機能をダミーに置き換えず、WebGL・ミッション開始から独立して検査する。

- Normalのタッチ4操作、Easyの宙返り1操作、PCの9操作
- タッチ配置とキーの保存、再読込、他ゲームの保存キーの保護
- 保存失敗後に明示的に「今回だけ使う」を選ぶまで反映しないこと、再読込での初期値復帰
- 破棄・閉じる・Esc、再度開く操作、フォーカス復帰とTab境界
- 320×568、393×852、568×320の両設定エディターと閉じる/保存ボタンへの到達

同じ6検査をChromiumでも実行し、既存11検査は削除・置換しない。WebKit設定fixtureの合格は、ゲーム全体のWebKit描画・iPhone実機Safari・GPU性能の合格を意味しない。速度レバーの統合待ち範囲も変更しない。

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
