import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Vitest needs the same `@/*` alias the app uses. Without it any test that reaches a
 * module importing `@/…` fails to resolve, which is why the suite could only cover
 * modules with purely relative imports.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
});
