import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json' with { type: 'json' };

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    target: 'es2021',
    // Keep output tidy; crxjs controls most of the pipeline.
    sourcemap: false,
    rollupOptions: {
      // blocked.html is a DNR redirect target, not a manifest "page", so crxjs
      // would copy it verbatim — list it explicitly so Vite bundles it.
      input: {
        blocked: 'src/blocked/blocked.html',
      },
    },
  },
});
