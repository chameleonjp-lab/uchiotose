# ウチオトセ 手動操縦・照準修正の検証（2026-11-07）

[承認済み計画](https://github.com/chameleonjp-lab/zero-series/blob/main/docs/ZERO_SERIES_AIM_ASSIST_REMOVAL_PLAN_20261107.md) のR1、確認①〜④とウチオトセ固有条件に対応する候補です。main開始点は `8de66dbfdcbedbd8a6f3b607e1020684a63f9476`、作業branchは `fix/manual-camera-aim-20261107`。公開・マージはしていません。

## 変更と数値検査

- 両モードの自機操縦から標的追尾、残留補正、敵の位置による倍率を除去。倍率は1。Easyは最新の確定姿勢・画面比・既存の遮蔽・円内・1200mの条件で引き金だけを自動操作し、Normalは長押し射撃を維持。機銃・機関砲の左右4発は機体正面へ発射する。
- 操縦指／キーが残る中央入力はpitchを保持する。離すと従来の水平復帰へ戻る。高さだけのresizeでは402×874→402×380の縦横比反転も含め、指・射撃・操作量・保留中のloopを維持し、次の移動で座標を合わせる。回転・離脱・停止・既存の入力解除待ちは保持する。
- 既存の数値姿勢計算を維持。機体quaternionとbank/pitch/yawを同じ割合で補間し、カメラ・照準・対象位置を同じ表示状態へ揃える。停止再開・操縦機交代の境界では、次の確定tickまで全actor・対象・補間弾を現在端点に保持し、以前の表示区間を再生しない。発射・命中・時計には補間を使わない。

`tests/manual-camera-aim.test.ts` と入力回帰検査で次を確認した。

| 検査 | Easy | Normal |
| --- | --- | --- |
| seed73・高度1500、敵なし／正面／円縁／画面端／背後／交差消失、4入力×12tickの自機・camera一致 | 一致、倍率1 | 一致、倍率1 |
| 約20度で中央保持0.2秒、その後解放 | 保持中0度、解放後は水平復帰 | 同左 |
| 左右MG・cannon初速と発射時の正面 | 差1e-12未満 | 同左、解放時0発 |
| 120Hz相当・上昇0.45・基準48表示の同じ視線 | 0/48 | 0/48 |
| 30/60/120Hz相当の確定した飛行・弾・時計・結果 | 全状態一致 | 全状態一致 |
| 旋回開始alpha0、宙返り中断alpha0/1のcamera | 数値姿勢と一致 | 数値姿勢と一致 |
| 敵の円内出入／ID切替、alpha0/.5/1の実HUD色 | 表示対象と一致 | 表示対象と一致 |
| renderなしの停止→再開 | 古い姿勢なし | 同左 |

CPU renderer stubは実`WorldRenderer.render`を通すが、GPU実測ではない。操作用EventTarget検査も実機touchではない。

## RED→GREENと実行結果

修正前の同じ入力で、追尾・中央保持・曲がる弾・旧標的保持・高さresize・姿勢とbankの位相差を再現した（最初のfocused検査は13件中8失敗）。HUDへ最新の対象を渡す旧処理だけを戻すと、追加したreticle位相検査も失敗することを確認し、修正版へ戻して合格した。停止再開の古い姿勢もRED→GREENを確認した。独立レビューで自機以外の対象がalpha0へ戻る境界を追加再現し、全actor・HUD・補間弾を現在端点へ揃える修正後に合格した。新しいtickで通常補間が再開することも検査した。追加レビューでは実mainのresize callbackによる解除と、幅不変で縦横比が反転する解除をそれぞれREDで再現し、height-onlyでは保留操作も維持、幅変更／実orientationchangeでは解除する修正後に合格した。旧追尾を要求した検査だけを新仕様へ変更し、感度・throttle・解除待ち・score・ice・AIの既存検査は維持した。

| 実行コマンド／対象 | この候補での結果 |
| --- | --- |
| `npm test` | 234/234合格、0 skip。既存opt-in長時間3件は未実行 |
| `node --import tsx --test tests/manual-camera-aim.test.ts` | 15/15合格 |
| `npm run build` | 合格。既存の500kB chunk警告のみ |
| `npm run test:ui:types` | 合格 |
| `npm run test:browser:discovery` | Chromium6、WebKit6を検出 |
| `node scripts/prepare-pages.mjs <empty-dir>` | 合格。dist全ファイルのcopyとSHA-256一致、`.nojekyll`、ranking=falseを確認 |
| UI-only／castle／live camera既存browser gate | 待機中。共有4CPU環境の混雑を避け、browser slot解放後または提出版と同treeのCIで実行 |
| 通常出撃・両モード・縦402×874／横874×402／短い縦402×700 | 自動browser受入は未実行 |
| iPhone 17 Pro Safari、バー開閉・回転・停止再開 | 実機未確認 |

初回browser試行は臨時origin4186/4187が既存local-only4176 guardに拒否され、UI12件／live28件が失敗した。製品の動作判定には数えず、guardやworkflowは変更していない。端末の表示間隔中央値／p95は未測定。候補のbuild assetは `index-B4gYYk4d.js`、SHA-256 `e46d1a78e44938dde3dc627979bed68e35ebd74e185a2b843e089eb150ac1936`。CSSは公開版と同じ。

## 公開版の照合

開始時の実公開ページ `https://uchiotose.chameleonjp.chatgpt.site/` のHTML・JS・CSSをTLS検証付きで取得し、開始mainから同設定で作ったファイルと全バイト一致を確認した。公開のrelease/deployment識別値は `89725b8bf96b7bdbef6869284f8c764ed9cd4e10`（開始mainとの差はREADMEのみ）。公開JSは `index-B2mJ0w2C.js`、SHA-256 `9d9469bddc55de4f884a17e2445c5608444b31112327d54a1dc4c13460c9ef81`。

開始版の数値再現では、右105・前500と背後500の配置差でEasy約2.5452度、Normal約0.50917度のcamera差、中央保持で両モード約9.38618度のpitch復帰、旋回開始時Normal約0.68231度の姿勢/bank位相差があった。これは当該作品で測った値で、他作品の値ではない。

修正候補の公開後照合は未実施。本人のマージ・公開後、初回表示と古いタブのreloadの両方で配信HTML／JS／CSSを候補から再構築した全バイトと照合する。実機確認と公開確認は自動検査と別に記録する。
