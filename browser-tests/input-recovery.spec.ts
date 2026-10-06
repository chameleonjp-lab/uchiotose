import { expect, test } from './local-only';
import { isLocalFixtureRequest, LOCAL_FIXTURE_URLS } from './network-policy';

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

test('real multi-touch pointer capture release preserves the other held input', async ({ page }) => {
  await page.route(LOCAL_FIXTURE_URLS.input, async route => {
    const request = route.request();
    if (!isLocalFixtureRequest('input', request.url(), request.method(), request.resourceType())) {
      await route.fallback();
      return;
    }
    await route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
      <style>html,body,#app{margin:0;width:100%;height:100%;touch-action:none}#app{position:fixed;inset:0}button{position:absolute;width:64px;height:64px;touch-action:none}#fire{left:150px;top:60px}#loop{left:230px;top:60px}#accelerate{left:310px;top:60px}#brake{left:150px;top:140px}</style>
      <main id="app"><button id="fire" type="button"></button><button id="loop" type="button"></button><button id="accelerate" type="button"></button><button id="brake" type="button"></button></main>
      <script type="module">
        import { FlightControls } from '/src/input.ts';
        const app = document.querySelector('#app');
        const buttons = Object.fromEntries(['fire', 'loop', 'accelerate', 'brake'].map(name => [name, document.querySelector('#' + name)]));
        const controls = new FlightControls(app, buttons, () => true, undefined, 'normal');
        controls.acknowledgeRelease();
        const down = [];
        const lost = [];
        const observed = [];
        for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']) {
          app.addEventListener(type, event => {
            const target = event.target;
            const sample = { type, id: event.pointerId, pointerType: event.pointerType, isPrimary: event.isPrimary,
              target: target.id || target.tagName.toLowerCase(), trusted: event.isTrusted,
              x: event.clientX, y: event.clientY, buttons: event.buttons,
              captured: target.hasPointerCapture?.(event.pointerId) || false };
            observed.push(sample);
            if (type === 'pointerdown') down.push(sample);
            if (type === 'lostpointercapture') lost.push(sample);
          }, true);
        }
        window.__captureProbe = { controls, down, lost, observed };
      </script>`,
    });
  });
  await page.goto('/input-probe');
  await page.waitForFunction(() => Boolean((window as Window & { __captureProbe?: unknown }).__captureProbe));

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: Array<{ id: number; x: number; y: number }>) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map(point => ({ id: point.id, x: point.x, y: point.y, radiusX: 2, radiusY: 2, force: 1 })),
    });
  const settleInput = () => page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await settleInput();
  const inputReady = await page.evaluate(() => {
    const controls = (window as Window & { __captureProbe: { controls: { acknowledgeRelease(): boolean; allReleased: boolean; requiresRelease: boolean } } }).__captureProbe.controls;
    const allReleased = controls.allReleased;
    const acknowledged = controls.acknowledgeRelease();
    return { allReleased, acknowledged, requiresRelease: controls.requiresRelease };
  });
  expect(inputReady).toEqual({ allReleased: true, acknowledged: true, requiresRelease: false });

  await touch('touchStart', [{ id: 1, x: 30, y: 30 }]);
  await settleInput();
  await touch('touchMove', [{ id: 1, x: 80, y: 30 }]);
  await settleInput();
  await touch('touchStart', [{ id: 1, x: 80, y: 30 }, { id: 2, x: 182, y: 92 }]);
  await settleInput();
  const bothHeld = await page.evaluate(() => {
    const { controls, observed, down } = (window as Window & { __captureProbe: { controls: { sample(): { turn: number; fire: boolean }; peek(): unknown }; observed: unknown[]; down: Array<{ id: number; target: string; trusted: boolean }> } }).__captureProbe;
    return { input: controls.sample(), peek: controls.peek(), down: down.slice(), observed: observed.slice() };
  });
  expect(bothHeld.input.turn, JSON.stringify(bothHeld)).toBe(1);
  expect(bothHeld.input.fire, JSON.stringify(bothHeld)).toBe(true);
  expect(bothHeld.down.some(pointer => pointer.target === 'app' && pointer.trusted)).toBe(true);
  expect(bothHeld.down.some(pointer => pointer.target === 'fire' && pointer.trusted)).toBe(true);
  const heldCapture = await page.evaluate(() => {
    const { controls, down } = (window as Window & { __captureProbe: { controls: { peek(): { steerPointer: number | null } }; down: Array<{ id: number; target: string }> } }).__captureProbe;
    const firePointer = down.find(pointer => pointer.target === 'fire')?.id ?? null;
    return {
      steeringPointer: controls.peek().steerPointer,
      firePointer,
      steeringCaptured: controls.peek().steerPointer !== null && document.querySelector('#app')!.hasPointerCapture(controls.peek().steerPointer!),
      fireCaptured: firePointer !== null && document.querySelector('#fire')!.hasPointerCapture(firePointer),
    };
  });
  expect(heldCapture.steeringPointer).not.toBeNull();
  expect(heldCapture.firePointer).not.toBeNull();
  expect(heldCapture.steeringCaptured).toBe(true);
  expect(heldCapture.fireCaptured).toBe(true);

  // CDP touchEnd lists the contact being lifted; Chromium emits pointerup
  // followed by implicit lostpointercapture for only that control.
  await touch('touchEnd', [{ id: 2, x: 182, y: 92 }]);
  await settleInput();
  const afterFireLift = await page.evaluate(() => {
    const { controls, down, lost, observed } = (window as Window & { __captureProbe: { controls: { sample(): { turn: number; fire: boolean }; peek(): unknown; requiresRelease: boolean; allReleased: boolean }; down: Array<{ id: number; target: string }>; lost: Array<{ id: number; target: string; trusted: boolean }>; observed: unknown[] } }).__captureProbe;
    const input = controls.sample();
    return { ...input, peek: controls.peek(), firePointer: down.find(pointer => pointer.target === 'fire')?.id, requiresRelease: controls.requiresRelease, allReleased: controls.allReleased, lost: lost.slice(), observed: observed.slice() };
  });
  expect(afterFireLift.turn, JSON.stringify(afterFireLift)).toBe(1);
  expect(afterFireLift.fire).toBe(false);
  expect(afterFireLift.requiresRelease).toBe(false);
  expect(afterFireLift.allReleased).toBe(false);
  expect(afterFireLift.lost.some(event => event.id === heldCapture.firePointer
    && event.target === 'fire' && event.trusted)).toBe(true);

  await touch('touchEnd', []);
  await settleInput();
  expect(await page.evaluate(() => {
    const controls = (window as Window & { __captureProbe: { controls: { allReleased: boolean } } }).__captureProbe.controls;
    return controls.allReleased;
  })).toBe(true);

  // Reverse the order: fire remains held while its steering companion lifts.
  await touch('touchStart', [{ id: 3, x: 182, y: 92 }]);
  await settleInput();
  await touch('touchStart', [{ id: 3, x: 182, y: 92 }, { id: 4, x: 30, y: 30 }]);
  await settleInput();
  await touch('touchMove', [{ id: 3, x: 182, y: 92 }, { id: 4, x: 80, y: 30 }]);
  await settleInput();
  const reverseSteeringPointer = await page.evaluate(() => {
    const controls = (window as Window & { __captureProbe: { controls: { peek(): { steerPointer: number | null } } } }).__captureProbe.controls;
    return controls.peek().steerPointer;
  });
  await touch('touchEnd', [{ id: 4, x: 80, y: 30 }]);
  await settleInput();
  const afterSteeringLift = await page.evaluate(() => {
    const { controls, down, lost } = (window as Window & { __captureProbe: { controls: { sample(): { turn: number; fire: boolean }; peek(): { steerPointer: number | null }; requiresRelease: boolean; allReleased: boolean }; down: Array<{ id: number; target: string }>; lost: Array<{ id: number; target: string; trusted: boolean }> } }).__captureProbe;
    const input = controls.sample();
    const firePointer = down.filter(pointer => pointer.target === 'fire').at(-1)?.id;
    return { ...input, firePointer, requiresRelease: controls.requiresRelease, allReleased: controls.allReleased, lost: lost.slice() };
  });
  expect(afterSteeringLift.turn).toBe(0);
  expect(afterSteeringLift.fire).toBe(true);
  expect(afterSteeringLift.requiresRelease).toBe(false);
  expect(afterSteeringLift.allReleased).toBe(false);
  expect(afterSteeringLift.lost.some(event => event.id === reverseSteeringPointer
    && event.target === 'app' && event.trusted)).toBe(true);
  await touch('touchEnd', []);
  await settleInput();

  // Deliberately release a live capture through the browser API. Capture loss
  // before physical lift must end its owner, gate input, and wait for touchEnd.
  await touch('touchStart', [{ id: 5, x: 262, y: 92 }]);
  await touch('touchMove', [{ id: 5, x: 264, y: 94 }]);
  await settleInput();
  const loopPointer = await page.evaluate(() => {
    const { controls, down } = (window as Window & { __captureProbe: { controls: { peek(): unknown }; down: Array<{ id: number; target: string }> } }).__captureProbe;
    return down.filter(pointer => pointer.target === 'loop').at(-1)?.id ?? null;
  });
  expect(loopPointer).not.toBeNull();
  expect(await page.evaluate(pointerId => document.querySelector('#loop')!.hasPointerCapture(pointerId!), loopPointer)).toBe(true);
  await page.evaluate(pointerId => document.querySelector('#loop')!.releasePointerCapture(pointerId!), loopPointer);
  await touch('touchMove', [{ id: 5, x: 266, y: 96 }]);
  await settleInput();
  const afterOwnedButtonLoss = await page.evaluate(() => {
    const { controls, lost, observed } = (window as Window & { __captureProbe: { controls: { sample(): { loop: boolean }; peek(): { heldPointers: Record<string, number[]> }; requiresRelease: boolean; allReleased: boolean }; lost: Array<{ id: number; target: string; trusted: boolean }>; observed: unknown[] } }).__captureProbe;
    return { input: controls.sample(), peek: controls.peek(), requiresRelease: controls.requiresRelease, allReleased: controls.allReleased, lost: lost.slice(), observed: observed.slice() };
  });
  expect(afterOwnedButtonLoss.requiresRelease, JSON.stringify(afterOwnedButtonLoss)).toBe(true);
  expect(afterOwnedButtonLoss.allReleased).toBe(false);
  expect(afterOwnedButtonLoss.peek.heldPointers.loop).toEqual([]);
  expect(afterOwnedButtonLoss.input.loop).toBe(false);
  expect(afterOwnedButtonLoss.lost.some(event => event.id === loopPointer && event.target === 'loop' && event.trusted)).toBe(true);
  await touch('touchEnd', [{ id: 5, x: 266, y: 96 }]);
  await settleInput();
  expect(await page.evaluate(() => {
    const controls = (window as Window & { __captureProbe: { controls: { acknowledgeRelease(): boolean; allReleased: boolean; requiresRelease: boolean } } }).__captureProbe.controls;
    const allReleased = controls.allReleased;
    const acknowledged = controls.acknowledgeRelease();
    return { allReleased, acknowledged, requiresRelease: controls.requiresRelease };
  })).toEqual({ allReleased: true, acknowledged: true, requiresRelease: false });

  await touch('touchStart', [{ id: 6, x: 30, y: 30 }]);
  await touch('touchMove', [{ id: 6, x: 80, y: 30 }]);
  await settleInput();
  const steerPointer = await page.evaluate(() => {
    const controls = (window as Window & { __captureProbe: { controls: { peek(): { steerPointer: number | null } } } }).__captureProbe.controls;
    return controls.peek().steerPointer;
  });
  expect(steerPointer).not.toBeNull();
  expect(await page.evaluate(pointerId => document.querySelector('#app')!.hasPointerCapture(pointerId!), steerPointer)).toBe(true);
  await page.evaluate(pointerId => document.querySelector('#app')!.releasePointerCapture(pointerId!), steerPointer);
  await touch('touchMove', [{ id: 6, x: 86, y: 30 }]);
  await settleInput();
  const afterOwnedSteeringLoss = await page.evaluate(() => {
    const { controls, lost, observed } = (window as Window & { __captureProbe: { controls: { sample(): { turn: number }; peek(): { steerPointer: number | null }; requiresRelease: boolean; allReleased: boolean }; lost: Array<{ id: number; target: string; trusted: boolean }>; observed: unknown[] } }).__captureProbe;
    return { input: controls.sample(), peek: controls.peek(), requiresRelease: controls.requiresRelease, allReleased: controls.allReleased, lost: lost.slice(), observed: observed.slice() };
  });
  expect(afterOwnedSteeringLoss.requiresRelease, JSON.stringify(afterOwnedSteeringLoss)).toBe(true);
  expect(afterOwnedSteeringLoss.allReleased).toBe(false);
  expect(afterOwnedSteeringLoss.peek.steerPointer).toBe(null);
  expect(afterOwnedSteeringLoss.input.turn).toBe(0);
  expect(afterOwnedSteeringLoss.lost.some(event => event.id === steerPointer && event.target === 'app' && event.trusted)).toBe(true);
  await touch('touchEnd', [{ id: 6, x: 86, y: 30 }]);
  await settleInput();
  expect(await page.evaluate(() => {
    const controls = (window as Window & { __captureProbe: { controls: { acknowledgeRelease(): boolean; allReleased: boolean; requiresRelease: boolean } } }).__captureProbe.controls;
    const allReleased = controls.allReleased;
    const acknowledged = controls.acknowledgeRelease();
    return { allReleased, acknowledged, requiresRelease: controls.requiresRelease };
  })).toEqual({ allReleased: true, acknowledged: true, requiresRelease: false });

  await cdp.detach();
});
