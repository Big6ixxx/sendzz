/**
 * Stellar network selection.
 *
 * The bug this guards against: `.env` sets the generic NEXT_PUBLIC_STELLAR_* variables to
 * mainnet values, and every Stellar module read them directly with a mainnet fallback. So
 * a testnet build still used mainnet Horizon, the mainnet passphrase and the mainnet USDC
 * issuer — silently, because nothing was unset. `privy-wallet` was worse: its issuer was
 * a hardcoded mainnet constant with no override path at all, which meant every trustline
 * on testnet was built against an asset that does not exist there.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';

/** Mainnet-pinned values, exactly as they appear in the real .env. */
const MAINNET_ENV = {
  NEXT_PUBLIC_STELLAR_HORIZON_URL: 'https://horizon.stellar.org',
  NEXT_PUBLIC_STELLAR_RPC_URL: 'https://soroban-rpc.mainnet.stellar.gateway.fm',
  NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE: Networks.PUBLIC,
  NEXT_PUBLIC_STELLAR_USDC_CONTRACT: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
  NEXT_PUBLIC_STELLAR_TOKEN_MESSENGER_CONTRACT: 'CAE2G5Z77UPMXMXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  NEXT_PUBLIC_STELLAR_CCTP_FORWARDER: 'CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T',
};

async function loadConfig(simulation: string, extra: Record<string, string> = {}) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SIMULATION_MODE', simulation);
  for (const [k, v] of Object.entries({ ...MAINNET_ENV, ...extra })) vi.stubEnv(k, v);
  return import('./network');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('testnet', () => {
  it('ignores the mainnet-pinned generic env vars', async () => {
    const { STELLAR } = await loadConfig('true');

    expect(STELLAR.horizonUrl).toBe('https://horizon-testnet.stellar.org');
    expect(STELLAR.sorobanRpcUrl).toBe('https://soroban-testnet.stellar.org');
    expect(STELLAR.networkPassphrase).toBe(Networks.TESTNET);
  });

  it('uses Circle\'s testnet USDC issuer, not the mainnet one', async () => {
    const { STELLAR } = await loadConfig('true');
    // Verified to resolve on testnet Horizon.
    expect(STELLAR.usdcIssuer).toBe('GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
    expect(STELLAR.usdcContract).toBe('CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA');
  });

  it('uses Circle\'s testnet CCTP contracts, never the mainnet ones', async () => {
    const { STELLAR, STELLAR_CCTP_AVAILABLE } = await loadConfig('true');

    // All three verified deployed on testnet Soroban. Circle's sandbox Iris also quotes
    // fees for domain 27 in both directions, so CCTP to/from Stellar works on testnet.
    expect(STELLAR.tokenMessengerContract).toBe(
      'CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP',
    );
    expect(STELLAR.cctpForwarder).toBe(
      'CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ',
    );
    expect(STELLAR.messageTransmitterContract).toBe(
      'CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY',
    );
    expect(STELLAR_CCTP_AVAILABLE).toBe(true);

    // The mainnet ids pinned in .env must not appear anywhere in a testnet build.
    expect(STELLAR.cctpForwarder).not.toBe(MAINNET_ENV.NEXT_PUBLIC_STELLAR_CCTP_FORWARDER);
  });

  it('still honours an explicitly testnet-scoped override', async () => {
    const { STELLAR } = await loadConfig('true', {
      NEXT_PUBLIC_STELLAR_HORIZON_URL_TESTNET: 'https://my-horizon.example',
      NEXT_PUBLIC_STELLAR_CCTP_FORWARDER_TESTNET: 'CTESTFORWARDER',
    });
    expect(STELLAR.horizonUrl).toBe('https://my-horizon.example');
    expect(STELLAR.cctpForwarder).toBe('CTESTFORWARDER');
  });
});

describe('mainnet', () => {
  it('uses the generic env vars, so production behaviour is unchanged', async () => {
    const { STELLAR, STELLAR_CCTP_AVAILABLE } = await loadConfig('false');

    expect(STELLAR.horizonUrl).toBe(MAINNET_ENV.NEXT_PUBLIC_STELLAR_HORIZON_URL);
    expect(STELLAR.networkPassphrase).toBe(Networks.PUBLIC);
    expect(STELLAR.usdcContract).toBe(MAINNET_ENV.NEXT_PUBLIC_STELLAR_USDC_CONTRACT);
    expect(STELLAR.cctpForwarder).toBe(MAINNET_ENV.NEXT_PUBLIC_STELLAR_CCTP_FORWARDER);
    expect(STELLAR_CCTP_AVAILABLE).toBe(true);
  });

  it('ignores testnet-scoped overrides', async () => {
    const { STELLAR } = await loadConfig('false', {
      NEXT_PUBLIC_STELLAR_HORIZON_URL_TESTNET: 'https://my-horizon.example',
    });
    expect(STELLAR.horizonUrl).toBe(MAINNET_ENV.NEXT_PUBLIC_STELLAR_HORIZON_URL);
  });

  it('falls back to the mainnet issuer when no env var is set', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_SIMULATION_MODE', 'false');
    const { STELLAR } = await import('./network');
    expect(STELLAR.usdcIssuer).toBe('GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');
  });
});

describe('sponsor key', () => {
  it('prefers a dedicated testnet sponsor but falls back to the shared one', async () => {
    let mod = await loadConfig('true', { STELLAR_SPONSOR_SECRET_KEY: 'S_SHARED' });
    expect(mod.stellarSponsorSecret()).toBe('S_SHARED');

    mod = await loadConfig('true', {
      STELLAR_SPONSOR_SECRET_KEY: 'S_SHARED',
      STELLAR_SPONSOR_SECRET_KEY_TESTNET: 'S_TESTNET',
    });
    expect(mod.stellarSponsorSecret()).toBe('S_TESTNET');
  });

  it('never uses the testnet sponsor on mainnet', async () => {
    const mod = await loadConfig('false', {
      STELLAR_SPONSOR_SECRET_KEY: 'S_SHARED',
      STELLAR_SPONSOR_SECRET_KEY_TESTNET: 'S_TESTNET',
    });
    expect(mod.stellarSponsorSecret()).toBe('S_SHARED');
  });
});
