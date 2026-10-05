import { expect, test } from '@playwright/test';

test('flight input requires physical release and recovers from a missed pointer up', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as Window & { __uchiotose?: unknown }).__uchiotose));

  const result = await page.evaluate(async () => {
    const { FlightControls } = await import('/src/input.ts');
    const fixture = document.createElement('div');
    fixture.id = 'input-recovery-fixture';
    Object.assign(fixture.style, { position: 'fixed', inset: 'auto auto 8px 8px', width: '240px', height: '80px', zIndex: '20' });
    const makeButton = (id: string): HTMLButtonElement => {
      const button = document.createElement('button');
      button.id = id;
      button.type = 'button';
      button.textContent = id;
      fixture.append(button);
      return button;
    };
    const buttons = {
      fire: makeButton('probe-fire'), loop: makeButton('probe-loop'),
      accelerate: makeButton('probe-accelerate'), brake: makeButton('probe-brake'),
    };
    document.body.append(fixture);
    const controls = new FlightControls(fixture, buttons, () => true, undefined, 'normal');
    controls.acknowledgeRelease();
    const pointer = (type: 'pointerdown' | 'pointerup', id: number, target: HTMLElement, isPrimary: boolean) => {
      target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary,
        clientX: 25 + id, clientY: 35,
      }));
    };

    pointer('pointerdown', 1, buttons.fire, true);
    const heldFire = controls.sample().fire;
    controls.clear(); // Simulate blur or handoff before the browser delivers pointerup.
    const neutralAfterClear = controls.sample().fire;
    pointer('pointerdown', 2, buttons.fire, true);
    pointer('pointerup', 2, buttons.fire, true);
    const recoveredAfterNewPrimary = controls.allReleased && controls.acknowledgeRelease();

    pointer('pointerdown', 3, buttons.fire, true);
    pointer('pointerdown', 4, buttons.loop, false);
    const simultaneousFire = controls.sample().fire;
    pointer('pointerup', 3, buttons.fire, true);
    const otherTouchStillOwned = !controls.allReleased;
    pointer('pointerup', 4, buttons.loop, false);
    const loopEdge = controls.sample().loop;
    const recoveredAfterBothLifts = controls.allReleased && controls.acknowledgeRelease();

    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, code: 'KeyW' }));
    const heldThrottle = controls.sample().accelerate;
    controls.clear();
    const neutralUntilKeyup = !controls.sample().accelerate && !controls.allReleased;
    window.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, code: 'KeyW' }));
    const releasedKeyAcknowledged = controls.allReleased && controls.acknowledgeRelease();
    controls.dispose();
    fixture.remove();
    return {
      heldFire, neutralAfterClear, recoveredAfterNewPrimary,
      simultaneousFire, otherTouchStillOwned, loopEdge, recoveredAfterBothLifts,
      heldThrottle, neutralUntilKeyup, releasedKeyAcknowledged,
    };
  });

  expect(result).toEqual({
    heldFire: true,
    neutralAfterClear: false,
    recoveredAfterNewPrimary: true,
    simultaneousFire: true,
    otherTouchStillOwned: true,
    loopEdge: true,
    recoveredAfterBothLifts: true,
    heldThrottle: true,
    neutralUntilKeyup: true,
    releasedKeyAcknowledged: true,
  });
});
