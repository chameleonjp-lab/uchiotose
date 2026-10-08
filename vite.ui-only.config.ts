import { defineConfig, mergeConfig } from 'vite';
import browserConfig from './vite.browser-tests.config';

// Use the real product DOM, replacing only its bootstrap for this local server.
// No production config imports this config or the fixture entry.
export default mergeConfig(browserConfig, defineConfig({
  mode: 'ui-only',
  plugins: [{
    name: 'ui-only-product-entry',
    transformIndexHtml(html) {
      const entry = '<script type="module" src="/src/main.ts"></script>';
      if (html.split(entry).length !== 2) throw new Error('Expected exactly one product entry');
      return html.replace(entry, '<script type="module" src="/browser-tests/ui-fixture.ts"></script>');
    },
  }],
}));
