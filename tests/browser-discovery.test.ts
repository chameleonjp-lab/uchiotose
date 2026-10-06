import assert from 'node:assert/strict';
import test from 'node:test';
import { requireBrowserDiscovery } from '../scripts/check-browser-discovery.mjs';

const runnable = (projectName: string, expectedStatus = 'passed') => ({ projectName, expectedStatus, status: 'skipped' });
const report = (tests: ReturnType<typeof runnable>[]) => ({
  config: { projects: [{ name: 'webkit-ui' }, { name: 'chromium' }] },
  suites: [{ suites: [{ specs: [{ tests }] }] }],
  errors: [],
});

test('discovery requires runnable declarations from each required project, including nested suites', () => {
  assert.deepEqual(requireBrowserDiscovery(report([runnable('webkit-ui'), runnable('chromium'), runnable('chromium')])), {
    'webkit-ui': 1, chromium: 2,
  });
});

test('Chromium discoveries cannot hide an empty WebKit project', () => {
  assert.throws(() => requireBrowserDiscovery(report([runnable('chromium')])), /no runnable tests: webkit-ui/);
});

test('WebKit discoveries cannot hide an empty Chromium project', () => {
  assert.throws(() => requireBrowserDiscovery(report([runnable('webkit-ui')])), /no runnable tests: chromium/);
});

test('a missing required project fails even if its tests appear in a stale report', () => {
  const input = report([runnable('webkit-ui'), runnable('chromium')]);
  input.config.projects = [{ name: 'chromium' }];
  assert.throws(() => requireBrowserDiscovery(input), /project is missing: webkit-ui/);
});

test('skipped and expected-failure declarations do not satisfy required discovery', () => {
  for (const status of ['skipped', 'failed']) {
    assert.throws(() => requireBrowserDiscovery(report([runnable('webkit-ui', status), runnable('chromium')])), /no runnable tests: webkit-ui/);
  }
});

test('unknown projects do not satisfy the required projects', () => {
  assert.throws(() => requireBrowserDiscovery(report([runnable('firefox'), runnable('chromium')])), /no runnable tests: webkit-ui/);
});

test('discovery errors fail closed even if tests were partially discovered', () => {
  const input = { ...report([runnable('webkit-ui'), runnable('chromium')]), errors: [{ message: 'Unable to load a spec' }] };
  assert.throws(() => requireBrowserDiscovery(input), /reported errors/);
});

test('invalid discovery reports fail closed', () => {
  for (const input of [null, {}, { config: { projects: [] } }]) {
    assert.throws(() => requireBrowserDiscovery(input), /Invalid Playwright/);
  }
});
