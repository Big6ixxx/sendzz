import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Mirrors the `@/*` path alias from tsconfig.json. Without it any module that imports via
 * `@/…` — which is most of `lib/` — cannot be unit tested at all.
 */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
