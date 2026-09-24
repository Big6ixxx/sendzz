/**
 * Alchemy Address Activity webhooks — payload handling, kept free of I/O so it can be tested.
 *
 * Why this exists: the deposit scanner asks Alchemy "did anything arrive?" on a timer, once per
 * user per chain, and `alchemy_getAssetTransfers` is the one Alchemy method in this codebase
 * with no public-RPC fallback — every call bills. Polling for an event that happens a few times
 * a day is the wrong shape, and it was the whole Alchemy bill. A webhook inverts it: Alchemy
 * tells us the moment USDC lands.
 *
 * The scanner is NOT replaced by this. Push delivery is not a guarantee — a deploy restarts the
 * container mid-POST, an address was never registered, Alchemy has an incident — so the cron
 * stays as the backstop that finds whatever the webhook missed. Same belt-and-braces shape the
 * withdrawal path already uses (provider webhook → polling → reconcile cron).
 *
 * ─── Which chain an event belongs to ────────────────────────────────────────
 *
 * Resolved from the `webhookId` against our own configuration, NOT from the payload's `network`
 * string. Two reasons: the id is something we configured, so an event carrying an unrecognised
 * one is rejected rather than guessed at; and it avoids hardcoding Alchemy's network enum
 * spellings, which differ from their RPC subdomains and would be one more list to keep in sync.
 *
 * One webhook covers one network, so each chain has its own id and its own signing key.
 */

import crypto from 'crypto';
import { DEPOSIT_CHAINS, USDC_ADDRESSES, type SupportedChain } from '@/lib/circle/gateway';
import { VIEM_CHAINS } from './multichain';
import type { AlchemyTransfer } from './deposit-amount';

/** One activity entry. Shaped by Alchemy, not by us — see the normalisation note below. */
export interface AlchemyActivity {
  blockNum?: string;
  hash?: string;
  fromAddress?: string;
  toAddress?: string;
  value?: number | null;
  asset?: string | null;
  /** "token" for an ERC-20 Transfer, "external" for a native-currency send. */
  category?: string;
  rawContract?: {
    /** Hex, the untouched on-chain integer. */
    rawValue?: string | null;
    address?: string | null;
    /** A NUMBER here, unlike the Transfers API's hex string. */
    decimals?: number | null;
  };
}

/** Only the fields this route reads. Alchemy sends more (type, createdAt, network, log). */
export interface AlchemyWebhookPayload {
  webhookId?: string;
  id?: string;
  event?: { activity?: AlchemyActivity[] };
}

const ENV_SUFFIX: Record<SupportedChain, string> = {
  ethereum: 'ETHEREUM',
  arbitrum: 'ARBITRUM',
  avalanche: 'AVALANCHE',
  optimism: 'OPTIMISM',
  polygon: 'POLYGON',
  base: 'BASE',
  arc: 'ARC',
};

export const webhookIdEnv = (chain: SupportedChain) => `ALCHEMY_WEBHOOK_ID_${ENV_SUFFIX[chain]}`;
export const webhookSecretEnv = (chain: SupportedChain) =>
  `ALCHEMY_WEBHOOK_SECRET_${ENV_SUFFIX[chain]}`;

/**
 * Which chain a webhook id belongs to, or null if it is not one of ours.
 *
 * Read from the environment on every call rather than cached at module load: a missing id is a
 * configuration mistake an operator fixes by setting a variable and restarting, and a cache
 * would make that look like the fix had not worked.
 */
export function chainForWebhookId(webhookId: string | undefined): SupportedChain | null {
  if (!webhookId) return null;
  for (const chain of DEPOSIT_CHAINS) {
    if (process.env[webhookIdEnv(chain)] === webhookId) return chain;
  }
  return null;
}

/**
 * Is this signature genuinely Alchemy's, for this chain's webhook?
 *
 * HMAC-SHA256 over the RAW body — the bytes as received. Hashing a re-serialised parse is the
 * mistake that silently rejected every Bitnob event carrying a numeric amount (see
 * lib/bitnob/webhook-signature), so the raw string is what reaches this function.
 */
export function verifyAlchemySignature(params: {
  rawBody: string;
  signature: string | null | undefined;
  signingKey: string | undefined;
}): boolean {
  const { rawBody, signature, signingKey } = params;
  if (!signature || !signingKey || !rawBody) return false;
  try {
    const computed = crypto.createHmac('sha256', signingKey).update(rawBody, 'utf8').digest('hex');
    const a = Buffer.from(computed, 'hex');
    const b = Buffer.from(signature.trim().toLowerCase(), 'hex');
    // timingSafeEqual throws on a length mismatch, which is itself a "no".
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Is this activity entry an incoming USDC payment on this chain?
 *
 * Two shapes count, exactly as the scanner's `transferCategories` allows two categories:
 *   - an ERC-20 Transfer of the chain's USDC contract, and
 *   - a native send on a chain whose gas token IS USDC (Arc), which emits no ERC-20 event at all.
 *
 * Anything else — another token, a native send on a chain where native means ETH — is not a USDC
 * deposit and must not be credited as one.
 */
export function isIncomingUsdc(activity: AlchemyActivity, chain: SupportedChain): boolean {
  const category = (activity.category ?? '').toLowerCase();
  const contract = activity.rawContract?.address?.toLowerCase();
  const usdc = USDC_ADDRESSES[chain]?.toLowerCase();

  if (contract && usdc && contract === usdc) return true;

  if (category === 'external') {
    const nativeIsUsdc = VIEM_CHAINS[chain]?.nativeCurrency?.symbol?.toUpperCase() === 'USDC';
    // A contract address on a native transfer means it was not really native — don't guess.
    return nativeIsUsdc && !contract;
  }

  // `internal` is deliberately excluded, and `token` against a system pseudo-contract with it.
  //
  // Arc reports one ordinary USDC send three times over: as `external` (correct decimals), as
  // `internal` DELEGATECALL traces that are execution steps rather than payments, and as a
  // `token` transfer against `0xffff…fffe` — which carries NO `decimals` field. That last one is
  // the dangerous shape: the amount maths falls back to 6 decimals for an 18-decimal raw value,
  // so 0.1 USDC would be credited as 100,000,000,000. Taking only the `external` form gets the
  // payment once, at the right scale, and matches the categories the Transfers API scanner asks
  // for. Do not add `0xffff…fffe` to USDC_ADDRESSES to "fix" Arc.
  return false;
}

/**
 * Reshape a webhook activity into the Transfers-API shape the amount maths already speaks.
 *
 * Deliberately converting rather than writing a second amount calculation: `transferAmountUsdc`
 * is the one piece of arithmetic that decides what a user is credited, and it already carries
 * the Arc lesson — USDC arrives at 6 decimals as a token and 18 when sent natively as gas, and
 * assuming 6 turned a 0.5 USDC deposit into 500,000,000,000. One path, one set of bugs.
 *
 * The one wrinkle: the webhook reports `decimals` as a number while the Transfers API reports
 * `decimal` as a hex string, and the shared code parses base-16. So 18 has to travel as "12".
 */
export function toAlchemyTransfer(activity: AlchemyActivity): AlchemyTransfer {
  const decimals = activity.rawContract?.decimals;
  return {
    hash: activity.hash ?? '',
    value: activity.value ?? null,
    from: activity.fromAddress ?? '',
    blockNum: activity.blockNum ?? '',
    category: activity.category,
    rawContract: {
      value: activity.rawContract?.rawValue ?? null,
      decimal:
        typeof decimals === 'number' && Number.isFinite(decimals)
          ? decimals.toString(16)
          : null,
      address: activity.rawContract?.address ?? null,
    },
  };
}
