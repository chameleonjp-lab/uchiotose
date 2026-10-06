import { expect, test as base } from '@playwright/test';
import { createAssetManifest } from './asset-manifest.mjs';
import { guardWebSocket, isLocalAssetRequest, viteHmrDiagnosticUrl } from './network-policy';

// Install before the page exists. The exact file manifest is built from this checkout.
export const test = base.extend({
  serviceWorkers: 'block',
  context: async ({ context, baseURL }, use) => {
    if (baseURL !== 'http://127.0.0.1:4176') throw new Error('Browser acceptance requires the loopback Vite origin');
    const manifest = createAssetManifest();
    const blocked: string[] = [];
    let hmrDiagnostic: string | undefined;
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (!isLocalAssetRequest(request.url(), request.method(), request.resourceType(), manifest)) {
        blocked.push(`${request.method()} ${url.origin}${url.pathname}${url.search} (${request.resourceType()})`);
        await route.abort('blockedbyclient');
        return;
      }
      if (url.pathname === '/favicon.ico') {
        await route.fulfill({ status: 204, body: '' });
        return;
      }
      // Never let a permitted local asset redirect escape the destination policy.
      const response = await route.fetch({ maxRedirects: 0 });
      if (response.status() >= 300 && response.status() < 400) {
        blocked.push(`Redirect ${url.pathname}: ${response.status()}`);
        await route.abort('blockedbyclient');
      } else {
        if (url.pathname === '/@vite/client') hmrDiagnostic = viteHmrDiagnosticUrl(await response.text());
        await route.fulfill({ response });
      }
    });
    await context.routeWebSocket('**/*', socket => guardWebSocket(socket, hmrDiagnostic, blocked));
    try {
      await use(context);
    } finally {
      // End all pages and inert sockets before checking the final request record.
      await context.close();
      expect(blocked, 'Browser acceptance must not attempt unlisted requests or sockets').toEqual([]);
    }
  },
});

export { expect } from '@playwright/test';
