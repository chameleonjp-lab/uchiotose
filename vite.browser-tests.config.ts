import { defineConfig, mergeConfig } from 'vite';
import appConfig from './vite.config';

// Acceptance serves the real modules without dependency version/HMR cache queries.
// This makes every browser asset address an exact physical-file allowlist entry.
export default mergeConfig(appConfig, defineConfig({
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { ws: { host: '127.0.0.1', clientPort: 4176 } },
}));
