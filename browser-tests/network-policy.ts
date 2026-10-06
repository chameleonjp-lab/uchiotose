import type { WebSocketRoute } from '@playwright/test';

const LOCAL_ORIGIN = 'http://127.0.0.1:4176';
export type Asset = { physicalFile: string | null; resourceTypes: readonly string[] };
export type AssetManifest = ReadonlyMap<string, Asset>;

/** No query, guessed filename, endpoint or resource-type fallback is permitted. */
export function isLocalAssetRequest(address: string, method: string, resourceType: string, manifest: AssetManifest): boolean {
  let url: URL;
  try { url = new URL(address); } catch { return false; }
  if (address !== `${LOCAL_ORIGIN}${url.pathname}` || url.origin !== LOCAL_ORIGIN || url.username || url.password || url.search || url.hash
    || !['GET', 'HEAD'].includes(method)) return false;
  return manifest.get(url.pathname)?.resourceTypes.includes(resourceType) === true;
}

/** The only socket diagnostic exception is the exact token in the served Vite client. */
export function viteHmrDiagnosticUrl(clientSource: string): string {
  const token = clientSource.match(/^const wsToken = "([a-zA-Z0-9_-]+)";$/m)?.[1];
  if (!token) throw new Error('The served Vite client has no recognized HMR token');
  return `ws://127.0.0.1:4176/?token=${token}`;
}

export function isViteHmrDiagnostic(address: string, expectedAddress: string | undefined): boolean {
  return expectedAddress !== undefined && address === expectedAddress;
}

export const LOCAL_FIXTURE_URLS = Object.freeze({
  settings: 'http://127.0.0.1:4176/settings-ui-fixture',
  input: 'http://127.0.0.1:4176/input-probe',
});

export function isLocalFixtureRequest(fixture: keyof typeof LOCAL_FIXTURE_URLS, address: string, method: string, resourceType: string): boolean {
  return address === LOCAL_FIXTURE_URLS[fixture] && method === 'GET' && resourceType === 'document';
}

/** Keep only exact HMR diagnostics inert and local for the context lifetime. */
export function guardWebSocket(socket: Pick<WebSocketRoute, 'url' | 'close' | 'onMessage'>, expectedAddress: string | undefined, blocked: string[]): void {
  if (isViteHmrDiagnostic(socket.url(), expectedAddress)) {
    // Deliberately never connectToServer/send/close here. Consume local HMR pings
    // so Vite does not reconnect or issue tokenless vite-ping probes.
    socket.onMessage(() => {});
    return;
  }
  blocked.push(`WebSocket ${socket.url()}`);
  socket.close();
}
