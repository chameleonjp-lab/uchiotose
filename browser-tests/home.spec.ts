import { expect, test } from './local-only';

const homeViewports = [
  { width: 393, height: 648 },
  { width: 568, height: 320 },
  { width: 1280, height: 720 },
];

test('Home is ready and fits the planned viewports', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#start')).toBeEnabled();
  await expect(page.locator('#p1-status')).toHaveText('準備完了 · 操作設定とルールを確認して出撃できます');

  for (const viewport of homeViewports) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('heading', { name: 'ウチオトセ' })).toBeVisible();
    await expect(page.locator('.mission-data > div').nth(0).locator('strong')).toHaveText('50機');
    await expect(page.locator('.mission-data > div').nth(1).locator('strong')).toHaveText('100人');
    await expect(page.locator('.mission-data > div').nth(2).locator('strong')).toHaveText('10隻');
    await expect(page.locator('#app')).toHaveAttribute('data-screen', 'home');
    await expect(page.locator('#home-sound')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#start')).toHaveText('作戦開始 ↗');

    await page.getByLabel('ノーマル', { exact: true }).check();
    await expect(page.locator('#app')).toHaveAttribute('data-mode', 'normal');
    await expect(page.locator('#mode-guide')).toContainText('手動射撃');
    await page.getByLabel('イージー', { exact: true }).check();
    await expect(page.locator('#app')).toHaveAttribute('data-mode', 'easy');
    await expect(page.locator('#mode-guide')).toContainText('自動射撃');
    await page.screenshot({ path: `docs/evidence/home-${viewport.width}x${viewport.height}.png` });

    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  }
});

test('control settings keep nine PC actions and Normal 3 / Easy 1 touch controls', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kaisen-keyboard-v1', 'legacy keyboard');
    localStorage.setItem('kaisen-controls-v1', 'legacy normal');
    localStorage.setItem('kaisen-controls-easy-v1', 'legacy easy');
  });
  await page.goto('/');
  await expect(page.locator('#start')).toBeEnabled();

  await page.locator('#home-settings').click();
  const dialog = page.locator('#control-settings');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#control-editor-touch')).toBeVisible();
  await expect(page.locator('#control-editor-keyboard')).toBeVisible();
  await page.locator('#control-editor-touch').click();

  const touchTarget = page.locator('#control-target');
  await expect(touchTarget.locator('option')).toHaveCount(3);
  await page.locator('#control-mode').selectOption('normal');
  await expect(touchTarget.locator('option:not(:disabled)')).toHaveCount(3);
  await page.locator('#control-mode').selectOption('easy');
  await expect(touchTarget).toBeDisabled();
  const easyAvailableControls = await touchTarget.locator('option').evaluateAll(options =>
    options.filter(option => !(option as HTMLOptionElement).disabled).map(option => (option as HTMLOptionElement).value));
  expect(easyAvailableControls).toEqual(['loop']);
  await expect(touchTarget).toHaveValue('loop');

  await page.locator('#control-editor-keyboard').click();
  const keyRows = page.locator('#control-keyboard-editor .keyboard-setting-row');
  await expect(keyRows).toHaveCount(9);
  await expect(page.locator('#control-keyboard-editor')).not.toContainText(/爆弾|魚雷/i);
  await expect(page.locator('[data-key-action="pause"]')).toHaveAccessibleName(/一時停止・再開/);

  const fireBinding = page.locator('[data-key-action="fire"]');
  await fireBinding.click();
  await page.keyboard.press('q');
  await expect(fireBinding).toHaveText('Q');
  await page.locator('#control-save').click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('#home-settings')).toBeFocused();

  const persisted = await page.evaluate(() => ({
    bindings: JSON.parse(localStorage.getItem('uchiotose-keyboard-v1') ?? 'null'),
    legacy: [
      localStorage.getItem('kaisen-keyboard-v1'),
      localStorage.getItem('kaisen-controls-v1'),
      localStorage.getItem('kaisen-controls-easy-v1'),
    ],
    keys: Object.keys(localStorage).filter(key => key.startsWith('uchiotose-')),
  }));
  expect(persisted.bindings.bindings.fire).toBe('KeyQ');
  expect(persisted.legacy).toEqual(['legacy keyboard', 'legacy normal', 'legacy easy']);
  expect(persisted.keys).toEqual(['uchiotose-keyboard-v1']);
  await expect(page.locator('#start')).toBeEnabled();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'home');
});

test('failed settings persistence offers a session-only apply', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string): void {
      if (key === 'uchiotose-keyboard-v1') throw new DOMException('blocked', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  await page.goto('/');
  await expect(page.locator('#start')).toBeEnabled();
  await page.locator('#home-settings').click();
  await page.locator('#control-editor-keyboard').click();
  await page.locator('[data-key-action="fire"]').click();
  await page.keyboard.press('q');
  await page.locator('#control-save').click();
  await expect(page.locator('#control-storage-note')).toBeVisible();
  await expect(page.locator('#control-save')).toHaveText('今回だけ使う');
  await page.locator('#control-save').click();
  await expect(page.locator('#control-settings')).not.toBeVisible();

  await page.locator('#home-settings').click();
  await page.locator('#control-editor-keyboard').click();
  await expect(page.locator('[data-key-action="fire"]')).toHaveText('Q');
  await expect(page.locator('#start')).toBeEnabled();
});

test('HUD header controls fit three planned viewports and Pause traps keyboard focus', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#start')).toBeEnabled();
  await page.locator('#start').click();
  await expect(page.locator('#hud')).toBeVisible();

  for (const viewport of homeViewports) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector)!;
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
      };
      return {
        viewportWidth: document.documentElement.clientWidth,
        clock: rect('.time-block'),
        clockText: rect('#hud-time'),
        targets: rect('.targets'),
        actions: rect('.hud-actions'),
        tallyText: ['#hud-aircraft', '#hud-enemies', '#hud-ships'].map(rect),
      };
    });
    for (const region of [layout.clock, layout.targets, layout.actions]) {
      expect(region.left).toBeGreaterThanOrEqual(0);
      expect(region.right).toBeLessThanOrEqual(layout.viewportWidth);
    }
    const disjoint = (a: typeof layout.clock, b: typeof layout.clock) =>
      a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
    expect(disjoint(layout.clockText, layout.targets)).toBe(true);
    expect(disjoint(layout.clockText, layout.actions)).toBe(true);
    expect(layout.clockText.left).toBeGreaterThanOrEqual(layout.clock.left);
    expect(layout.clockText.right).toBeLessThanOrEqual(layout.clock.right);
    for (const text of layout.tallyText) {
      expect(text.left).toBeGreaterThanOrEqual(layout.targets.left);
      expect(text.right).toBeLessThanOrEqual(layout.targets.right);
      expect(disjoint(text, layout.actions)).toBe(true);
    }
    expect(layout.targets.right).toBeLessThanOrEqual(layout.actions.left);

    if (viewport.width === 393) {
      const warningLayouts = await page.evaluate(async () => {
        const { projectGunSight } = await import(/* @vite-ignore */ `${'/src/gun-sight.ts'}`);
        const api = (window as any).__uchiotose;
        const state = api.snapshot();
        const player = state.world.aircraft[state.mission.controlledAircraftId];
        const app = document.querySelector<HTMLElement>('#app')!;
        const warning = document.querySelector<HTMLElement>('#hud-warning')!;
        const previousMode = app.dataset.mode, previousText = warning.textContent;
        try {
          warning.textContent = '戦場境界 · 島へ戻ってください';
          return ['normal', 'easy'].map(mode => {
            app.dataset.mode = mode;
            const width = innerWidth, height = innerHeight;
            const sight = mode === 'normal' ? projectGunSight(player, width, height) : { x: width / 2, y: height / 2 };
            const radius = mode === 'normal' ? Math.max(26, Math.min(38, Math.min(width, height) * .085)) : Math.min(width, height) * .135;
            const box = warning.getBoundingClientRect();
            const dx = Math.max(box.left - sight.x, 0, sight.x - box.right);
            const dy = Math.max(box.top - sight.y, 0, sight.y - box.bottom);
            return { mode, clearance: Math.hypot(dx, dy) - radius };
          });
        } finally {
          app.dataset.mode = previousMode;
          warning.textContent = previousText;
        }
      });
      for (const warning of warningLayouts) expect(warning.clearance, `${warning.mode} warning clears the sight`).toBeGreaterThan(6);
    }
  }

  await page.locator('#pause-button').click();
  await expect(page.locator('#pause-screen')).toBeVisible();
  await page.locator('#pause-settings').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#resume')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#pause-settings')).toBeFocused();
});
