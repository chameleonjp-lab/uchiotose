/* Adapted from kaisen-reference/src/rules-guide.ts at 3d751051dc6212482a129e8da596ddd349b2f9f5. */
import { containDialogTabFocus } from './dialog-focus';

export type GameMode = 'normal' | 'easy';
export type GuideInput = 'touch' | 'keyboard';
export interface RulesContext { mode: GameMode; input: GuideInput; keyboardDescription: string; }
export interface RuleSection { heading: string; paragraphs: string[]; }

export function ruleSections({ mode, input, keyboardDescription }: RulesContext): RuleSection[] {
  const easy = mode === 'easy';
  return [
    { heading: '作戦概要', paragraphs: [
      '味方艦隊10隻と、総残機50機の飛行隊で、浮遊島から出撃する飛行戦士100人を迎え撃ちます。',
      '味方機・敵戦士は総数が決まっています。同時に画面へ出る数ではなく、HUDには総残数と現在の出撃数を分けて表示します。',
    ] },
    { heading: '勝利と敗北', paragraphs: [
      '敵の飛行戦士100人をすべて撃破すると勝利です。予備の敵がいる間は、画面上に敵が見えなくても作戦は続きます。',
      '味方の総残機50機をすべて失うか、味方艦隊10隻が全滅すると敗北です。自機だけを失っても、残機があれば復帰または僚機への操縦引継ぎが行われます。',
      '設定やルールを開くと作戦は停止したままです。説明を閉じても自動では再開しません。',
    ] },
    { heading: '味方の残機と復帰', paragraphs: [
      '開始時は自機1機と僚機7機が出撃し、残り42機が予備です。同時に出撃できる味方は8機までです。撃墜された機体は損失として記録し、同じ機体を再利用しません。',
      '予備があるときは約3秒後に新しい機体が出撃します。自機を失った場合は自機枠を優先して補充し、条件がそろえば生存僚機へ操縦を引き継ぎます。',
    ] },
    { heading: input === 'touch' ? 'タッチ操作' : 'PC操作', paragraphs: input === 'touch' ? [
      '画面のボタン以外をドラッグして機体を操縦します。指を離すと操縦入力が戻ります。操縦とボタン操作を別の指で同時に行えます。',
      easy ? 'イージーは操縦・照準を補助し、射程内の敵へ自動で射撃します。宙返りはボタンを押します。タッチボタンは合計1個です。' : 'ノーマルは射撃・宙返りの2ボタンと速度レバー1本の合計3操作です。レバーを上へ倒すと加速、下へ倒すと減速し、離すと中央へ戻って調整した速度を保持します。射線を自動補正しません。',
      '操作設定ではモードごとにボタンの位置、大きさ、不透明度を調整できます。プレビューでもボタンをドラッグできます。',
    ] : [
      keyboardDescription,
      easy ? 'イージーは操縦・照準を補助し、射程内の敵へ自動で射撃します。' : 'ノーマルは射撃・加速・減速のキーを押している間だけ操作します。',
      'マウスやタッチで画面をドラッグして操縦することもできます。操作設定ではタッチ配置とキー割当の両方をいつでも選べます。',
    ] },
    { heading: '飛行と武器', paragraphs: [
      '巡航速度は396km/h、最高速度は約508km/h、通常の最低速度は234km/hです。ノーマルでは操作設定で割り当てた加速・減速キーを使います。宙返りは約5秒かかり、完了後2秒の待ち時間があります。',
      '機銃288発と機関砲96発を装備します。機関砲は機銃より威力があります。弾薬は補給回数に上限がありませんが、両方の弾倉を使い切ると6秒の共通装填が必要です。片方が空でも、もう片方は残弾があれば撃てます。',
      '弾は遠距離ほど威力が下がります。イージーでは射程1,200m以内の敵に自動射撃します。ノーマルでは自分で射線を合わせてください。',
    ] },
    { heading: '敵の魔法弾と状態異常', paragraphs: [
      '飛行戦士は火球と氷球を発射します。火球が命中すると1秒間、毎秒8HPの継続損傷を受けます。氷球は5秒間、機体の速度を最大50km/h下げます。',
      '航空機は安全のため65m/s（234km/h）未満へ減速しません。そのため最低速度付近では氷の減速幅が小さくなります。氷は艦の速度を6m/sから0まで下げることがありますが、艦の射撃と装填は続きます。',
      '火傷と氷は同時に続く場合があります。HUDは時間を表示し、形・尾・状態ラベルでも見分けます。',
    ] },
    { heading: '得点', paragraphs: [
      '得点は「敵撃破×100 + 自機の実損傷HP×5 + 時間加点 − 自機損失×500 − 僚機損失×200 − 艦損失×1,000」です。',
      '自機の実損傷は、操縦中の味方機が敵へ与えたHP減少だけを数えます。撃破を味方が行っても、それまでの自機貢献は残ります。敵撃破の加点は、自機・僚機・艦隊による撃破を含みます。',
      '時間加点は勝利時だけで、10,000 × max(0, 1 − 作戦秒数/600) × (自機実損傷HP/8,000) です。作戦時間600秒または自機の実損傷0HPで0点となり、敗北時の時間加点はありません。',
      '表示された各内訳は小数第2位までで、最終合計を最後に一度だけ整数へ丸めます。',
    ] },
  ];
}

/** Native modal keeps focus and Escape inside the guide without resuming the mission. */
export class RulesGuide {
  private readonly dialog: HTMLDialogElement;
  private readonly content: HTMLElement;
  private returnFocus: HTMLElement | null = null;
  private readonly abort = new AbortController();
  get isOpen() { return this.dialog.open; }
  constructor(private readonly context: () => RulesContext, private readonly clearInput: () => void) {
    this.dialog = document.createElement('dialog'); this.dialog.id = 'rules-guide';
    this.dialog.className = 'rules-dialog'; this.dialog.setAttribute('aria-labelledby', 'rules-title');
    this.dialog.innerHTML = '<header class="rules-header"><div><p class="eyebrow">HOW TO PLAY</p><h2 id="rules-title">ルールと操作方法</h2></div><button type="button" id="rules-close" aria-label="説明を閉じる">×</button></header><div id="rules-content" class="rules-content" tabindex="0" role="region" aria-label="ルール説明の内容"></div><footer><button type="button" id="rules-back" class="primary">元の画面へ戻る</button></footer>';
    document.getElementById('app')!.append(this.dialog);
    this.content = this.dialog.querySelector('#rules-content')!;
    for (const id of ['rules-close', 'rules-back']) this.dialog.querySelector('#' + id)!.addEventListener('click', () => this.close(), { signal: this.abort.signal });
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); }, { signal: this.abort.signal });
    this.dialog.addEventListener('keydown', event => containDialogTabFocus(this.dialog, event), { signal: this.abort.signal });
    this.dialog.addEventListener('close', () => {
      this.clearInput();
      const returnFocus = this.returnFocus;
      this.returnFocus = null;
      if (returnFocus?.isConnected && !returnFocus.closest('[hidden]')) {
        requestAnimationFrame(() => {
          if (returnFocus.isConnected && !returnFocus.closest('[hidden]')) returnFocus.focus({ preventScroll: true });
        });
      }
    }, { signal: this.abort.signal });
  }
  open(button: HTMLElement) {
    if (this.isOpen) return;
    this.returnFocus = button; this.clearInput(); this.content.replaceChildren();
    for (const section of ruleSections(this.context())) {
      const element = document.createElement('section'), heading = document.createElement('h3');
      heading.textContent = section.heading; element.append(heading);
      for (const text of section.paragraphs) { const p = document.createElement('p'); p.textContent = text; element.append(p); }
      this.content.append(element);
    }
    this.dialog.showModal(); this.content.scrollTop = 0;
    this.dialog.querySelector<HTMLButtonElement>('#rules-close')!.focus({ preventScroll: true });
  }
  close() { if (this.isOpen) this.dialog.close(); }
  dispose() { this.close(); this.abort.abort(); this.dialog.remove(); }
}
