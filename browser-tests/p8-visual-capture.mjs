import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { collectP8Provenance, sameP8Provenance } from './p8-provenance.mjs';

// P8 captures are deliberately separate from product tests. Run once per side:
// P8_CAPTURE_SIDE=reference P8_CAPTURE_BASE_URL=http://127.0.0.1:4177 \
//   PLAYWRIGHT_BROWSERS_PATH=/tmp/uchiotose-browsers node browser-tests/p8-visual-capture.mjs
// P8_CAPTURE_SIDE=candidate P8_CAPTURE_BASE_URL=http://127.0.0.1:4176 \
//   PLAYWRIGHT_BROWSERS_PATH=/tmp/uchiotose-browsers node browser-tests/p8-visual-capture.mjs
const side = process.env.P8_CAPTURE_SIDE ?? 'candidate';
if (!['reference', 'candidate'].includes(side)) throw new Error('P8_CAPTURE_SIDE must be reference or candidate');
const isReference = side === 'reference';
const baseURL = process.env.P8_CAPTURE_BASE_URL ?? (isReference ? 'http://127.0.0.1:4177' : 'http://127.0.0.1:4176');
const outputRoot = process.env.P8_CAPTURE_OUTPUT ?? `docs/evidence/p8-${side}`;
const provenanceAtStart = await collectP8Provenance(side);
const allViewports = [
  { width: 393, height: 648 },
  { width: 568, height: 320 },
  { width: 1280, height: 720 },
];
const viewportFilter = process.env.P8_CAPTURE_VIEWPORTS?.split(',').filter(Boolean);
const viewports = viewportFilter
  ? allViewports.filter(({ width, height }) => viewportFilter.includes(`${width}x${height}`))
  : allViewports;
if (!viewports.length || viewportFilter?.some((value) => !allViewports.some(({ width, height }) => value === `${width}x${height}`))) {
  throw new Error('P8_CAPTURE_VIEWPORTS contains an unsupported viewport');
}
const allScreens = ['home', 'normal-hud', 'easy-hud', 'pause', 'touch-settings', 'pc-key-settings', 'rules', 'result'];
const screenFilter = process.env.P8_CAPTURE_SCREENS?.split(',').filter(Boolean);
const observedScreens = screenFilter ? allScreens.filter((screen) => screenFilter.includes(screen)) : allScreens;
if (!observedScreens.length || screenFilter?.some((screen) => !allScreens.includes(screen))) {
  throw new Error('P8_CAPTURE_SCREENS contains an unsupported screen');
}
const captureAircraft = process.env.P8_CAPTURE_AIRCRAFT !== 'false';
let captureErrors = 0;
const runRecoveries = [];
const renderConditions = [];

async function chooseMode(page, mode) {
  await page.locator(`input[name="game-mode"][value="${mode}"]`).check();
}

async function waitForStart(page, navigate = false) {
  if (navigate) await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.locator('#start').waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForFunction(() => {
    const button = document.querySelector('#start');
    return button instanceof HTMLButtonElement && !button.disabled;
  }, null, { timeout: 60000 });
}

async function click(page, selector) {
  const locator = page.locator(selector);
  if (await page.evaluate(() => navigator.maxTouchPoints > 0)) await locator.tap({ timeout: 30000 });
  else await locator.click({ timeout: 30000 });
}

function summarizeTimes(values) {
  if (!values?.length) return { samples: 0, medianMs: null, p95Ms: null, maxMs: null };
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
  return { samples: sorted.length, medianMs: percentile(0.5), p95Ms: percentile(0.95), maxMs: sorted.at(-1) };
}

async function readObservation(page) {
  return page.evaluate((reference) => {
    const summarize = (values) => {
      if (!values?.length) return { samples: 0, medianMs: null, p95Ms: null, maxMs: null };
      const sorted = [...values].sort((a, b) => a - b);
      const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
      return { samples: sorted.length, medianMs: percentile(0.5), p95Ms: percentile(0.95), maxMs: sorted.at(-1) };
    };
    const app = document.querySelector('#app');
    const heap = performance.memory ? {
      usedJSHeapSize: performance.memory.usedJSHeapSize,
      totalJSHeapSize: performance.memory.totalJSHeapSize,
      jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
    } : null;
    if (reference) {
      const s = window.__kaisenReadState(false);
      return {
        phase: s.phase, mode: s.mode, selectedMode: s.selectedMode, screen: app?.getAttribute('data-screen'),
        tick: s.tick, elapsed: s.elapsed, graphicsReady: s.graphicsReady,
        renderStatus: s.renderStatus, lastInterruption: s.lastInterruption,
        renderer: s.render ? {
          queue: s.render.queue, calls: s.render.calls, triangles: s.render.triangles,
          geometries: s.render.geometries, textures: s.render.textures,
          particles: s.render.particles, planes: s.render.planes, ships: s.render.ships,
          width: s.render.width, height: s.render.height, pixelRatio: s.render.pixelRatio,
        } : null,
        audio: s.audio, frameIntervals: summarize(s.frameIntervals ?? []), heap,
      };
    }
    const s = window.__uchiotose.snapshot();
    const diagnostics = window.__uchiotose.diagnostics();
    const renderer = diagnostics.renderer;
    return {
      phase: s.mission.phase, mode: app?.getAttribute('data-mode') ?? s.mode, screen: app?.getAttribute('data-screen'),
      tick: s.mission.tick, missionId: s.mission.missionId, elapsedSeconds: s.mission.tick / 60,
      result: s.result ? { outcome: s.result.outcome, reason: s.result.reason, tick: s.result.tick, score: s.result.score } : null,
      losses: s.mission.losses,
      activeCounts: {
        aircraft: s.mission.aircraft.filter((a) => a.status === 'active').length,
        enemies: s.mission.enemies.filter((e) => e.status === 'active').length,
        ships: s.mission.ships.filter((ship) => ship.status === 'alive').length,
      },
      projectileCount: s.projectiles.length,
      renderer, audio: diagnostics.audio,
      frameIntervals: summarize(diagnostics.frameTimes ?? []), heap,
    };
  }, isReference);
}

async function collectLayout(page) {
  return page.evaluate(() => {
    const props = ['display', 'position', 'zIndex', 'overflow', 'visibility', 'fontFamily', 'fontSize', 'lineHeight', 'fontWeight', 'color', 'backgroundColor', 'borderRadius', 'padding', 'margin', 'border'];
    const selectors = [
      '#app', '#flight', '#markers', '#home', '#hud', '#hud-time', '#hud-mode', '#hud-aircraft',
      '#hud-aircraft-active', '#hud-ships', '#hud-enemies', '#hud-score', '#hud-warning',
      '.hud-top', '.time-block', '.target-tally', '#pause-screen', '#result',
      '#control-settings', '#rules-guide', '.brand-line', '.home-copy', '.briefing', '.mission-data',
      '.panel', '.settings-shell', '.settings-main', '.control-preview', '.keyboard-settings-list',
      '.rules-content', '.result-panel', '.score-breakdown',
      'h1', 'h2', 'h3', 'p', 'button:not([hidden])', 'input:not([hidden])', 'select', 'label',
    ].join(',');
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    return [...document.querySelectorAll(selectors)].flatMap((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      if (!rect.width || !rect.height || style.display === 'none' || style.visibility === 'hidden') return [];
      const text = (node.innerText || node.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 140);
      return [{
        tag: node.tagName.toLowerCase(), id: node.id || null,
        className: typeof node.className === 'string' ? node.className : null, text,
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        outsideViewport: { left: rect.left < -0.5, top: rect.top < -0.5, right: rect.right > vw + 0.5, bottom: rect.bottom > vh + 0.5 },
        scroll: { left: node.scrollLeft, top: node.scrollTop, width: node.scrollWidth, height: node.scrollHeight },
        css: Object.fromEntries(props.map((key) => [key, style[key]])),
      }];
    });
  });
}

async function openGame(page, mode, recoveryLog) {
  await waitForStart(page);
  await chooseMode(page, mode);
  await click(page, '#start');
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('data-screen') === 'playing', null, { timeout: 60000 });
  await page.waitForTimeout(900);
  const state = await readObservation(page);
  if (state.phase !== 'playing') {
    // The reference has a documented one-time SwiftShader render-stall recovery.
    // It is handled only through the ordinary enabled Resume control.
    const reason = await page.locator('#pause-reason').textContent().catch(() => '');
    if (state.phase === 'paused' && state.lastInterruption?.reason === 'stalled' && await page.locator('#resume').isEnabled()) {
      recoveryLog.push({ screen: mode === 'normal' ? 'normal gameplay start' : 'easy gameplay start', reason: 'stalled', action: 'ordinary Resume button', observedAt: new Date().toISOString() });
      await click(page, '#resume');
      await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('data-screen') === 'playing', null, { timeout: 15000 });
      await page.waitForTimeout(500);
    } else {
      throw new Error(`Expected live gameplay after Start; state=${JSON.stringify(state)} pauseReason=${reason}`);
    }
  }
}

async function recoverReferenceStall(page, screen, recoveryLog) {
  if (!isReference || !['normal-hud', 'easy-hud'].includes(screen)) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await readObservation(page);
    if (state.phase === 'playing') return;
    if (state.phase !== 'paused' || state.lastInterruption?.reason !== 'stalled' || !await page.locator('#resume').isEnabled()) return;
    recoveryLog.push({ screen, reason: 'stalled', action: 'ordinary Resume button', observedAt: new Date().toISOString() });
    await click(page, '#resume');
    await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('data-screen') === 'playing', null, { timeout: 15000 });
    await page.waitForTimeout(800);
  }
}

async function ensureHome(page) {
  if (await page.locator('#control-settings').isVisible().catch(() => false)) await click(page, '#control-cancel');
  if (await page.locator('#rules-guide').isVisible().catch(() => false)) await click(page, '#rules-close');
  const state = await page.locator('#app').getAttribute('data-screen');
  if (state === 'playing') {
    await click(page, isReference ? '#pause' : '#pause-button');
    await page.locator('#pause-screen').waitFor({ state: 'visible' });
    await click(page, isReference ? '#pause-home' : '#home-return');
  } else if (state === 'paused') {
    await click(page, isReference ? '#pause-home' : '#home-return');
  } else if (state === 'result') {
    await click(page, '#result-home');
  }
  await page.locator('#home').waitFor({ state: 'visible', timeout: 30000 });
}

async function showScreen(page, screen, recoveryLog) {
  if (!await page.locator('#app').count()) await waitForStart(page, true);
  if (screen === 'home') {
    await ensureHome(page);
    await waitForStart(page);
    await chooseMode(page, 'easy');
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  } else if (screen === 'touch-settings' || screen === 'pc-key-settings') {
    await ensureHome(page);
    await waitForStart(page);
    await chooseMode(page, 'normal');
    await click(page, isReference ? '#home-controls' : '#home-settings');
    await page.locator('#control-settings').waitFor({ state: 'visible' });
    await click(page, '#control-editor-touch');
    await page.locator('#control-mode').selectOption('normal');
    await page.locator('#control-target').selectOption('fire');
    if (screen === 'touch-settings') {
      await page.locator('.control-preview').scrollIntoViewIfNeeded();
    }
    else await click(page, '#control-editor-keyboard');
    await page.waitForTimeout(200);
  } else if (screen === 'rules') {
    await ensureHome(page);
    await waitForStart(page);
    await click(page, '#home-rules');
    await page.locator('#rules-guide').waitFor({ state: 'visible' });
    await page.locator('#rules-content').evaluate((node) => { node.scrollTop = 0; });
    await page.waitForTimeout(150);
  } else if (screen === 'normal-hud') {
    await ensureHome(page);
    await openGame(page, 'normal', recoveryLog);
  } else if (screen === 'easy-hud') {
    await ensureHome(page);
    await openGame(page, 'easy', recoveryLog);
  } else if (screen === 'pause') {
    await ensureHome(page);
    await openGame(page, 'normal', recoveryLog);
    await click(page, isReference ? '#pause' : '#pause-button');
    await page.locator('#pause-screen').waitFor({ state: 'visible' });
    await page.locator('#resume').focus();
  } else if (screen === 'result') {
    await ensureHome(page);
    if (isReference) {
      await openGame(page, 'normal', recoveryLog);
      const deadline = Date.now() + 60000;
      let holding = false;
      try {
        while (!await page.locator('#result').isVisible() && Date.now() < deadline) {
          if (!holding) { await page.keyboard.down('ArrowDown'); holding = true; }
          await page.waitForTimeout(300);
          const state = await readObservation(page);
          if (state.phase === 'paused' && state.lastInterruption?.reason === 'stalled' && await page.locator('#resume').isEnabled()) {
            if (holding) { await page.keyboard.up('ArrowDown'); holding = false; }
            recoveryLog.push({ screen: 'result', reason: 'stalled', action: 'released ArrowDown and clicked ordinary Resume before continuing', observedAt: new Date().toISOString() });
            await click(page, '#resume');
            await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('data-screen') === 'playing', null, { timeout: 15000 });
            await page.waitForTimeout(500);
          }
        }
        if (!await page.locator('#result').isVisible()) throw new Error('Reference ArrowDown sea-impact Result did not appear within 60 seconds');
      } finally {
        if (holding) await page.keyboard.up('ArrowDown');
      }
    } else {
      await waitForStart(page);
      await chooseMode(page, 'normal');
      await page.evaluate(async () => {
        const simulation = await import('/src/simulation.ts');
        let fixture = simulation.createSimulation({ missionId: 'p8-visual-result-fixture', seed: 81, phase: 'playing', mode: 'normal' });
        fixture.mission.ships[0].hp = 0;
        for (let i = 0; i < 1000 && !fixture.result; i++) {
          for (const enemy of fixture.mission.enemies) if (enemy.status === 'active') enemy.hp = 0;
          fixture = simulation.stepSimulation(fixture, { turn: 0, climb: 0, fire: false, loop: false }, 'normal');
        }
        if (!fixture.result) throw new Error('Result screenshot fixture did not reach a terminal state');
        window.__uchiotose.setStateForTest(fixture);
      });
      await page.locator('#result').waitFor({ state: 'visible' });
    }
  }
  await recoverReferenceStall(page, screen, recoveryLog);
  await page.waitForTimeout(150);
  const actual = await page.locator('#app').getAttribute('data-screen');
  const expected = {
    home: 'home', 'normal-hud': 'playing', 'easy-hud': 'playing', pause: 'paused',
    'touch-settings': 'home', 'pc-key-settings': 'home', rules: 'home', result: 'result',
  }[screen];
  if (actual !== expected) throw new Error(`${screen}: expected app screen=${expected}, got ${actual}`);
}

async function captureAircraftCamera(page, viewport) {
  const pathBase = join(outputRoot, `${viewport.width}x${viewport.height}`, 'aircraft-camera');
  const result = await page.evaluate(async ({ reference, width, height }) => {
    const threeURL = performance.getEntriesByType('resource').map((entry) => entry.name)
      .find((url) => url.includes('/node_modules/.vite/deps/three.js'));
    if (!threeURL) throw new Error('Vite optimized Three.js module URL was not observed');
    const THREE = await import(threeURL);
    const [{ AircraftFactory }, { AircraftBatchFactory }, flightView, gunSight] = await Promise.all([
      import('/src/aircraft.ts'), import('/src/aircraft-batch.ts'), import('/src/flight-view.ts'), import('/src/gun-sight.ts'),
    ]);
    const stage = document.createElement('div');
    stage.id = 'p8-aircraft-camera-stage';
    Object.assign(stage.style, { position: 'fixed', inset: '0', width: '100vw', height: '100dvh', zIndex: '2147483647', overflow: 'hidden', background: '#aecbd0' });
    const canvas = document.createElement('canvas'); canvas.id = 'p8-aircraft-camera-canvas';
    const overlay = document.createElement('canvas'); overlay.id = 'p8-aircraft-camera-reticle';
    for (const layer of [canvas, overlay]) Object.assign(layer.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
    stage.append(canvas, overlay); document.body.append(stage);
    const factory = new AircraftFactory();
    const batches = new AircraftBatchFactory();
    const visual = batches.optimize(factory.create('hero'), 'hero');
    visual.root.position.set(0, 220, 240); visual.root.quaternion.identity();
    visual.propeller.rotation.z = 0;
    visual.ailerons[0].rotation.x = 0; visual.ailerons[1].rotation.x = 0; visual.elevator.rotation.x = 0;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xaecbd0);
    scene.fog = new THREE.Fog(0xaecbd0, 1400, 6000);
    scene.add(new THREE.HemisphereLight(0xc6e5ec, 0x23424e, 2.3));
    const sun = new THREE.DirectionalLight(0xffe9b5, 3.1); sun.position.set(-600, 700, -350); scene.add(sun);
    scene.add(visual.root);
    const camera = new THREE.PerspectiveCamera(flightView.FLIGHT_FOV, width / height, 0.5, 22000);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(width, height, false); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
    overlay.width = width; overlay.height = height;
    const canonicalPose = { position: { x: 0, y: 220, z: 240 }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, yaw: 0, pitch: 0, bank: 0, speed: 110, loopProgress: 0, loopCooldown: 0 };
    const player = reference
      ? { ...canonicalPose, position: new THREE.Vector3(0, 220, 240), quaternion: new THREE.Quaternion(0, 0, 0, 1) }
      : canonicalPose;
    const cameraModes = {};
    const captured = [];
    await renderer.compileAsync(scene, camera);
    for (const mode of ['easy', 'normal']) {
      if (reference) {
        const position = new THREE.Vector3(), rotation = new THREE.Quaternion();
        flightView.getFlightCameraPose(player, mode, position, rotation);
        camera.position.copy(position); camera.quaternion.copy(rotation);
      } else {
        const pose = flightView.getFlightCameraPose(player, mode);
        camera.position.set(pose.position.x, pose.position.y, pose.position.z);
        camera.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
      }
      camera.updateMatrixWorld(); renderer.render(scene, camera);
      const sight = reference ? gunSight.projectGunSight(player, [], width, height) : gunSight.projectGunSight(player, width, height);
      const radius = mode === 'normal' ? Math.max(26, Math.min(38, Math.min(width, height) * 0.085)) : Math.min(width, height) * 0.135;
      const ctx = overlay.getContext('2d');
      ctx.clearRect(0, 0, width, height); ctx.strokeStyle = 'rgba(3,25,39,.65)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(mode === 'easy' ? width / 2 : sight.x, mode === 'easy' ? height / 2 : sight.y, radius, 0, Math.PI * 2);
      if (mode === 'normal') {
        ctx.moveTo(sight.x - radius - 6, sight.y); ctx.lineTo(sight.x - radius + 5, sight.y);
        ctx.moveTo(sight.x + radius - 5, sight.y); ctx.lineTo(sight.x + radius + 6, sight.y);
        ctx.moveTo(sight.x, sight.y - radius - 6); ctx.lineTo(sight.x, sight.y - radius + 6);
        ctx.moveTo(sight.x, sight.y + radius - 6); ctx.lineTo(sight.x, sight.y + radius + 6);
      }
      ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(mode === 'easy' ? width / 2 : sight.x, mode === 'easy' ? height / 2 : sight.y, radius, 0, Math.PI * 2);
      if (mode === 'normal') {
        ctx.moveTo(sight.x - radius - 6, sight.y); ctx.lineTo(sight.x - radius + 5, sight.y);
        ctx.moveTo(sight.x + radius - 5, sight.y); ctx.lineTo(sight.x + radius + 6, sight.y);
        ctx.moveTo(sight.x, sight.y - radius - 6); ctx.lineTo(sight.x, sight.y - radius + 6);
        ctx.moveTo(sight.x, sight.y + radius - 6); ctx.lineTo(sight.x, sight.y + radius + 6);
      }
      ctx.stroke(); ctx.fillStyle = '#fff'; ctx.fillRect((mode === 'easy' ? width / 2 : sight.x) - 1, (mode === 'easy' ? height / 2 : sight.y) - 1, 2, 2);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const p = camera.position, q = camera.quaternion;
      cameraModes[mode] = {
        fovDegrees: camera.fov, aspect: camera.aspect, near: camera.near, far: camera.far,
        position: { x: p.x, y: p.y, z: p.z }, quaternion: { x: q.x, y: q.y, z: q.z, w: q.w },
        reticle: { x: mode === 'easy' ? width / 2 : sight.x, y: mode === 'easy' ? height / 2 : sight.y, radius, depthM: mode === 'normal' ? sight.depth : null },
      };
      const composed = document.createElement('canvas'); composed.width = width; composed.height = height;
      const compositeContext = composed.getContext('2d'); compositeContext.drawImage(canvas, 0, 0); compositeContext.drawImage(overlay, 0, 0);
      captured.push({ mode, canvas: composed.toDataURL('image/png') });
    }
    const stats = { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, triangles: renderer.info.render.triangles, calls: renderer.info.render.calls };
    batches.dispose(); factory.dispose(); renderer.dispose(); stage.remove();
    return { cameraModes, stats, canonicalPose: { position: canonicalPose.position, quaternion: canonicalPose.quaternion, altitudeM: 220, speedMps: 110, bankRad: 0, propellerAngleRad: 0 }, captured };
  }, { reference: isReference, width: viewport.width, height: viewport.height });
  const { captured, ...cameraResult } = result;
  await mkdir(dirname(`${pathBase}.png`), { recursive: true });
  for (const image of captured) {
    const path = `${pathBase}-${image.mode}.png`;
    const base64 = image.canvas.split(',')[1];
    await writeFile(path, Buffer.from(base64, 'base64'));
  }
  const metadata = {
    side, source: baseURL, viewport, deviceScaleFactor: 1, provenance: provenanceAtStart,
    capturedAt: new Date().toISOString(),
    capturePath: 'Isolated source AircraftFactory hero model and source AircraftBatchFactory, matching neutral product lights, fixed player pose/speed/altitude, and production mode-specific camera helper. Does not replace the actual product-flight screenshots.',
    factory: 'src/aircraft.ts create("hero") + src/aircraft-batch.ts optimize("hero")',
    lighting: { background: '#aecbd0', fog: { color: '#aecbd0', near: 1400, far: 6000 }, hemisphereSky: '#c6e5ec', hemisphereGround: '#23424e', hemisphereIntensity: 2.3, sun: '#ffe9b5', sunIntensity: 3.1, sunPosition: [-600, 700, -350], toneMapping: 'ACESFilmicToneMapping', exposure: 1.1, pixelRatio: 1 },
    ...cameraResult,
  };
  await writeFile(`${pathBase}.json`, `${JSON.stringify(metadata, null, 2)}\n`);
  process.stdout.write(`${side} ${viewport.width}x${viewport.height} aircraft camera: ${pathBase}-easy.png, ${pathBase}-normal.png\n`);
}

async function capture(page, viewport, screen) {
  const mobile = viewport.width <= 568;
  const errors = [];
  const recoveryLog = [];
  const onPageError = (error) => errors.push(error.message);
  const onConsole = (message) => { if (message.type() === 'error') errors.push(message.text()); };
  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  try {
    await showScreen(page, screen, recoveryLog);
    const path = join(outputRoot, `${viewport.width}x${viewport.height}`, `${screen}.png`);
    const metadata = {
      side, source: baseURL, screen, viewport, deviceScaleFactor: 1,
      provenance: provenanceAtStart,
      stalledFrameRecoveries: recoveryLog,
      inputEmulation: mobile ? 'touch emulation' : 'mouse/keyboard',
      title: await page.title(), capturedAt: new Date().toISOString(),
      capturePath: screen === 'result' && isReference ? 'ordinary ArrowDown held to natural sea-impact defeat' : screen === 'result' ? 'synthetic pure-simulation result injected through DEV-only test API; not normal play' : 'ordinary DOM/UI flow',
      appScreen: await page.locator('#app').getAttribute('data-screen'),
      appMode: await page.locator('#app').getAttribute('data-mode'),
      focusedElement: await page.evaluate(() => ({ tag: document.activeElement?.tagName.toLowerCase(), id: document.activeElement?.id || null, text: (document.activeElement?.textContent || '').trim().slice(0, 100) })),
      scroll: await page.evaluate(() => ({ x: scrollX, y: scrollY, bodyWidth: document.body.scrollWidth, bodyHeight: document.body.scrollHeight, viewportWidth: innerWidth, viewportHeight: innerHeight })),
      observation: await readObservation(page),
      settingsComparison: await page.evaluate(() => {
        const app = document.querySelector('#app')?.getBoundingClientRect();
        const preview = document.querySelector('#control-preview');
        const previewRect = preview?.getBoundingClientRect();
        const controls = [...(preview?.querySelectorAll('.preview-control') ?? [])];
        return preview ? {
          adjustmentMode: document.querySelector('#control-mode')?.value ?? null,
          selectedControl: document.querySelector('#control-target')?.value ?? null,
          previewScale: app?.width && previewRect?.width ? previewRect.width / app.width : null,
          previewBounds: previewRect ? { x: previewRect.x, y: previewRect.y, width: previewRect.width, height: previewRect.height } : null,
          visibleControls: controls.filter((node) => !node.hidden).map((node) => {
            const rect = node.getBoundingClientRect();
            return { control: node.getAttribute('data-control'), label: node.textContent?.trim(), bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
          }),
        } : null;
      }),
      errors,
      layout: await collectLayout(page),
    };
    if (metadata.observation.renderer) renderConditions.push({
      viewport, screen, rendererBackend: metadata.observation.renderer.rendererBackend ?? null,
      softwareRenderer: metadata.observation.renderer.softwareRenderer ?? null,
      pixelRatio: metadata.observation.renderer.pixelRatio ?? null,
    });
    if (recoveryLog.length) runRecoveries.push(...recoveryLog.map((entry) => ({ viewport, ...entry })));
    await mkdir(dirname(path), { recursive: true });
    await page.screenshot({ path, animations: 'disabled', caret: 'hide' });
    await writeFile(path.replace(/\.png$/, '.json'), `${JSON.stringify(metadata, null, 2)}\n`);
    if (errors.length) captureErrors += errors.length;
    process.stdout.write(`${side} ${viewport.width}x${viewport.height} ${screen}: ${path}${errors.length ? ` (browser errors: ${errors.join(' | ')})` : ''}\n`);
  } finally {
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
  }
}

let captureFailure = null;
try {
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    for (const viewport of viewports) {
      const mobile = viewport.width <= 568;
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, colorScheme: 'dark' });
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      try {
        for (const screen of observedScreens) await capture(page, viewport, screen);
        if (captureAircraft) await captureAircraftCamera(page, viewport);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
} catch (error) {
  captureFailure = String(error);
}
const provenanceAtEnd = await collectP8Provenance(side);
const sourceUnchanged = sameP8Provenance(provenanceAtStart, provenanceAtEnd);
await mkdir(outputRoot, { recursive: true });
await writeFile(join(outputRoot, 'run-provenance.json'), `${JSON.stringify({
  side, source: baseURL, startedAtProvenance: provenanceAtStart,
  endedAtProvenance: provenanceAtEnd, sourceUnchanged, captureFailure, browserErrorCount: captureErrors,
  viewports, screens: observedScreens, captureAircraft, stalledFrameRecoveries: runRecoveries, renderConditions,
}, null, 2)}\n`);
if (!sourceUnchanged) throw new Error('P8 source changed during capture; review run-provenance.json and repeat after source freeze');
if (captureFailure) throw new Error(`P8 capture failed: ${captureFailure}`);
if (captureErrors) process.exitCode = 1;
