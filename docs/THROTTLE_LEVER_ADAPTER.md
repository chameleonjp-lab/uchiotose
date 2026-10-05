# ウチオトセ: 速度レバー追補とadapterの実装待ち

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
