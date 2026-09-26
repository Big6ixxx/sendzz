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
  test: {
    /**
     * Vitest defaults to 5 seconds, and that was never a decision anybody made here.
     *
     * Several suites call `await import(…)` inside the test rather than at the top, because
     * that is what `vi.doMock` requires — the mock has to be registered before the module
     * graph is pulled in. Loading one of those graphs means viem, the Solana kit and the
     * Stellar SDK, which is seconds of work the FIRST time and microseconds afterwards. Billed
     * against a five-second budget, on a runner executing several files at once, whether a
     * test passed came down to how warm the module cache happened to be when its turn came.
     * That produced one to six failures per run, in different tests each time, none of them
     * describing anything wrong with the code.
     *
     * Thirty seconds is not a target. Nothing here should come close to it, and a test that
     * does is a test doing real work it should not be doing. It is picked to be far enough
     * above module-loading noise that crossing it means something is genuinely stuck, while
     * still failing rather than hanging a CI job forever.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
