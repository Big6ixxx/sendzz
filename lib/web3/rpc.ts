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

import { NETWORK } from '../network';
import { VIEM_CHAINS } from './multichain';

/** Mainnet or testnet subdomains, per lib/network. */
export const ALCHEMY_SUBDOMAIN: Record<string, string> = NETWORK.alchemySubdomain;

/**
 * Keyless public endpoints, in preference order.
 *
 * Two per chain, because a single one is a single point of failure and these do rot:
 * `polygon-rpc.com` and `cloudflare-eth.com` were both configured here and both stopped
 * answering, which is why a funded Polygon balance read as zero once Alchemy 403'd.
 * Verified reachable when written — re-check them if a chain starts reporting empty.
 * The lists themselves live in lib/network, one per network.
 */
export const PUBLIC_RPCS: Record<string, string[]> = {
  ...NETWORK.publicRpcs,
  // Taken from the chain definition rather than retyped, so the two cannot disagree.
  arc: [...VIEM_CHAINS.arc.rpcUrls.default.http],
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
