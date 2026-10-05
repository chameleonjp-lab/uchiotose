/* Adapted from kaisen-reference/src/dialog-focus.ts at 3d751051dc6212482a129e8da596ddd349b2f9f5. */
/** Keep Tab inside the active modal; native dialogs can otherwise reach browser chrome. */
export function containDialogTabFocus(dialog: HTMLDialogElement, event: KeyboardEvent): void {
  containTabFocus(dialog, event, dialog.open);
}

/** Keep a visible screen panel's Tab order inside its active controls. */
export function containTabFocus(container: HTMLElement, event: KeyboardEvent, active = true): void {
  if (!active || event.defaultPrevented || event.key !== 'Tab'
    || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;

  const view = container.ownerDocument.defaultView;
  const controls = Array.from(container.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]'))
    .filter(element => element.tabIndex >= 0 && !element.matches(':disabled')
      && !element.closest('[hidden], [inert]') && element.getClientRects().length > 0
      && view?.getComputedStyle(element).visibility !== 'hidden'
      && view?.getComputedStyle(element).visibility !== 'collapse')
    .sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity));
  const index = controls.indexOf(container.ownerDocument.activeElement as HTMLElement);
  const target = event.shiftKey
    ? index <= 0 ? controls.at(-1) : undefined
    : index === -1 || index === controls.length - 1 ? controls[0] : undefined;
  if (target || controls.length === 0) {
    event.preventDefault();
    (target ?? container).focus();
  }
}
