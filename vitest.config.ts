import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Mirror the tsconfig `@hyper/*` path alias for the vitest/vite resolver, so
// the Hyper service code (which imports `@hyper/core`, `@hyper/openapi`, etc.)
// resolves to the vendored source-distributed components under src/hyper/.
const hyperDir = fileURLToPath(new URL('./src/hyper', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^@hyper\/(.*)$/, replacement: `${hyperDir}/$1/index.ts` }],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
