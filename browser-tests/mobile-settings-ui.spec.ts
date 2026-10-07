import type { Page } from '@playwright/test';
import { expect, test } from './local-only';
import { isLocalFixtureRequest, LOCAL_FIXTURE_URLS } from './network-policy';

// Exercise the actual production settings module and styles without requiring WebGL,
// starting a mission, or replacing the settings implementation with a test double.
async function openFixture(page: Page) {
  await page.route(LOCAL_FIXTURE_URLS.settings, async route => {
    const request = route.request();
    if (!isLocalFixtureRequest('settings', request.url(), request.method(), request.resourceType())) {
      await route.fallback();
      return;
    }
    await route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html lang="ja"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="stylesheet" href="/src/style.css"><link rel="stylesheet" href="/src/control-settings.css"></head><body>
      <main id="app" data-screen="home" data-mode="normal">
        <button id="fixture-open" type="button" disabled>操作設定を開く</button>
        <div hidden><button id="fire"></button><button id="loop"></button>
          <div id="throttle" role="slider" tabindex="0"></div></div>
      </main><script type="module">
        import { ControlSettings } from '/src/control-settings.ts';
        import { KeyboardSettings } from '/src/keyboard-settings.ts';
        const keyboard = new KeyboardSettings();
        const buttons = Object.fromEntries(['fire', 'loop', 'throttle']
          .map(name => [name, document.getElementById(name)]));
        const settings = new ControlSettings(buttons, keyboard);
        const opener = document.getElementById('fixture-open');
        opener.addEventListener('click', () => settings.open(opener, 'normal', true));
        window.__settingsUI = { fireCode: () => keyboard.code('fire') };
        opener.disabled = false;
      </script></body></html>`,
    });
  });
  await page.goto('/settings-ui-fixture');
  await expect(page.locator('#fixture-open')).toBeEnabled();
  await page.locator('#fixture-open').click();
  await expect(page.locator('#control-settings')).toBeVisible();
}

async function activeFireCode(page: Page) {
  return page.evaluate(() => (window as Window & { __settingsUI?: { fireCode(): string } }).__settingsUI?.fireCode());
}

async function editFireKey(page: Page) {
  await page.locator('#control-editor-keyboard').click();
  await page.locator('[data-key-action="fire"]').click();
  await page.keyboard.press('q');
  await expect(page.locator('[data-key-action="fire"]')).toHaveText('Q');
}

test('settings retain Normal 3 / Easy 1 controls and nine keys, and persist only this game', async ({ page }) => {
  await page.addInitScript(() => {
    for (const key of ['kaisen-keyboard-v1', 'kaisen-controls-v1', 'kaisen-controls-easy-v1']) {
      localStorage.setItem(key, `untouched:${key}`);
    }
  });
  await openFixture(page);
  await page.locator('#control-editor-touch').click();
  await page.locator('#control-mode').selectOption('normal');
  const target = page.locator('#control-target');
  await expect(target.locator('option:not(:disabled)')).toHaveCount(3);
  await expect(target).toHaveValue('fire');
  await page.locator('#control-size').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#control-size')).toHaveValue('98');

  await page.locator('#control-mode').selectOption('easy');
  await expect(target).toBeDisabled();
  await expect(target).toHaveValue('loop');
  // The Easy select is intentionally disabled; inspect each option's own flag.
  const easyAvailableControls = await target.locator('option').evaluateAll(options =>
    options.filter(option => !(option as HTMLOptionElement).disabled).map(option => (option as HTMLOptionElement).value));
  expect(easyAvailableControls).toEqual(['loop']);
  await editFireKey(page);
  await expect(page.locator('.keyboard-setting-row')).toHaveCount(9);
  await expect(page.locator('#control-keyboard-editor')).not.toContainText(/爆弾|魚雷/);
  await expect(page.locator('[data-key-action="pause"]')).toHaveAccessibleName(/一時停止・再開/);
  expect(await activeFireCode(page)).toBe('Space');
  await page.locator('#control-save').click();
  await expect(page.locator('#control-settings')).not.toBeVisible();
  await expect(page.locator('#fixture-open')).toBeFocused();
  expect(await activeFireCode(page)).toBe('KeyQ');

  const saved = await page.evaluate(() => ({
    normal: JSON.parse(localStorage.getItem('uchiotose-controls-v2') ?? 'null'),
    keyboard: JSON.parse(localStorage.getItem('uchiotose-keyboard-v1') ?? 'null'),
    ownKeys: Object.keys(localStorage).filter(key => key.startsWith('uchiotose-')).sort(),
    legacy: ['kaisen-keyboard-v1', 'kaisen-controls-v1', 'kaisen-controls-easy-v1'].map(key => localStorage.getItem(key)),
  }));
  expect(saved.normal.controls.fire.size).toBe(98);
  expect(saved.keyboard.bindings.fire).toBe('KeyQ');
  expect(saved.ownKeys).toEqual(['uchiotose-controls-v2', 'uchiotose-keyboard-v1']);
  expect(saved.legacy).toEqual(['untouched:kaisen-keyboard-v1', 'untouched:kaisen-controls-v1', 'untouched:kaisen-controls-easy-v1']);
  await page.reload();
  await expect(page.locator('#fixture-open')).toBeEnabled();
  expect(await activeFireCode(page)).toBe('KeyQ');
  await page.locator('#fixture-open').click();
  await page.locator('#control-editor-touch').click();
  await expect(page.locator('#control-size')).toHaveValue('98');
});

test('failed persistence requires explicit session-only apply and does not survive reload', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'uchiotose-keyboard-v1') throw new DOMException('blocked', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await openFixture(page);
  await editFireKey(page);
  await page.locator('#control-save').click();
  await expect(page.locator('#control-settings')).toBeVisible();
  await expect(page.locator('#control-storage-note')).toBeVisible();
  await expect(page.locator('#control-save')).toHaveText('今回だけ使う');
  expect(await activeFireCode(page)).toBe('Space');
  expect(await page.evaluate(() => localStorage.getItem('uchiotose-keyboard-v1'))).toBeNull();
  await page.locator('#control-save').click();
  await expect(page.locator('#control-settings')).not.toBeVisible();
  expect(await activeFireCode(page)).toBe('KeyQ');
  await page.locator('#fixture-open').click();
  await page.locator('#control-editor-keyboard').click();
  await expect(page.locator('[data-key-action="fire"]')).toHaveText('Q');
  await page.reload();
  await expect(page.locator('#fixture-open')).toBeEnabled();
  expect(await activeFireCode(page)).toBe('Space');
});

test('discard, close, and Escape preserve active bindings and return focus on repeated opens', async ({ page }) => {
  await openFixture(page);
  for (const dismiss of ['discard', 'close', 'escape']) {
    await editFireKey(page);
    if (dismiss === 'escape') await page.keyboard.press('Escape');
    else await page.locator(dismiss === 'discard' ? '#control-cancel' : '#control-close').click();
    await expect(page.locator('#control-settings')).not.toBeVisible();
    await expect(page.locator('#fixture-open')).toBeFocused();
    expect(await activeFireCode(page)).toBe('Space');
    expect(await page.evaluate(() => localStorage.getItem('uchiotose-keyboard-v1'))).toBeNull();
    await page.locator('#fixture-open').click();
    await page.locator('#control-editor-keyboard').click();
    await expect(page.locator('[data-key-action="fire"]')).toHaveText('Space');
  }
  await page.locator('#control-save').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#control-close')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#control-save')).toBeFocused();
});

for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }, { width: 568, height: 320 }]) {
  test(`settings editors remain usable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openFixture(page);
    for (const editor of ['touch', 'keyboard']) {
      await page.locator(`#control-editor-${editor}`).click();
      await expect(page.locator(`#control-${editor}-editor`)).toBeVisible();
      await expect(page.locator('#control-save')).toBeInViewport();
      await expect(page.locator('#control-close')).toBeInViewport();
      const dimensions = await page.locator('#control-settings').evaluate(dialog => ({
        left: dialog.getBoundingClientRect().left,
        right: dialog.getBoundingClientRect().right,
        viewport: document.documentElement.clientWidth,
        content: dialog.scrollWidth,
        width: dialog.clientWidth,
      }));
      expect(dimensions.left).toBeGreaterThanOrEqual(0);
      expect(dimensions.right).toBeLessThanOrEqual(dimensions.viewport);
      expect(dimensions.content).toBeLessThanOrEqual(dimensions.width);
    }
    await page.locator('#control-cancel').click();
    await expect(page.locator('#fixture-open')).toBeFocused();
  });
}

test('Normal lever uses real focused keys and pointer capture, preserving short commands until one consumed tick', async ({ page }) => {
  await page.route(LOCAL_FIXTURE_URLS.input, async route => {
    const request = route.request();
    if (!isLocalFixtureRequest('input',request.url(),request.method(),request.resourceType())) { await route.fallback(); return; }
    await route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/src/style.css"><link rel="stylesheet" href="/src/control-settings.css"></head><body>
      <main id="app" data-screen="playing" data-mode="normal"><section id="hud" class="screen">
        <button id="touch-fire" class="flight-button">射撃</button><button id="touch-loop" class="flight-button">宙返り</button>
        <div id="touch-throttle" class="throttle-lever" role="slider" tabindex="0" aria-label="速度レバー" aria-orientation="vertical" aria-valuemin="-100" aria-valuemax="100" aria-valuenow="0" data-no-steering><span class="throttle-up">加速</span><span class="throttle-neutral">保持</span><span class="throttle-down">減速</span><i class="throttle-handle"></i></div>
        <p id="throttle-layout-note" hidden></p></section></main><script type="module">
        import { FlightControls } from '/src/input.ts'; import { ControlSettings } from '/src/control-settings.ts'; import { KeyboardSettings } from '/src/keyboard-settings.ts';
        const buttons={fire:document.querySelector('#touch-fire'),loop:document.querySelector('#touch-loop'),throttle:document.querySelector('#touch-throttle')};
        const keyboard=new KeyboardSettings(), controls=new FlightControls(document.querySelector('#app'),buttons,()=>true,keyboard,'normal');
        const settings=new ControlSettings(buttons,keyboard,undefined,()=>controls.clear()); settings.setActiveMode('normal'); controls.acknowledgeRelease();
        window.__leverProbe={controls};
      </script></body></html>`});
  });
  await page.goto('/input-probe');
  await page.waitForFunction(()=>Boolean((window as any).__leverProbe));
  const slider=page.getByRole('slider',{name:'速度レバー'}); await expect(slider).toBeVisible();
  await expect(slider).toHaveAttribute('aria-disabled','false');
  const box=await slider.boundingBox();expect(box).not.toBeNull();expect(box!.width).toBeGreaterThanOrEqual(44);expect(box!.height).toBeGreaterThan(44);
  await slider.focus();
  await page.keyboard.press('ArrowUp');
  expect(await page.evaluate(()=>{const c=(window as any).__leverProbe.controls;return [c.sample(false).throttle,c.sample(false).throttle,c.sampleThrottle(),c.sampleThrottle(),c.sample(false).climb];})).toEqual([1,1,1,0,0]);
  await page.keyboard.down('w'); expect(await page.evaluate(()=>(window as any).__leverProbe.controls.sample(false).throttle)).toBe(1);
  await page.keyboard.press('Tab'); expect(await page.evaluate(()=>(window as any).__leverProbe.controls.sample(false).throttle)).toBe(0);
  await page.keyboard.up('w'); expect(await page.evaluate(()=>(window as any).__leverProbe.controls.sampleThrottle())).toBe(0);
  await page.mouse.move(box!.x+box!.width/2,box!.y+22); await page.mouse.down();
  expect(await page.evaluate(()=>{const c=(window as any).__leverProbe.controls;return {axis:c.sampleThrottle(),capture:document.querySelector('#touch-throttle')!.hasPointerCapture(c.peek().throttlePointer)};})).toEqual({axis:1,capture:true});
  await page.mouse.move(box!.x+box!.width/2,box!.y+22+(box!.height-44)*.23); await page.mouse.up();
  const axes=await page.evaluate(()=>{const c=(window as any).__leverProbe.controls;return [c.sample(false).throttle,c.sampleThrottle(),c.sampleThrottle(),c.requiresRelease];});
  expect(axes[0] as number).toBeCloseTo(.5,1);expect(axes[1] as number).toBeCloseTo(.5,1);expect(axes.slice(2)).toEqual([0,false]);
  await expect(slider).toHaveAttribute('aria-valuenow','0');
});
