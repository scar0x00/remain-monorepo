import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The app is zoneless and does not depend on zone.js. pnpm still installs zone.js because
// ngx-markdown lists it as a peer, which makes the Angular test builder emit a guarded
// `import('zone.js/testing')`. Point that import at an empty module so Vite can resolve it.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^zone\.js\/testing$/,
        replacement: fileURLToPath(new URL('./src/testing/no-zone.ts', import.meta.url)),
      },
    ],
  },
});
