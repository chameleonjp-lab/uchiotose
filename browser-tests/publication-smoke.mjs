import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const url = process.argv[2];
const commit = process.argv[3];
if (!url || !commit) throw new Error('Usage: node browser-tests/publication-smoke.mjs <url> <game-commit>');
const report = { checkedAt: new Date().toISOString(), url, gameCommit: commit, audience: 'fresh browser context without authentication', errors: [], assets: [], checks: [] };
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 393, height: 648 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
try {
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  assert.equal(response.status(), 200);
  await expect(page.locator('#start')).toBeEnabled();
  await expect(page).toHaveTitle('ウチオトセ');
  assert.equal(await page.evaluate(() => typeof window.__uchiotose), 'undefined');
  await expect(page.locator('#home-sound')).toHaveAttribute('aria-pressed', 'false');
  report.checks.push('Home ready; default sound OFF; development API absent');

  const releaseResponse = await context.request.get(new URL('/release.json', url).href);
  assert.equal(releaseResponse.status(), 200);
  report.release = await releaseResponse.json();
  assert.equal(report.release.commit, commit);
  assert.equal(report.release.ranking, false);
  const paths = await page.locator('script[src], link[rel="stylesheet"][href]').evaluateAll(nodes => nodes.map(node => node.getAttribute(node.tagName === 'SCRIPT' ? 'src' : 'href')));
  for (const path of paths) {
    const asset = await context.request.get(new URL(path, url).href);
    assert.equal(asset.status(), 200);
    const actual = await asset.body();
    const local = await readFile(`dist/${path.replace(/^\.\//, '').replace(/^\//, '')}`);
    assert.deepEqual(actual, local);
    report.assets.push({ path, status: asset.status(), bytes: actual.length, sha256: createHash('sha256').update(actual).digest('hex'), identicalToLocalBuild: true });
  }
  report.checks.push('release commit and JS/CSS bytes match validated main build');

  await page.locator('input[name="game-mode"][value="normal"]').check();
  await page.locator('#start').tap();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'playing');
  await expect(page.locator('#hud-time')).not.toHaveText('00:00');
  const ammo = await page.locator('#hud-ammo').textContent();
  const fire = await page.locator('#touch-fire').boundingBox();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: fire.x + fire.width / 2, y: fire.y + fire.height / 2 }] });
  await page.waitForTimeout(250);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await expect(page.locator('#hud-ammo')).not.toHaveText(ammo);
  await page.locator('#pause-button').tap();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'paused');
  const pausedTime = await page.locator('#hud-time').textContent();
  await page.waitForTimeout(1300);
  assert.equal(await page.locator('#hud-time').textContent(), pausedTime);
  await page.locator('#pause-rules').tap();
  await expect(page.locator('#rules-guide')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#resume').tap();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'playing');
  await expect(page.locator('#hud-time')).not.toHaveText(pausedTime);
  report.checks.push('DOM Normal start/250ms trusted touch fire hold/pause/frozen clock/rules/resume after initial input-release gate');
  await page.screenshot({ path: '/tmp/uchiotose-publication-smoke.png' });
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failure = String(error); throw error;
} finally {
  await writeFile('docs/evidence/publication.json', `${JSON.stringify(report, null, 2)}\n`);
  await context.close(); await browser.close();
}
console.log(JSON.stringify(report));
