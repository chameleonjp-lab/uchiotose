# ウチオトセ: 速度レバー追補とadapterの実装待ち

最新のローカル統合状況は末尾「2026-10-07 ローカル統合候補」を参照。以下は2026-10-05時点の記録。

2026-10-05 UTC。対象main: [`df519dae14a09295112f8d7cb9e781b3043bdff4`](https://github.com/chameleonjp-lab/uchiotose/tree/df519dae14a09295112f8d7cb9e781b3043bdff4)。

## 現在の範囲

Homeと有限戦力台帳（`src/main.ts`・`src/roster.ts`）は存在するが、飛行入力・速度制御・操作設定は未接続。今回のレバー実装対象となるruntimeはまだmainにない。既存のP0/P1実装とその証拠は保持する。

今回追加するのは共通契約、機械可読の期待値fixture、本作への適用差分と参照のみ。ゲーム本体・操作UI・保存移行は未実装であり、共通fixtureの配置を実ゲームでの検証合格とは扱わない。**統合は飛行/input/設定コードがmainへ届くまでblocked**。未実装の画面をレバー対応済みと表示しない。

R13の氷効果は通常の目標速度・基準速度とは分離したままにする。レバー変更を氷減速の変更や二重適用にしない。爆弾・魚雷を追加しない。

## 契約の優先順位と本作の差分

- [共通契約v1](THROTTLE_LEVER_CONTRACT.md)と本追補は、既存の[REQUIREMENTS.md](REQUIREMENTS.md)・[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)に対する2026-10-05の限定追補。旧加速/減速タッチ2ボタン、対応設定、タッチコントロール数、v1タッチ保存への書込みに限り、この追補を優先する
- Normalは射撃・宙返りの2ボタン＋速度レバー1本（合計3コントロール）、Easyは宙返り1ボタンのまま。旧「Normal4／Easy1」の数え方をこの範囲だけ更新する。レバーをボタン2個と数えない
- PC9操作と既存の変更可能なW/S相当キーは維持。Normalで±1入力、同時押し0。Easyの巡航・手動加減速制限は維持し、Easy画面/設定に速度レバーを追加しない
- 目標速度は65..141 m/s、最大調整率18 m/s毎秒。上下のアナログ量と8%deadzoneは全作品共通。解放で入力だけ0に戻し、調整済みの目標速度と既存の飛行/空力式を保持する
- 設定項目は「速度レバー」1項目へ統合し、x/y・大きさ・不透明度、左右配置、同じ縦長プレビュー、保存/破棄/今回だけ使うを共通契約どおり接続する
- 旧 `uchiotose-controls-v1` / `uchiotose-controls-easy-v1` のrawは保持する。明示保存先は新しい `uchiotose-controls-v2` / `uchiotose-controls-easy-v2`。`uchiotose-keyboard-v1` と記録用キーは変更しない。他作品の保存キーは読書きしない
- 変更対象の追跡: R09・R13・R17〜R18、A15〜A18の入力・設定観点。既存受入の他観点は削除・合格扱いにせず、共通契約の入力所有/中断解除/アクセシビリティ/保存互換/QAを追加する

## 接続順序と停止条件

1. 実装を始める時に最新mainと進行中PRを再確認する。飛行コードが未着なら本追補の状態を維持し、ゲーム全体を代わりに実装しない
2. P2の飛行、P6/P7の操作・設定・画面、P8の受入へ本追補を組み込む。採用する共通 `src/throttle-lever.ts` の内容hashとfixture hashを記録し、repo adapterだけを分離する
3. 実際の入力sampleから `FlightInput.throttle` を渡し、実際に速度へ反映される経路（`advanceThrottle` または作品のruntime速度更新）でfixtureを試験する。共通関数だけが合格し、製品sample/速度更新が未接続の状態を見逃さない。明示0優先/legacy互換、target保持、上下限、Easy回帰を含める。fixtureだけを独立計算して製品合格とはしない
4. pointer所有と解除、複数指、キー再割当/IME、pause/blur/hidden/resize/設定/再出撃、44px領域・縦横・200%・focus操作を実UIで検査する
5. v1保持、未来version保護、全キーpreflight、保存途中失敗rollback、Cancel・session-only、reloadを実storageと設定画面で検査する
6. 最終候補でunit/type/buildと必要なChromium/WebKitを実行し、旧画面と同条件画像でレバー以外の継承を確認する。実機と模擬環境を区別する。未検証があればDraftを維持する

## 共通ファイルと検証状態

- `THROTTLE_LEVER_CONTRACT.md` SHA-256: `cd0e7db83c54cf349fb6a178a8abcd22bf09f78376cb4b836784faa2ae721864`
- [`fixtures/throttle-lever-v1.json`](fixtures/throttle-lever-v1.json) SHA-256: `416c5ac01d4d14d1f45d94385e07233090740db04382e468db1f0c64689df8ca`
- JSONは共通テスト用の期待値データであり、自動実行ランナーやruntime実装ではない。全35ケース（axis11・pointer10・combine6・advance8）を実adapter接続時に実行する
- 本追補で確認できる範囲: 共通ファイルのbyte/hash一致、JSONの形式・ケース数、参照先、既存文書の本文保持、差分の限定
- 未実施/blocked: レバーの単体統合、ゲーム起動後のブラウザー操作、保存移行、端末上の操作感・性能、全ゲーム受入。既存の実装/検査履歴を本レバーの検査結果に流用しない

復元は本追補のcommit差分をGitで戻す。既存文書の本文と旧v1保存は削除しない。mainへの直接push、merge/automerge、配備・公開設定・権限・ランキング変更は本追補に含めない。

## 2026-10-07 ローカル統合候補（未提出・未公開）

上記の2026-10-05記録は当時の未接続状態の履歴として保持する。今回の固定基点は `2a7e815c70baf9dc65721fc938909b6ab083f074`、Git commit APIで確認したroot treeは `54f157d4ace9c3ed4398b706509bd9144ba8a29e`。この基点には飛行/input/設定が揃っており、承認された共通UI・速度レバー統一のローカル候補を作成した。

### 接続内容と保持境界

- 既存の全幅app、Home/Pause/Result、`#touch-fire`・`#touch-loop`、UI-controller境界を保持。旧速度2ボタンを `#touch-throttle` へ置換し、Normal3/Easy1とルール・設定を整合させた。44px以上のhandleと縦slider、共通の長方形プレビューを追加。44px高で実レール長0または安全候補なしの場合はレバーを無効化し、保存を止める
- `input.sample(false)` は描画frameで未消費入力を保持し、FixedClockの実tickだけ `sampleThrottle()` を消費する。短いW/S・再割当キー・focused矢印・pointerupは1tickへ渡し、0tick frameで失わず8tick catchupへ再生しない。軸更新後の未消費fractionも同じ扱い
- Uchiotose既存のphysical/blockedキー・pointerとreleaseGateを維持し、レバーも参加する。capture lossは物理liftと扱わず、暗黙capture lossで別ownerを止めない。`controlResetVersion` が変わる実 `main.step` で入力を明示 `throttle: 0` に置換し、実物理releaseとsimulation側の承認を両方通す
- focusedのW/S・再割当速度キーは入力源を追跡し、focusout/Escapeでそのhold/pendingを破棄する。物理keyup待ちを維持し、keyupで古いpulseを復活させない。レバー未接続の旧fixtureはanalog fieldを追加せず、旧accelerate/brakeと支援技術clickの互換を保つ
- `flight-types.ts` とinput境界にoptional throttleを追加し、実 `advanceThrottle` が共通resolve関数を使う。65..141m/s、18m/s毎秒、8%deadzone、Easy巡航、空力・氷処理・50機/100戦士/10艦・補充/引継ぎ・勝敗/得点は保持。爆弾・魚雷は追加しない
- U専用v2 normal/easyと既存keyboard-v1のみを明示保存。旧v1 raw不変、未来version・全件preflight、失敗時raw rollback、allowlist付き復元journalを追加。rollback不完了→Cancel→再open→未変更Saveもjournalを再読取して復元を再試行する。Cancel/表示/ロードは書込なし。「今回だけ使う」はメモリだけで適用する
- 同時タブのlocalStorage読取・比較・書込は完全排他ではない。競合検出時の拒否・旧v1隔離・控え保持を検査したが、複数タブの線形化や未協調の旧コードを保証しない

### ローカル証跡と残る確認

- 共通pure `src/throttle-lever.ts` SHA-256 `e83fe3c570581d16cb76e08ef9a039bbe9d4a50da6575366ac7e126bf3f30cf0`。契約・fixtureは上記hashからbyte変更なし。35fixtureは製品入力/速度更新を含め検査
- 最終単体検査205/205、製品TypeScript strict、build、今回追加/変更テスト・specのstrictはpass。独立レビューでfocused速度キー取消の不具合を再現し、修正後4/4、実main.step本文による世代交代/二段gate1/1を確認。既存長時間・world/roster/combat・30/60/120fps・1秒gap停止・8tick予算を含む
- 任意の全tests/browser追加strictは固定基点・候補とも同じ17診断でfail、診断全文はbyte一致、新規型診断0。既存absolute browser import、Window cast、WebSocket fixture型の未修正診断をpassへ換算しない。製品buildの既存500kB超chunk警告も残る
- Playwright collectionのみWebKit7/Chromium18を確認。ブラウザ実行・画像比較・実pointer/保存UI・200%表示・実機・音・性能はblocked/not_run。native browser socketのEPERMが確認済みで、今回起動・再試行・迂回を行っていない。DOMの模擬イベント単体検査を実ブラウザや実機合格としない
- 基点tree226blobのうち86textを取得しGit blob SHAを全件照合。未取得140blob（docs139、`scripts/verify-publication-http.py` 1）は旧証拠/資料等を含み、削除せず変更対象外。ZIP内のsourceは完全checkoutではない。GitHub/Drive書込、PR、CI、merge、配備・公開は実行していない
- 成果はローカルの旧source控え・候補・全変更path/hash一覧・差分patch・検査ログ・復元メモにまとめる。復元は既知基点に対する限定patch逆適用で行い、未取得パスを残したままにする。控えなし上書き、ディレクトリ全体の置換、再帰削除はしない

参照規約: 採用harness `2accbc6f062c6b7932777c61051df56a02302339` のAGENTS/core.contract/core.execution/registry、ui-input/gameplay-state/security/persistence/testing/delivery。新たな外部書込や権限拡大の承認として扱わない。
