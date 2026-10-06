import {expect, test} from './local-only';

test.use({launchOptions: {args: ['--disable-webgl']}});
test('WebGL startup failure leaves an explicit explanation and usable Home guides', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('#start')).toBeDisabled();
  await expect(page.locator('#p1-status')).toContainText('3D描画を起動できません');
  await expect(page.locator('#app')).toHaveAttribute('data-screen','home');
  await page.locator('#home-rules').click();
  await expect(page.locator('#rules-guide')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#home-settings').click();
  await expect(page.locator('#control-settings')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__uchiotose.snapshot().mission.tick)).toBe(0);
});
