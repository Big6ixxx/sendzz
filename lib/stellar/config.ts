/**
 * The two Stellar constants every module here needs.
 *
 * They used to be re-declared in each file that touched Horizon. Harmless until one of them
 * changes — a testnet issuer, a private Horizon — and gets updated everywhere but one, which
 * then fails only on whichever path was missed.
 *
 * Deliberately free of side effects, and its one import (lib/network) is itself import-free, so
 * the cheapest server module can pull it in without dragging the Stellar SDK or a Privy client
 * along.
 */

import { NETWORK } from '@/lib/network';

export const STELLAR_HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ?? NETWORK.stellar.horizonUrl;

/** Circle's USDC classic asset issuer — mainnet or testnet per lib/network. */
export const STELLAR_USDC_ISSUER = NETWORK.stellar.usdcIssuer;

/**
 * Circle's CctpForwarder. A burn to Stellar names it as both mintRecipient and destinationCaller,
 * and the claim route then calls `mint_and_forward` on it — so the burn side and the claim side
 * must resolve it identically, which is why it lives here and not in each file.
 */
export const STELLAR_CCTP_FORWARDER =
  process.env.NEXT_PUBLIC_STELLAR_CCTP_FORWARDER || NETWORK.stellar.cctpForwarder;
