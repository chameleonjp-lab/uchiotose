import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { collectP8Provenance, sameP8Provenance } from './p8-provenance.mjs';

// Ten real wall-clock minutes through the ordinary, no-input Easy product flow.
// It records the natural Result tick separately from time spent on Result. It is
// desktop Chromium + SwiftShader evidence, never a physical iPhone claim.
const baseURL = process.env.P8_CAPTURE_BASE_URL ?? 'http://127.0.0.1:4176';
const output = process.env.P8_SESSION_OUTPUT ?? 'docs/evidence/p8-browser-session.json';
const provenanceAtStart = await collectP8Provenance('candidate');
const durationMs = Number(process.env.P8_SESSION_DURATION_MS ?? 10 * 60 * 1000);
const sampleMs = Number(process.env.P8_SESSION_SAMPLE_MS ?? 60 * 1000);
const startedAt = Date.now();
const record = {
  status: 'running',
  source: baseURL,
  provenance: { started: provenanceAtStart, ended: null, sourceUnchanged: null },
  environment: {
    browser: null,
    viewport: { width: 393, height: 648 },
    deviceScaleFactor: 1,
    emulation: 'Chromium mobile/touch emulation on desktop Linux; SwiftShader software renderer',
    sound: 'enabled by ordinary Home button before Start; playback state recorded',
  },
  scenario: 'Normal product route: click Home sound on, start Easy, provide no flight inputs, leave page foregrounded for ten wall-clock minutes. Natural mission Result ends active ticks; Result dwell is reported separately.',
  startedAt: new Date(startedAt).toISOString(),
  plannedWallSeconds: durationMs / 1000,
  samples: [],
  resultObserved: null,
  errors: [],
};

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
}

async function readSample(page, cdp, markMs, wallMs) {
  const app = await page.evaluate(() => {
    const api = window.__uchiotose;
    const state = api.snapshot();
    const diagnostics = api.diagnostics();
    const projectileCounts = { aircraft: 0, magic: 0, antiAir: 0 };
    for (const projectile of state.projectiles) {
      if (projectile.kind === 'fire' || projectile.kind === 'ice') projectileCounts.magic += 1;
      else if (projectile.kind === 'anti-air') projectileCounts.antiAir += 1;
      else projectileCounts.aircraft += 1;
    }
    const burns = state.mission.aircraft.reduce((n, a) => n + a.burns.length, 0)
      + state.mission.ships.reduce((n, ship) => n + ship.burns.length, 0);
    const memory = performance.memory ? {
      usedJSHeapBytes: performance.memory.usedJSHeapSize,
      totalJSHeapBytes: performance.memory.totalJSHeapSize,
      heapLimitBytes: performance.memory.jsHeapSizeLimit,
    } : null;
    const frameTimes = diagnostics.frameTimes;
    const sortedTimes = [...frameTimes].sort((a, b) => a - b);
    const p95 = sortedTimes.length ? sortedTimes[Math.min(sortedTimes.length - 1, Math.ceil(sortedTimes.length * 0.95) - 1)] : null;
    return {
      appScreen: document.querySelector('#app')?.getAttribute('data-screen') ?? null,
      soundPressed: document.querySelector('#home-sound')?.getAttribute('aria-pressed') ?? null,
      mission: {
        phase: state.mission.phase, tick: state.mission.tick, elapsedSeconds: state.mission.tick / 60,
        missionId: state.mission.missionId, outcome: state.result?.outcome ?? null,
        resultReason: state.result?.reason ?? null, resultTick: state.result?.tick ?? null,
        resultElapsedSeconds: state.result?.elapsedSeconds ?? null, losses: state.mission.losses,
        activeAircraft: state.mission.aircraft.filter((a) => a.status === 'active').length,
        pendingAircraft: state.mission.aircraft.filter((a) => a.status === 'pending').length,
        activeEnemies: state.mission.enemies.filter((e) => e.status === 'active').length,
        pendingEnemies: state.mission.enemies.filter((e) => e.status === 'pending').length,
        aliveShips: state.mission.ships.filter((ship) => ship.status === 'alive').length,
      },
      projectiles: {
        ...projectileCounts, total: state.projectiles.length,
        capacities: state.poolCapacities,
      },
      effects: { burns, events: state.events.length, scoreEntries: Object.keys(state.score.enemies).length },
      logicalMetrics: state.metrics,
      renderer: diagnostics.renderer,
      audio: diagnostics.audio,
      frames: { samples: frameTimes.length, p95FrameIntervalMs: p95, maximumIntervalMs: frameTimes.length ? Math.max(...frameTimes) : null },
      heap: memory,
      visibility: document.visibilityState,
    };
  });
  let browserMemory = null;
  if (cdp) {
    try {
      const [counters, performance] = await Promise.all([
        cdp.send('Memory.getDOMCounters'),
        cdp.send('Performance.getMetrics'),
      ]);
      let eventListeners;
      try {
        const listeners = await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const targets = [window, document, ...document.querySelectorAll('*')];
            const byType = {}; let total = 0;
            for (const target of targets) for (const [type, entries] of Object.entries(getEventListeners(target))) {
              total += entries.length; byType[type] = (byType[type] ?? 0) + entries.length;
            }
            return { targets: targets.length, total, byType };
          })()`,
          returnByValue: true,
          includeCommandLineAPI: true,
        });
        eventListeners = listeners.result?.value ?? null;
      } catch (error) {
        eventListeners = { unavailable: String(error) };
      }
      browserMemory = {
        domCounters: counters,
        performanceMetrics: Object.fromEntries((performance.metrics ?? []).map(({ name, value }) => [name, value])),
        eventListeners,
      };
    } catch (error) {
      browserMemory = { unavailable: String(error) };
    }
  }
  return { elapsedWallSeconds: wallMs / 1000, sample: markMs + 1, app, browserMemory };
}

async function save() {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(record, null, 2)}\n`);
}

let browser;
let context;
let page;
let cdp;
try {
  browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  record.environment.browser = `${browser.browserType().name()} ${browser.version()}`;
  context = await browser.newContext({ viewport: record.environment.viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.on('pageerror', (error) => record.errors.push({ at: new Date().toISOString(), kind: 'pageerror', message: error.message }));
  page.on('console', (message) => { if (message.type() === 'error') record.errors.push({ at: new Date().toISOString(), kind: 'console', message: message.text() }); });
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__uchiotose), null, { timeout: 30000 });
  await page.waitForFunction(() => {
    const start = document.querySelector('#start');
    return start instanceof HTMLButtonElement && !start.disabled;
  }, null, { timeout: 60000 });
  await page.locator('#home-sound').tap();
  await page.locator('input[name="game-mode"][value="easy"]').check();
  await page.locator('#start').tap();
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('data-screen') === 'playing', null, { timeout: 15000 });
  await page.waitForTimeout(500);
  try {
    cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
  } catch { cdp = null; }

  const initial = await readSample(page, cdp, 0, Date.now() - startedAt);
  record.samples.push({ checkpoint: 'start', ...initial });
  await save();
  process.stdout.write(`P8 browser session started: ${JSON.stringify({ browser: record.environment.browser, sample: initial.app.mission, renderer: initial.app.renderer, audio: initial.app.audio })}\n`);

  let mark = sampleMs;
  while (mark <= durationMs) {
    while (Date.now() < startedAt + mark) {
      await page.waitForTimeout(Math.min(1000, Math.max(0, startedAt + mark - Date.now())));
      if (!record.resultObserved) {
        const terminal = await page.evaluate(() => {
          const mission = window.__uchiotose.snapshot();
          return mission.result ? { tick: mission.result.tick, outcome: mission.result.outcome, reason: mission.result.reason } : null;
        });
        if (terminal) {
          record.resultObserved = {
            approximateWallSeconds: (Date.now() - startedAt) / 1000,
            pollingIntervalMs: 1000,
            ...terminal,
          };
          await save();
        }
      }
    }
    const observation = await readSample(page, cdp, mark, Date.now() - startedAt);
    record.samples.push({ checkpoint: `${mark / 1000}s`, ...observation });
    await save();
    process.stdout.write(`P8 browser ${mark / 1000}s: ${JSON.stringify({ wall: observation.elapsedWallSeconds, mission: observation.app.mission, renderer: observation.app.renderer, audio: observation.app.audio, heap: observation.app.heap, browserMemory: observation.browserMemory })}\n`);
    mark += sampleMs;
  }
  const provenanceAtEnd = await collectP8Provenance('candidate');
  record.provenance.ended = provenanceAtEnd;
  record.provenance.sourceUnchanged = sameP8Provenance(provenanceAtStart, provenanceAtEnd);
  if (!record.provenance.sourceUnchanged) throw new Error('P8 source changed during the browser session');
  record.status = 'completed';
  record.finishedAt = new Date().toISOString();
  record.actualWallSeconds = (Date.now() - startedAt) / 1000;
  record.resultTick = record.samples.at(-1)?.app?.mission?.resultTick ?? null;
  record.activeSimulationSeconds = record.samples.at(-1)?.app?.mission?.elapsedSeconds ?? null;
  record.activeWallToResultSeconds = record.resultObserved?.approximateWallSeconds ?? null;
  record.limitation = 'No physical iPhone or mobile GPU was available. SwiftShader, Playwright touch emulation, JS heap/DOM listener diagnostics, and wall-clock sampling do not qualify as real-device or Safari performance evidence.';
  await save();
} catch (error) {
  if (!record.provenance.ended) {
    record.provenance.ended = await collectP8Provenance('candidate').catch(() => null);
    record.provenance.sourceUnchanged = record.provenance.ended
      ? sameP8Provenance(provenanceAtStart, record.provenance.ended)
      : false;
  }
  record.status = 'failed';
  record.finishedAt = new Date().toISOString();
  record.failure = String(error);
  record.actualWallSeconds = (Date.now() - startedAt) / 1000;
  await save();
  throw error;
} finally {
  if (cdp) await cdp.detach().catch(() => {});
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
}
