import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createAssetManifest } from '../browser-tests/asset-manifest.mjs';
import { guardWebSocket, isLocalAssetRequest, isLocalFixtureRequest, isViteHmrDiagnostic, LOCAL_FIXTURE_URLS, viteHmrDiagnosticUrl } from '../browser-tests/network-policy';

const assets = new Map([
  ['/', { physicalFile: '/repo/index.html', resourceTypes: ['document'] }],
  ['/src/main.ts', { physicalFile: '/repo/src/main.ts', resourceTypes: ['script'] }],
  ['/src/style.css', { physicalFile: '/repo/src/style.css', resourceTypes: ['script', 'stylesheet'] }],
]);

test('acceptance permits only registered physical assets with their intended resource types', () => {
  for (const method of ['GET', 'HEAD']) {
    assert.equal(isLocalAssetRequest('http://127.0.0.1:4176/', method, 'document', assets), true);
    assert.equal(isLocalAssetRequest('http://127.0.0.1:4176/src/main.ts', method, 'script', assets), true);
    assert.equal(isLocalAssetRequest('http://127.0.0.1:4176/src/style.css', method, 'stylesheet', assets), true);
  }
});

test('same-origin writes, unknown APIs and plausible but nonexistent filenames fail', () => {
  for (const path of ['/ranking', '/api/submit', '/src/does-not-exist.ts', '/src/fake.css', '/@fs/etc/passwd', '/node_modules/.vite/deps/arbitrary.js']) {
    assert.equal(isLocalAssetRequest(`http://127.0.0.1:4176${path}`, 'GET', 'script', assets), false, path);
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'CONNECT']) assert.equal(isLocalAssetRequest('http://127.0.0.1:4176/', method, 'document', assets), false, method);
});

test('queries and inappropriate fetch/navigation resource types fail even on known assets', () => {
  for (const query of ['?', '?submit=score', '?v=12345678', '?t=1', '?direct', '?token=secret', '?a=1&a=2', '#fragment']) {
    assert.equal(isLocalAssetRequest(`http://127.0.0.1:4176/src/main.ts${query}`, 'GET', 'script', assets), false, query);
  }
  for (const type of ['fetch', 'xhr', 'document', 'image', 'websocket', 'other']) {
    assert.equal(isLocalAssetRequest('http://127.0.0.1:4176/src/main.ts', 'GET', type, assets), false, type);
  }
});

test('external origins, alternative ports and embedded credentials fail', () => {
  for (const url of ['https://example.com/', 'http://localhost:4176/', 'http://127.0.0.1:4177/', 'http://user:secret@127.0.0.1:4176/', 'invalid']) {
    assert.equal(isLocalAssetRequest(url, 'GET', 'document', assets), false, url);
  }
});

test('only the served Vite client token gives an exact, inert HMR diagnostic exception', () => {
  const expected = viteHmrDiagnosticUrl('const wsToken = "known-token_123";');
  assert.equal(isViteHmrDiagnostic(expected, expected), true);
  for (const address of ['ws://127.0.0.1:4176/', 'ws://127.0.0.1:4176/api/submit', 'ws://127.0.0.1:4176/?token=other', `${expected}&submit=score`, 'ws://localhost:4176/?token=known-token_123', 'wss://example.com/?token=known-token_123']) {
    assert.equal(isViteHmrDiagnostic(address, expected), false, address);
  }
  assert.equal(isViteHmrDiagnostic(expected, undefined), false);
  assert.throws(() => viteHmrDiagnosticUrl('const wsToken = unavailable;'), /no recognized HMR token/);
});

test('the real manifest contains production settings and exact installed dependencies only', () => {
  const manifest = createAssetManifest();
  assert.ok(manifest.get('/src/control-settings.ts')?.physicalFile.endsWith('/src/control-settings.ts'));
  assert.ok([...manifest.values()].some(asset => asset.physicalFile?.endsWith('/three/build/three.module.js')));
  assert.ok([...manifest.values()].some(asset => asset.physicalFile?.endsWith('/vite/dist/client/env.mjs')));
  assert.equal(manifest.has('/src/nonexistent.ts'), false);
  assert.equal(manifest.has('/api/submit'), false);
});

test('page-level fixtures only accept exact local GET document requests', () => {
  for (const fixture of ['settings', 'input'] as const) {
    const url = LOCAL_FIXTURE_URLS[fixture];
    assert.equal(isLocalFixtureRequest(fixture, url, 'GET', 'document'), true);
    for (const method of ['POST', 'HEAD', 'PUT']) assert.equal(isLocalFixtureRequest(fixture, url, method, 'document'), false);
    for (const type of ['fetch', 'xhr', 'script', 'image']) assert.equal(isLocalFixtureRequest(fixture, url, 'GET', type), false);
    for (const address of [url.replace('127.0.0.1:4176', 'example.com'), `${url}?submit=score`, `${url}/extra`]) {
      assert.equal(isLocalFixtureRequest(fixture, address, 'GET', 'document'), false);
    }
  }
});

test('both real fixture registrations use the exact matcher and fallback guard', () => {
  for (const [file, fixture] of [['mobile-settings-ui.spec.ts', 'settings'], ['input-recovery.spec.ts', 'input']]) {
    const source = readFileSync(new URL(`../browser-tests/${file}`, import.meta.url), 'utf8');
    assert.ok(source.includes(`page.route(LOCAL_FIXTURE_URLS.${fixture}, async route => {`));
    assert.ok(source.includes(`if (!isLocalFixtureRequest('${fixture}', request.url(), request.method(), request.resourceType())) {\n      await route.fallback();\n      return;`));
  }
});

test('exact HMR route stays inert without close, upstream connection or forwarding', () => {
  const events: string[] = [];
  const messages: Array<(message: unknown) => void> = [];
  const url = 'ws://127.0.0.1:4176/?token=known-token';
  const socket = {
    url: () => url,
    close: () => events.push('close'),
    connectToServer: () => events.push('connect'),
    send: () => events.push('send'),
    onMessage: (handler: (message: unknown) => void) => { messages.push(handler); },
  };
  const blocked: string[] = [];
  guardWebSocket(socket, url, blocked);
  assert.equal(messages.length, 1);
  messages[0]('{"type":"ping"}');
  assert.deepEqual(events, []);
  assert.deepEqual(blocked, []);
});

test('unknown socket records failure and closes without connecting or forwarding', () => {
  const events: string[] = [];
  const socket = {
    url: () => 'ws://127.0.0.1:4176/api/submit',
    close: () => events.push('close'),
    connectToServer: () => events.push('connect'),
    send: () => events.push('send'),
    onMessage: () => { events.push('listen'); },
  };
  const blocked: string[] = [];
  guardWebSocket(socket, 'ws://127.0.0.1:4176/?token=known-token', blocked);
  assert.deepEqual(events, ['close']);
  assert.deepEqual(blocked, ['WebSocket ws://127.0.0.1:4176/api/submit']);
});
