import type { SupportedChain } from '../circle/gateway';
import { IS_TESTNET } from './network';

/**
 * Chain slugs for Circle's Modular Wallets endpoints.
 *
 * Circle addresses its bundler, paymaster and wallet APIs by chain slug — the path
 * segment appended to the client URL, e.g. `${CIRCLE_SEND_URL}/baseSepolia`. The testnet
 * slugs are *not* the mainnet ones: `base` is Base mainnet and Base Sepolia is
 * `baseSepolia`.
 *
 * This used to be an identity function returning the app's own chain key, so a testnet
 * build sent its user operations to `/base` — a mainnet bundler — which rejects them on
 * a chain-id mismatch. That is why nothing that needed a signature worked in simulation
 * mode: transfers, bridges and claims all route through here.
 *
 * `null` means Circle does not serve that chain in that network family. Circle's Modular
 * Wallets never supported Ethereum mainnet, and Arc has no mainnet yet.
 */
const CIRCLE_CHAIN_SLUGS: Record<SupportedChain, string | null> = IS_TESTNET
  ? {
      ethereum: null,
      arbitrum: 'arbitrumSepolia',
      avalanche: 'avalancheFuji',
      optimism: 'optimismSepolia',
      polygon: 'polygonAmoy',
      base: 'baseSepolia',
      arc: 'arcTestnet',
    }
  : {
      ethereum: null,
      arbitrum: 'arbitrum',
      avalanche: 'avalanche',
      optimism: 'optimism',
      polygon: 'polygon',
      base: 'base',
      arc: null,
    };

/** True when Circle's bundler/paymaster can serve this chain in the current mode. */
export function isCircleSupported(chain: string): boolean {
  return Boolean(CIRCLE_CHAIN_SLUGS[chain as SupportedChain]);
}

/**
 * Circle keys are scoped to an environment, and the endpoint URLs are not — the chain
 * slug picks the chain, and the key has to belong to that chain's world. Mixing them
 * fails deep inside a user operation with "TEST_API key cannot be used with blockchain
 * mainnets, or LIVE_API key cannot be used with testnets", which reads like a bad
 * parameter rather than a credentials problem.
 *
 * An unrecognised prefix is left alone: better to let Circle judge an unfamiliar key
 * format than to block a valid one this check doesn't know about.
 */
function circleKeyEnvironment(): 'test' | 'live' | 'unknown' {
  const key = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY ?? '';
  if (key.startsWith('TEST_')) return 'test';
  if (key.startsWith('LIVE_')) return 'live';
  return 'unknown';
}

export function assertCircleKeyMatchesNetwork(): void {
  const actual = circleKeyEnvironment();
  if (actual === 'unknown') return;

  const expected = IS_TESTNET ? 'test' : 'live';
  if (actual === expected) return;

  throw new Error(
    `Circle credentials are for ${actual.toUpperCase()} but the app is running on ` +
      `${IS_TESTNET ? 'testnet' : 'mainnet'}. Circle rejects this pairing.\n\n` +
      `Set NEXT_PUBLIC_CIRCLE_CLIENT_KEY (and CIRCLE_API_KEY) to a ` +
      `${expected.toUpperCase()}_ key from console.circle.com, or switch ` +
      `NEXT_PUBLIC_SIMULATION_MODE to "${IS_TESTNET ? 'false' : 'true'}". ` +
      `The endpoint URLs are the same for both — only the key changes.`,
  );
}

/**
 * Circle slug for a chain. Throws rather than falling back: a wrong slug means signing a
 * user operation against the wrong network, which fails late and confusingly.
 */
export function getCircleChainSlug(chain: string): string {
  // Every Circle call funnels through here, so this is the one place that catches a
  // key/network mismatch before a transaction is built.
  assertCircleKeyMatchesNetwork();

  const slug = CIRCLE_CHAIN_SLUGS[chain as SupportedChain];
  if (!slug) {
    throw new Error(
      `Circle Modular Wallets does not serve "${chain}" on ` +
        `${IS_TESTNET ? 'testnet' : 'mainnet'}.`,
    );
  }
  return slug;
}
