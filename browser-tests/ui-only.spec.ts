import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './local-only';

type Phase = 'home' | 'playing' | 'paused' | 'result';
type Mode = 'normal' | 'easy';
type UIAPI = {
  show(phase: Phase, mode?: Mode, outcome?: 'victory' | 'defeat'): void;
  showError(phase: 'home' | 'paused' | 'result'): void;
  fireCode(): string;
  showLoading(): void;
  showHUDState(variant: 'effects' | 'warning' | 'respawn'): void;
  canvasRegions(): Record<string, {x:number;y:number;width:number;height:number}>;
};
declare global { interface Window { __uiOnly: UIAPI; __uiUnhandled: string[] } }

// Fail on real uncaught application errors. Error-state specimens do not throw.
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    window.__uiUnhandled = [];
    addEventListener('unhandledrejection', event => window.__uiUnhandled.push(String(event.reason)));
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  Object.assign(page, {uiErrors: errors});
});
test.afterEach(async ({page}, info) => {
  const consoleAndPageErrors = (page as Page & {uiErrors: string[]}).uiErrors;
  let unhandled: string[] | null = null, collectionError: string | null = null;
  try {
    if (page.isClosed() || page.url() === 'about:blank') throw new Error('UI document unavailable for error collection');
    unhandled = await page.evaluate(() => window.__uiUnhandled);
    if (!Array.isArray(unhandled)) throw new Error('Unhandled-rejection listener did not initialize');
  } catch (error) { collectionError = String(error); }
  await info.attach('ui-errors.json', {body: JSON.stringify({consoleAndPageErrors, unhandled, collectionError}, null, 2), contentType:'application/json'});
  expect(collectionError, 'UI error collection must complete').toBeNull();
  expect(unhandled, 'No unhandled UI promise rejection').toEqual([]);
  expect(consoleAndPageErrors, 'No uncaught UI errors').toEqual([]);
});

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#start')).toBeEnabled();
}
async function show(page: Page, phase: Phase, mode: Mode = 'normal', outcome: 'victory' | 'defeat' = 'victory'): Promise<void> {
  await page.evaluate(({phase, mode, outcome}) => window.__uiOnly.show(phase, mode, outcome), {phase, mode, outcome});
  await expect(page.locator('#app')).toHaveAttribute('data-screen', phase);
}
async function record(page: Page, info: TestInfo, name: string): Promise<void> {
  await page.screenshot({path: info.outputPath(`${name}.png`)});
}
async function fitsHorizontally(page: Page, selector: string): Promise<void> {
  const box = await page.locator(selector).evaluate(element => {
    const r = element.getBoundingClientRect();
    return {left: r.left, right: r.right, width: innerWidth, content: element.scrollWidth, client: element.clientWidth};
  });
  expect(box.left).toBeGreaterThanOrEqual(-1);
  expect(box.right).toBeLessThanOrEqual(box.width + 1);
  expect(box.content).toBeLessThanOrEqual(box.client + 1);
}
async function scoreClearsHud(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => {
      const r = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};
    };
    const score = rect('#hud-score');
    const flightData = rect('.flight-data');
    const warningElement = document.querySelector<HTMLElement>('#hud-warning')!;
    const warning = rect('#hud-warning');
    const radius = innerWidth < 360 ? 42 : 49;
    const centerX = innerWidth - radius - 18;
    const centerY = Math.min(innerHeight * .33, 180);
    const nearestX = Math.max(score.left, Math.min(centerX, score.right));
    const nearestY = Math.max(score.top, Math.min(centerY, score.bottom));
    const disjoint = (a: typeof score, b: typeof score) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
    return {radius, radarDistance:Math.hypot(centerX-nearestX,centerY-nearestY), radar:{centerX,centerY}, score, flightData, warning, warningVisible:warningElement.getClientRects().length>0 && getComputedStyle(warningElement).display!=='none', flightDataClear:disjoint(score,flightData), warningClear:disjoint(score,warning)};
  });
  expect(geometry.radarDistance, `#hud-score must clear the product Canvas2D radar by 4 CSS px: ${JSON.stringify(geometry)}`).toBeGreaterThan(geometry.radius + 4);
  expect(geometry.flightDataClear, `#hud-score must not overlap flight-data: ${JSON.stringify(geometry)}`).toBe(true);
  if (geometry.warningVisible) expect(geometry.warningClear, `#hud-score must not overlap a visible warning: ${JSON.stringify(geometry)}`).toBe(true);
}

async function loopLabelStaysOnOneLine(page: Page): Promise<void> {
  const geometry = await page.locator('#touch-loop').evaluate(button => {
    const label = button.querySelector('b')!;
    const range = document.createRange();
    range.selectNodeContents(label);
    const buttonRect = button.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    return {lineCount:range.getClientRects().length,button:{left:buttonRect.left,right:buttonRect.right,top:buttonRect.top,bottom:buttonRect.bottom},label:{left:labelRect.left,right:labelRect.right,top:labelRect.top,bottom:labelRect.bottom}};
  });
  expect(geometry.lineCount, `宙返りラベル must stay on one line: ${JSON.stringify(geometry)}`).toBe(1);
  expect(geometry.label.left).toBeGreaterThanOrEqual(geometry.button.left);
  expect(geometry.label.right).toBeLessThanOrEqual(geometry.button.right);
  expect(geometry.label.top).toBeGreaterThanOrEqual(geometry.button.top);
  expect(geometry.label.bottom).toBeLessThanOrEqual(geometry.button.bottom);
}

async function warningClearsTopHud(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => {
      const r = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};
    };
    const gap = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>, px: number) => a.right + px <= b.left || b.right + px <= a.left || a.bottom + px <= b.top || b.bottom + px <= a.top;
    const warning = document.querySelector<HTMLElement>('#hud-warning')!;
    const warningRect = rect('#hud-warning'), targetsRect = rect('.targets'), actionsRect = rect('.hud-actions');
    const sightRegion = window.__uiOnly.canvasRegions().sight;
    const sightRect = {left:sightRegion.x,right:sightRegion.x+sightRegion.width,top:sightRegion.y,bottom:sightRegion.y+sightRegion.height};
    const radarRadius = innerWidth < 360 ? 42 : 49;
    const radarCenterX = innerWidth - radarRadius - 18;
    const radarCenterY = Math.min(innerHeight * .33, 180);
    const radarRect = {left:radarCenterX-radarRadius,right:radarCenterX+radarRadius,top:radarCenterY-radarRadius,bottom:radarCenterY+radarRadius+18};
    const landscapeCanvasHud = innerWidth >= 568 && innerHeight <= 400;
    return {warningVisible:warning.getClientRects().length>0 && getComputedStyle(warning).display!=='none',warning:warningRect,targets:targetsRect,actions:actionsRect,targetsClear:gap(warningRect,targetsRect,4),actionsClear:gap(warningRect,actionsRect,0),landscapeCanvasHud,sight:sightRect,radar:radarRect,sightClear:!landscapeCanvasHud||gap(warningRect,sightRect,4),radarClear:!landscapeCanvasHud||gap(warningRect,radarRect,4)};
  });
  expect(geometry.warningVisible, 'HUD warning fixture must be visible').toBe(true);
  expect(geometry.targetsClear, `warning must not cover target counts: ${JSON.stringify(geometry)}`).toBe(true);
  expect(geometry.actionsClear, `warning must not cover sound/Pause actions: ${JSON.stringify(geometry)}`).toBe(true);
  if (geometry.landscapeCanvasHud) {
    expect(geometry.sightClear, `warning must clear the product Canvas2D sight by 4 CSS px: ${JSON.stringify(geometry)}`).toBe(true);
    expect(geometry.radarClear, `warning must clear the product Canvas2D radar by 4 CSS px: ${JSON.stringify(geometry)}`).toBe(true);
  }
}

async function paintedOverlay(page: Page): Promise<void> {
  const painted = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#markers')!;
    const context = canvas.getContext('2d')!;
    const count = (box: {x:number;y:number;width:number;height:number}, color?: number[]) => {
      const x = Math.max(0, Math.floor(box.x)), y = Math.max(0, Math.floor(box.y));
      const image = context.getImageData(x,y,Math.min(Math.ceil(box.width),canvas.width-x),Math.min(Math.ceil(box.height),canvas.height-y)).data;
      let pixels = 0;
      for (let i = 0; i < image.length; i += 4) {
        if (image[i+3] > 128 && (!color || color.every((v,n) => Math.abs(v-image[i+n]) <= 5))) pixels++;
      }
      return pixels;
    };
    const regions = window.__uiOnly.canvasRegions();
    return {
      sight: count(regions.sight,[255,100,91]), reload: count(regions.sight,[255,210,122]),
      enemy: count(regions.enemy,[255,178,139]), friendly: count(regions.friendly,[119,218,203]),
      ship: count(regions.ship,canvas.width < 700 ? [110,201,189] : [119,218,203]), offscreen: count(regions.offscreen,[255,178,139]),
      radar: count({x:canvas.width-125,y:35,width:120,height:Math.min(225,canvas.height-35)},[255,244,206]),
    };
  });
  for (const [name, pixels] of Object.entries(painted)) {
    let diagnostic: unknown = null;
    if (name === 'ship' && pixels <= 2) {
      try {
        diagnostic = await page.evaluate(() => {
          const canvas = document.querySelector<HTMLCanvasElement>('#markers')!;
          const context = canvas.getContext('2d')!;
          const box = window.__uiOnly.canvasRegions().ship;
          const x = Math.max(0, Math.floor(box.x)), y = Math.max(0, Math.floor(box.y));
          const width = Math.min(Math.ceil(box.width), canvas.width - x);
          const height = Math.min(Math.ceil(box.height), canvas.height - y);
          const image = context.getImageData(x, y, width, height).data;
          const colors = new Map<string, number>();
          let alphaPixels = 0;
          for (let i = 0; i < image.length; i += 4) {
            if (image[i + 3] <= 128) continue;
            alphaPixels++;
            const rgba = `${image[i]},${image[i + 1]},${image[i + 2]},${image[i + 3]}`;
            colors.set(rgba, (colors.get(rgba) ?? 0) + 1);
          }
          return {
            box, canvas: {width: canvas.width, height: canvas.height},
            sample: {x, y, width, height}, alphaPixels,
            rgbaCounts: [...colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
          };
        });
      } catch (error) { diagnostic = {diagnosticError: String(error)}; }
    }
    const details = diagnostic ? ` Canvas sample: ${JSON.stringify(diagnostic)}` : '';
    expect(pixels, `${name} must paint its own product Canvas2D region${details}`).toBeGreaterThan(2);
  }
}

for (const viewport of [{width: 320, height: 568}, {width: 568, height: 320}, {width: 1280, height: 720}]) {
  test(`real screens and 2D HUD fit ${viewport.width}x${viewport.height}`, async ({page}, info) => {
    await page.setViewportSize(viewport);
    await open(page);
    await expect(page.locator('#title')).toHaveText('ウチオトセ');
    await expect(page.locator('.mission-data > div')).toHaveCount(3);
    await fitsHorizontally(page, '#home');
    await record(page, info, 'home');
    await page.locator('#home-rules').click();
    await expect(page.locator('#rules-guide')).toBeVisible();
    await fitsHorizontally(page, '#rules-guide');
    await expect(page.locator('#rules-back')).toBeInViewport();
    await record(page, info, 'rules');
    await page.locator('#rules-close').click();
    await expect(page.locator('#home-rules')).toBeFocused();

    for (const mode of ['easy', 'normal'] as const) {
      await show(page, 'playing', mode);
      await expect(page.locator('#hud')).toBeVisible();
      await expect(page.locator('#hud-mode')).toHaveText(mode === 'normal' ? 'ノーマル' : 'イージー');
      await expect(page.locator('#hud-time')).toHaveText('02:03');
      await expect(page.locator('#hud-aircraft')).toHaveText('50/50');
      await expect(page.locator('#touch-loop')).toBeVisible();
      await loopLabelStaysOnOneLine(page);
      await expect(page.locator('#touch-fire')).toBeVisible({visible: mode === 'normal'});
      await expect(page.locator('#touch-throttle')).toBeVisible({visible: mode === 'normal'});
      for (const selector of ['.time-block', '.targets', '.hud-actions']) await fitsHorizontally(page, selector);
      const geometry = await page.evaluate(() => {
        const rect = (selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}; };
        return {clock:rect('#hud-time'),targets:rect('.targets'),actions:rect('.hud-actions')};
      });
      const disjoint = (a: typeof geometry.clock, b: typeof geometry.clock) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
      expect(disjoint(geometry.clock, geometry.targets)).toBe(true);
      expect(disjoint(geometry.clock, geometry.actions)).toBe(true);
      expect(disjoint(geometry.targets, geometry.actions)).toBe(true);
      await scoreClearsHud(page);
      await paintedOverlay(page);
      await record(page, info, `hud-${mode}`);
    }
    await page.evaluate(() => window.__uiOnly.showHUDState('warning'));
    await expect(page.locator('#hud-warning')).toBeVisible();
    await warningClearsTopHud(page);
    await scoreClearsHud(page);
    await record(page, info, 'hud-warning-score-clearance');
    await page.locator('#pause-button').click();
    await expect(page.locator('#pause-screen')).toBeVisible();
    await fitsHorizontally(page, '#pause-screen .panel');
    await record(page, info, 'pause');
    await page.locator('#pause-settings').click();
    for (const editor of ['touch', 'keyboard']) {
      await page.locator(`#control-editor-${editor}`).click();
      await expect(page.locator(`#control-${editor}-editor`)).toBeVisible();
      await fitsHorizontally(page, '#control-settings');
      await expect(page.locator('#control-save')).toBeInViewport();
      await expect(page.locator('#control-close')).toBeInViewport();
      await record(page, info, `settings-${editor}`);
    }
    await page.locator('#control-close').click();
    await expect(page.locator('#pause-settings')).toBeFocused();
    for (const outcome of ['victory', 'defeat'] as const) {
      await show(page, 'result', 'normal', outcome);
      await expect(page.locator('#result-title')).toHaveText(outcome === 'victory' ? '作戦成功' : '作戦失敗');
      await expect(page.locator('#result-score')).toHaveText('15,101');
      await expect(page.locator('#result-breakdown > div')).toHaveCount(6);
      await expect(page.locator('#result-breakdown')).toContainText('自機損失 1機');
      await fitsHorizontally(page, '#result .panel');
      await page.locator('#result-title').scrollIntoViewIfNeeded();
      await record(page, info, `result-${outcome}`);
      await page.locator('#result-settings').scrollIntoViewIfNeeded();
      await expect(page.locator('#result-settings')).toBeInViewport();
      await record(page, info, `result-${outcome}-actions`);
    }
  });
}

test('real navigation, settings save, reload and repeated cancel/close/Escape', async ({page}) => {
  await open(page);
  await page.getByLabel('ノーマル', {exact: true}).check();
  await expect(page.locator('#mode-guide')).toContainText('速度レバー');
  await page.locator('#start').click();
  await expect(page.locator('#hud')).toBeVisible();
  await page.locator('#pause-button').click();
  await page.locator('#pause-settings').focus();
  await page.keyboard.press('Tab'); await expect(page.locator('#resume')).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(page.locator('#pause-settings')).toBeFocused();
  await page.locator('#pause-rules').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-rules')).toBeFocused();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'paused');
  await page.locator('#resume').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'playing');
  await page.locator('#pause-button').click(); await page.locator('#home-return').click();
  await expect(page.locator('#start')).toBeFocused();

  for (const dismiss of ['control-cancel', 'control-close', 'Escape']) {
    await page.locator('#home-settings').click();
    await page.locator('#control-editor-keyboard').click();
    await expect(page.locator('.keyboard-setting-row')).toHaveCount(9);
    await page.locator('[data-key-action="fire"]').click(); await page.keyboard.press('q');
    await expect(page.locator('[data-key-action="fire"]')).toHaveText('Q');
    if (dismiss === 'Escape') await page.keyboard.press('Escape'); else await page.locator(`#${dismiss}`).click();
    await expect(page.locator('#home-settings')).toBeFocused();
    expect(await page.evaluate(() => window.__uiOnly.fireCode())).toBe('Space');
  }
  await page.locator('#home-settings').click();
  await page.locator('#control-editor-touch').click();
  await page.locator('#control-mode').selectOption('normal');
  await expect(page.locator('#control-target option:not(:disabled)')).toHaveCount(3);
  await page.locator('#control-size').focus(); await page.keyboard.press('ArrowRight');
  await expect(page.locator('#control-size')).toHaveValue('98');
  await page.locator('#control-mode').selectOption('easy');
  await expect(page.locator('#control-target')).toBeDisabled();
  await expect(page.locator('#control-target')).toHaveValue('loop');
  await page.locator('#control-editor-keyboard').click();
  await page.locator('[data-key-action="fire"]').click(); await page.keyboard.press('q');
  await page.locator('#control-save').click();
  await expect(page.locator('#home-settings')).toBeFocused();
  await page.reload(); await expect(page.locator('#start')).toBeEnabled();
  expect(await page.evaluate(() => window.__uiOnly.fireCode())).toBe('KeyQ');
  await page.locator('#home-settings').click(); await page.locator('#control-editor-touch').click();
  await page.locator('#control-mode').selectOption('normal');
  await expect(page.locator('#control-size')).toHaveValue('98');
  await page.locator('#control-close').click();
  await show(page, 'result'); await page.locator('#result-settings').click();
  await page.keyboard.press('Escape'); await expect(page.locator('#result-settings')).toBeFocused();
  await page.locator('#retry').click(); await expect(page.locator('#app')).toHaveAttribute('data-screen', 'playing');
  await show(page, 'result'); await page.locator('#result-home').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'home');
});

test('storage failure shows explicit session-only settings without claiming persistence', async ({page}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key: string, value: string) {
      if (key === 'uchiotose-keyboard-v1') throw new DOMException('UI specimen storage failure', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  await open(page); await page.locator('#home-settings').click();
  await page.locator('#control-editor-keyboard').click();
  await page.locator('[data-key-action="fire"]').click(); await page.keyboard.press('q');
  await page.locator('#control-save').click();
  await expect(page.locator('#control-storage-note')).toBeVisible();
  await expect(page.locator('#control-save')).toHaveText('今回だけ使う');
  expect(await page.evaluate(() => window.__uiOnly.fireCode())).toBe('Space');
  await page.locator('#control-save').click();
  await expect(page.locator('#control-settings')).toBeHidden();
  expect(await page.evaluate(() => window.__uiOnly.fireCode())).toBe('KeyQ');
  await page.reload(); await expect(page.locator('#start')).toBeEnabled();
  expect(await page.evaluate(() => window.__uiOnly.fireCode())).toBe('Space');
});

test('loading, HUD status and error presentations retain usable exits', async ({page}, info) => {
  await open(page);
  await page.evaluate(() => window.__uiOnly.showLoading());
  await expect(page.locator('#start')).toBeDisabled();
  await expect(page.locator('#p1-status')).toContainText('準備しています');
  await record(page, info, 'loading');
  for (const variant of ['effects', 'warning', 'respawn'] as const) {
    await page.evaluate(variant => window.__uiOnly.showHUDState(variant), variant);
    if (variant === 'effects') {
      await expect(page.locator('#hud-effects')).toContainText('火傷');
      await expect(page.locator('#hud-effects')).toContainText('氷');
    } else if (variant === 'warning') await expect(page.locator('#hud-warning')).toContainText('海面接近');
    else await expect(page.locator('#hud-respawn')).toContainText('操縦引継ぎ中');
    await record(page, info, `hud-${variant}`);
  }
  for (const phase of ['home', 'paused', 'result'] as const) {
    await page.evaluate(phase => window.__uiOnly.showError(phase), phase);
    const action = phase === 'home' ? '#start' : phase === 'paused' ? '#resume' : '#retry';
    await expect(page.locator(action)).toBeDisabled();
    await expect(page.locator(phase === 'home' ? '#p1-status' : phase === 'paused' ? '#pause-reason' : '#result-reason')).toContainText('再読み込み');
    await record(page, info, `error-${phase}`);
    const settings = phase === 'home' ? '#home-settings' : phase === 'paused' ? '#pause-settings' : '#result-settings';
    await page.locator(settings).click(); await expect(page.locator('#control-settings')).toBeVisible();
    await page.locator('#control-close').click(); await expect(page.locator(settings)).toBeFocused();
    if (phase !== 'home') {
      await page.locator(phase === 'paused' ? '#home-return' : '#result-home').click();
      await expect(page.locator('#app')).toHaveAttribute('data-screen', 'home');
      await expect(page.locator('#start')).toBeDisabled();
    }
  }
});
