/**
 * RPC endpoint selection, in one place.
 *
 * Every chain has a preferred endpoint (a per-chain override, else Alchemy) and a public
 * fallback. Callers should use *both*: an Alchemy app only serves the networks enabled on
 * it, and a network that isn't enabled returns 403 / "X is not enabled for this app" for
 * every request on that chain. Reading through a single Alchemy URL therefore makes a
 * whole chain look empty or broken when the real problem is a dashboard checkbox.
 */

import { fallback, http, type Transport } from 'viem';
import { IS_TESTNET } from './network';

/**
 * Alchemy network subdomains.
 *
 * These must track the active network family. When the app ran in testnet mode with a
 * mainnet-only map here, `rpcUrls` still appended a Base *mainnet* Alchemy endpoint as a
 * fallback, so a testnet balance read could quietly answer with mainnet funds whenever a
 * public testnet node was slow — mainnet balances appearing in a testnet build.
 *
 * A chain absent from this map simply has no Alchemy endpoint, which callers must treat
 * as "not scannable via the Transfers API" rather than building an `undefined` hostname.
 * Arc appears only on testnet, because there is no Arc mainnet to point at.
 */
export const ALCHEMY_SUBDOMAIN: Record<string, string> = IS_TESTNET
  ? {
      ethereum: 'eth-sepolia',
      arbitrum: 'arb-sepolia',
      avalanche: 'avax-fuji',
      optimism: 'opt-sepolia',
      polygon: 'polygon-amoy',
      base: 'base-sepolia',
      arc: 'arc-testnet',
    }
  : {
      ethereum: 'eth-mainnet',
      arbitrum: 'arb-mainnet',
      avalanche: 'avax-mainnet',
      optimism: 'opt-mainnet',
      polygon: 'polygon-mainnet',
      base: 'base-mainnet',
    };

/**
 * Keyless public endpoints, in preference order.
 *
 * Two per chain, because a single one is a single point of failure and these do rot:
 * `polygon-rpc.com` and `cloudflare-eth.com` were both configured here and both stopped
 * answering, which is why a funded Polygon balance read as zero once Alchemy 403'd.
 * Verified reachable when written — re-check them if a chain starts reporting empty.
 */
export const PUBLIC_RPCS: Record<string, string[]> = IS_TESTNET
  ? {
      ethereum: ['https://rpc.sepolia.org', 'https://ethereum-sepolia-rpc.publicnode.com'],
      arbitrum: ['https://sepolia-rollup.arbitrum.io/rpc', 'https://arbitrum-sepolia-rpc.publicnode.com'],
      avalanche: ['https://api.avax-test.network/ext/bc/C/rpc', 'https://avalanche-fuji-c-chain-rpc.publicnode.com'],
      optimism: ['https://sepolia.optimism.io', 'https://optimism-sepolia-rpc.publicnode.com'],
      polygon: ['https://polygon-amoy-bor-rpc.publicnode.com', 'https://polygon-amoy.drpc.org'],
      base: ['https://sepolia.base.org', 'https://base-sepolia-rpc.publicnode.com'],
      arc: ['https://rpc.testnet.arc.network'],
    }
  : {
      ethereum: ['https://ethereum-rpc.publicnode.com'],
      arbitrum: ['https://arbitrum-one-rpc.publicnode.com', 'https://arb1.arbitrum.io/rpc'],
      avalanche: [
        'https://avalanche-c-chain-rpc.publicnode.com',
        'https://api.avax.network/ext/bc/C/rpc',
      ],
      optimism: ['https://optimism-rpc.publicnode.com', 'https://mainnet.optimism.io'],
      polygon: ['https://polygon-bor-rpc.publicnode.com'],
      base: ['https://mainnet.base.org', 'https://base.llamarpc.com', 'https://base-rpc.publicnode.com', 'https://1rpc.io/base'],
      // Arc has no mainnet. Kept so a stored Arc record can still be read, but Arc is
      // filtered out of every runtime chain list in a mainnet build.
      arc: ['https://rpc.testnet.arc.network'],
    };

/**
 * Per-chain override, for when a chain needs a specific provider: `<CHAIN>_RPC_URL`,
 * e.g. `BASE_RPC_URL`, `POLYGON_RPC_URL`. One naming rule, no chain is special.
 */
function overrideUrl(chain: string): string | undefined {
  return process.env[`${chain.toUpperCase()}_RPC_URL`] || undefined;
}

function alchemyUrl(chain: string): string | undefined {
  const subdomain = ALCHEMY_SUBDOMAIN[chain.toLowerCase()];
  const apiKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
  return subdomain && apiKey ? `https://${subdomain}.g.alchemy.com/v2/${apiKey}` : undefined;
}

/**
 * Preferred endpoint first, public fallbacks last.
 *
 * Throws on an unrecognised chain rather than defaulting. Silently falling back to Base
 * means reading one chain's contract address against another chain's node, which returns
 * a plausible-looking zero or a revert — so a caller passing viem's `chain.name` instead
 * of our key made a funded balance vanish with no error anywhere.
 */
export function rpcUrls(chain: string): string[] {
  const key = chain.toLowerCase();
  const urls = [
    overrideUrl(key),
    ...(PUBLIC_RPCS[key] ?? []),
    alchemyUrl(key),
  ].filter((u): u is string => !!u);

  if (urls.length === 0) {
    throw new Error(
      `No RPC endpoint configured for chain "${chain}". Expected one of: ${Object.keys(PUBLIC_RPCS).join(', ')}.`,
    );
  }
  return urls;
}

/**
 * A transport that tries each endpoint in turn.
 *
 * The primary gets a deliberately short timeout: when it is misconfigured it fails fast
 * and cheaply, so the fallback still answers inside whatever budget the caller allows.
 * A generous primary timeout is worse than useless here — the caller gives up before the
 * healthy endpoint is ever tried, and the chain silently reads as zero.
 */
export function rpcTransport(chain: string): Transport {
  const urls = rpcUrls(chain);
  if (urls.length === 1) return http(urls[0], { timeout: 10_000, retryCount: 1 });

  return fallback(
    urls.map((url, i) =>
      i === urls.length - 1
        ? http(url, { timeout: 10_000, retryCount: 1 })
        : http(url, { timeout: 2_000, retryCount: 0 }),
    ),
  );
}
