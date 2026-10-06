import {expect, test} from './local-only';

// Planned portrait acceptance viewport; GPU measurements use the same size.
test.use({viewport: {width: 393, height: 648}});

async function snapshot(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as any).__uchiotose.snapshot());
}

test('DOM flight, firing, pause, modal guides, resume and five retries preserve the mission flow', async ({page}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#start')).toBeEnabled();
  await page.getByLabel('ノーマル', {exact: true}).check();
  await page.locator('#start').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen','playing');
  await expect.poll(async () => (await snapshot(page)).mission.tick).toBeGreaterThan(2);
  await page.keyboard.down('Space');
  await expect.poll(async () => (await snapshot(page)).mission.aircraft[0].machineGunAmmo).toBeLessThan(288);
  await page.keyboard.up('Space');
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-screen','paused');
  const paused = await snapshot(page);
  await page.waitForTimeout(300);
  expect((await snapshot(page)).mission.tick).toBe(paused.mission.tick);
  await page.locator('#pause-rules').click();
  await expect(page.locator('#rules-guide')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-screen','paused');
  await page.locator('#pause-settings').click();
  await expect(page.locator('#control-settings')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-screen','paused');
  await page.locator('#resume').click();
  await expect.poll(async () => (await snapshot(page)).mission.tick).toBeGreaterThan(paused.mission.tick);
  await expect(page.locator('#app')).toHaveAttribute('data-screen','playing');
  await page.locator('#pause-button').click();
  const initial = await page.evaluate(() => (window as any).__uchiotose.diagnostics().renderer);
  let missionId = (await snapshot(page)).mission.missionId;
  for (let i=0;i<5;i++) {
    await page.locator('#pause-restart').click();
    await expect(page.locator('#app')).toHaveAttribute('data-screen','playing');
    await expect.poll(async () => (await snapshot(page)).mission.tick).toBeGreaterThan(2);
    const current = await snapshot(page);
    expect(current.mission.missionId).not.toBe(missionId); missionId=current.mission.missionId;
    expect(current.mission.aircraft.filter((a: any) => a.status==='active')).toHaveLength(8);
    expect(current.mission.enemies.filter((e: any) => e.status==='active')).toHaveLength(24);
    expect(current.mission.losses).toEqual({player:0,wing:0,ships:0,enemies:0});
    await expect(page.locator('#app')).toHaveAttribute('data-screen','playing');
  await page.locator('#pause-button').click();
    const resources = await page.evaluate(() => (window as any).__uchiotose.diagnostics().renderer);
    expect(resources.geometries).toBe(initial.geometries);
    expect(resources.textures).toBe(initial.textures);
    expect(resources.planes).toBe(initial.planes);
    expect(resources.warriors).toBe(initial.warriors);
    expect(resources.planes).toBe(8); expect(resources.warriors).toBe(24); expect(resources.ships).toBe(10);
    expect(resources.ships).toBe(initial.ships);
  }
  await page.locator('#home-return').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen','home');
  expect(errors).toEqual([]);
});

test('Result fixture displays one immutable score and all loss contributions, then DOM retry resets', async ({page}) => {
  await page.goto('/'); await expect(page.locator('#start')).toBeEnabled();
  await page.evaluate(async () => {
    const simulation = await import('/src/simulation.ts');
    let candidate = simulation.createSimulation({missionId:'result-fixture',seed:1,phase:'playing',mode:'normal'});
    candidate.mission.ships[0].hp=0;
    // Explicit damage fixture; ending and score calculation still use the product step.
    for (let i=0;i<1000 && !candidate.result;i++) {
      for (const enemy of candidate.mission.enemies) if (enemy.status==='active') enemy.hp=0;
      candidate=simulation.stepSimulation(candidate,{turn:0,climb:0,fire:false,loop:false},'normal');
    }
    (window as any).__uchiotose.setStateForTest(candidate);
  });
  await expect(page.locator('#app')).toHaveAttribute('data-screen','result');
  await expect(page.locator('#result-title')).toHaveText('作戦成功');
  await expect(page.locator('#result-mode')).toHaveText('ノーマル');
  await expect(page.locator('#result-breakdown > div')).toHaveCount(6);
  await expect(page.locator('#result-breakdown')).toContainText('敵撃破 100/100');
  await expect(page.locator('#result-breakdown')).toContainText('-1,000');
  const score = await page.locator('#result-score').textContent();
  await page.waitForTimeout(200);
  expect(await page.locator('#result-score').textContent()).toBe(score);
  await page.locator('#result-settings').click();
  await expect(page.locator('#control-settings')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-screen','result');
  await page.locator('#retry').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen','playing');
  const current=await snapshot(page);
  expect(current.mission.missionId).not.toBe('result-fixture');
  expect(current.result).toBeNull();
});

test('WebGL context loss pauses, clears held input, and recovery requires explicit resume', async ({page}) => {
  await page.goto('/'); await expect(page.locator('#start')).toBeEnabled();
  const homeExtensionAvailable=await page.evaluate(() => Boolean((document.querySelector('#flight') as HTMLCanvasElement).getContext('webgl2')?.getExtension('WEBGL_lose_context')));
  test.skip(!homeExtensionAvailable,'The browser does not expose the standard test extension');
  await expect(page.locator('#p1-status')).toBeHidden();
  await page.evaluate(() => {
    const extension = (document.querySelector('#flight') as HTMLCanvasElement).getContext('webgl2')!.getExtension('WEBGL_lose_context')!;
    Object.assign(window, {__homeLostContextExtension: extension}); extension.loseContext();
  });
  await expect(page.locator('#start')).toBeDisabled();
  await expect(page.locator('#p1-status')).toBeVisible();
  await expect(page.locator('#p1-status')).toContainText('復旧を待って');
  await page.evaluate(() => (window as unknown as {__homeLostContextExtension: WEBGL_lose_context}).__homeLostContextExtension.restoreContext());
  await expect(page.locator('#start')).toBeEnabled();
  await expect(page.locator('#p1-status')).toBeHidden();
  await page.locator('#start').click();
  await expect.poll(async () => (await snapshot(page)).mission.tick).toBeGreaterThan(2);
  const available=await page.evaluate(() => Boolean((document.querySelector('#flight') as HTMLCanvasElement).getContext('webgl2')?.getExtension('WEBGL_lose_context')));
  test.skip(!available,'The browser does not expose the standard test extension');
  await page.keyboard.down('ArrowRight');
  await page.evaluate(() => {
    const extension = (document.querySelector('#flight') as HTMLCanvasElement).getContext('webgl2')!.getExtension('WEBGL_lose_context')!;
    Object.assign(window, {__lostContextExtension: extension}); extension.loseContext();
  });
  await expect(page.locator('#app')).toHaveAttribute('data-screen','paused');
  await expect(page.locator('#resume')).toBeDisabled();
  const pausedTick=(await snapshot(page)).mission.tick;
  await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(200);
  await page.evaluate(() => (window as unknown as {__lostContextExtension: WEBGL_lose_context}).__lostContextExtension.restoreContext());
  await expect(page.locator('#resume')).toBeEnabled();
  expect((await snapshot(page)).mission.tick).toBe(pausedTick);
  await page.locator('#resume').click();
  await expect.poll(async () => (await snapshot(page)).mission.tick).toBeGreaterThan(pausedTick);
  await expect(page.locator('#app')).toHaveAttribute('data-screen','playing');
});
