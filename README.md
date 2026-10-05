# uchiotose
ウチオトセ

味方艦隊とともに、浮遊島から来る飛行戦士を迎撃する3D飛行ゲームです。Normal/Easy、タッチ・PC操作、設定、一時停止、有限の戦闘と結果表示を実装しています。ランキング連携は含みません。

`npm ci`、`npm run dev`で起動できます。検証記録は[実装・公開記録](docs/IMPLEMENTATION_RELEASE.md)、公開方法は[公開手順](docs/DEPLOYMENT.md)を参照してください。

## 速度調整レバー（統合待ち）

Normalの加速/減速タッチ2ボタンを上下1本の速度レバーへ統一する[共通契約](docs/THROTTLE_LEVER_CONTRACT.md)と[本作への適用・未実装項目](docs/THROTTLE_LEVER_ADAPTER.md)を追加しています。Easyの自動巡航とPCの加速/減速キーは維持します。ユーザーの指示により今回のゲームを先に公開し、速度レバー・保存移行・対応する受入検査は後続作業とします。今回のNormalタッチ操作は加速・減速・射撃・宙返りの4ボタンです。
