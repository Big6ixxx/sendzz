/**
 * Solana network selection.
 *
 * The bug: `.env` sets NEXT_PUBLIC_SOLANA_RPC_URL to a Solana *mainnet* Alchemy endpoint,
 * and seven call sites read it as `process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? devnet`. The
 * fallback never fired, so a testnet build read Solana mainnet balances while the rest of
 * the app transacted in devnet USDC. Identical in shape to the Stellar one.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

const MAINNET_RPC = 'https://solana-mainnet.g.alchemy.com/v2/key';

async function load(simulation: string, extra: Record<string, string> = {}) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SIMULATION_MODE', simulation);
  vi.stubEnv('NEXT_PUBLIC_SOLANA_RPC_URL', MAINNET_RPC);
  for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v);
  return import('./network');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('testnet', () => {
  it('ignores the mainnet-pinned NEXT_PUBLIC_SOLANA_RPC_URL', async () => {
    const { SOLANA_RPC_URL, SOLANA_CLUSTER } = await load('true');
    expect(SOLANA_RPC_URL).toBe('https://api.devnet.solana.com');
    expect(SOLANA_RPC_URL).not.toBe(MAINNET_RPC);
    expect(SOLANA_CLUSTER).toBe('devnet');
  });

  it('honours a testnet-scoped override', async () => {
    const { SOLANA_RPC_URL } = await load('true', {
      NEXT_PUBLIC_SOLANA_RPC_URL_TESTNET: 'https://my-devnet.example',
    });
    expect(SOLANA_RPC_URL).toBe('https://my-devnet.example');
  });
});

describe('mainnet', () => {
  it('uses the configured endpoint, so production is unchanged', async () => {
    const { SOLANA_RPC_URL, SOLANA_CLUSTER } = await load('false');
    expect(SOLANA_RPC_URL).toBe(MAINNET_RPC);
    expect(SOLANA_CLUSTER).toBe('mainnet-beta');
  });

  it('ignores testnet-scoped overrides', async () => {
    const { SOLANA_RPC_URL } = await load('false', {
      NEXT_PUBLIC_SOLANA_RPC_URL_TESTNET: 'https://my-devnet.example',
    });
    expect(SOLANA_RPC_URL).toBe(MAINNET_RPC);
  });
});
