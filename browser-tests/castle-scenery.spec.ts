import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { expect, test } from './local-only';

const sourceHashes = Object.fromEntries([
  'castle-layout.ts', 'castle-visual.ts', 'world-renderer.ts', 'island.ts',
].map(name => [name, createHash('sha256').update(readFileSync(new URL(`../src/${name}`, import.meta.url))).digest('hex')]));

for (const viewport of [{width: 393, height: 852}, {width: 852, height: 393}]) {
  test.describe(`castle ${viewport.width}x${viewport.height}`, () => {
    test.use({viewport});
    test('captures the production scene from both sides and keeps its GPU resources stable', async ({page}, testInfo) => {
      test.setTimeout(90000);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('/');
      await expect(page.locator('#start')).toBeEnabled({timeout: 60000});
      await page.screenshot({path: testInfo.outputPath('home.png')});

      // Reuse the exact product scene, materials and lighting. The inspection
      // camera is only a capture fixture; the product flight camera is unchanged.
      const initial = await page.evaluate(async ({width, height}) => {
        const {WorldRenderer} = await import('/src/world-renderer.ts');
        const {createSimulation} = await import('/src/simulation.ts');
        const stage = document.createElement('div');
        stage.id = 'castle-scene-stage';
        stage.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#aecbd0';
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'display:block;width:100%;height:100%';
        stage.append(canvas); document.body.append(stage);
        const renderer = new WorldRenderer(canvas);
        renderer.resize(width, height);
        const fixture = createSimulation({missionId:'castle-static-capture',seed:20261005,phase:'home',mode:'easy'});
        fixture.mission.controlledAircraftId = null;
        await renderer.prepare();
        renderer.render(fixture.world, fixture.mission, [], 'easy', 1);
        (window as any).__castleScene = renderer;
        return renderer.diagnostics();
      }, viewport);
      expect(initial.castleDrawCalls).toBeLessThanOrEqual(10);
      expect(initial.castleDrawCalls).toBeGreaterThan(0);
      expect(initial.castleTriangles).toBeLessThanOrEqual(60000);

      const views = [];
      for (const view of [
        {name:'front', from:[2800,2100,4000], at:[0,1750,0]},
        {name:'near', from:[1550,1700,1900], at:[0,1650,0]},
        {name:'rear', from:[-2500,2200,-3500], at:[0,1800,0]},
      ]) {
        const diagnostic = await page.evaluate(async view => {
          const renderer = (window as any).__castleScene;
          renderer.camera.position.set(...view.from);
          renderer.camera.lookAt(...view.at);
          renderer.camera.updateMatrixWorld();
          renderer.renderer.render(renderer.scene, renderer.camera);
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return renderer.diagnostics();
        }, view);
        await page.locator('#castle-scene-stage').screenshot({path:testInfo.outputPath(`${view.name}.png`)});
        expect(diagnostic.geometries).toBe(initial.geometries);
        expect(diagnostic.textures).toBe(initial.textures);
        views.push({view, diagnostic});
      }
      await page.evaluate(() => {
        (window as any).__castleScene.dispose();
        delete (window as any).__castleScene;
        document.getElementById('castle-scene-stage')?.remove();
      });
      expect(errors).toEqual([]);
      await writeFile(testInfo.outputPath('castle-capture.json'), JSON.stringify({
        viewport, sourceHashes, initial, views, errors,
        captureNote:'Home is the ordinary product screen. Front/near/rear reuse WorldRenderer with an inspection camera and an unadvanced Home simulation. No gameplay or flight-camera change is involved.',
      }, null, 2));
    });
  });
}
