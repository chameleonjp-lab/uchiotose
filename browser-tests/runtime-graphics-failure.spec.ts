import {expect, test} from './local-only';

test.use({viewport: {width: 393, height: 648}, trace: 'off'});
test('a GPU wait failure while already paused disables retry and explains reload', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('#start')).toBeEnabled();
  await page.locator('#start').click();
  await expect.poll(() => page.evaluate(() => (window as any).__uchiotose.snapshot().mission.tick)).toBeGreaterThan(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'paused');
  await expect(page.locator('#resume')).toBeEnabled();
  const tick = await page.evaluate(() => (window as any).__uchiotose.snapshot().mission.tick);
  // Explicit graphics fault fixture: invalidate the static frame, then make the
  // next real WebGL fence wait fail through the product RenderQueue path.
  await page.evaluate(() => {
    const gl = (document.querySelector('#flight') as HTMLCanvasElement).getContext('webgl2')!;
    gl.clientWaitSync = () => gl.WAIT_FAILED;
    window.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('#pause-reason')).toContainText('ページを再読み込み');
  await expect(page.locator('#resume')).toBeDisabled();
  await expect(page.locator('#pause-restart')).toBeDisabled();
  await expect(page.locator('#start')).toBeDisabled();
  await expect(page.locator('#home-return')).toBeFocused();
  expect(await page.evaluate(() => (window as any).__uchiotose.snapshot().mission.tick)).toBe(tick);
  await page.locator('#pause-rules').click();
  await expect(page.locator('#rules-guide')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#home-return').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'home');
  await expect(page.locator('#p1-status')).toContainText('ページを再読み込み');
  await expect(page.locator('#start')).toBeDisabled();
});
