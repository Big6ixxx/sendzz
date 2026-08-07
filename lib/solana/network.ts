/**
 * Solana network selection — one source of truth.
 *
 * Same trap the Stellar config had: `.env` sets NEXT_PUBLIC_SOLANA_RPC_URL to a Solana
 * *mainnet* Alchemy endpoint, and seven call sites read it as
 * `process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? devnet`. The fallback therefore never fired
 * — a testnet build read Solana mainnet balances while the rest of the app transacted in
 * devnet USDC.
 *
 * The override rule matches the Stellar module:
 *
 *   mainnet → NEXT_PUBLIC_SOLANA_RPC_URL applies (production unchanged)
 *   testnet → only NEXT_PUBLIC_SOLANA_RPC_URL_TESTNET applies
 */

import { IS_TESTNET } from '@/lib/web3/network';

/** Cluster name, matching the keys Privy uses for its Solana RPC map. */
export const SOLANA_CLUSTER = IS_TESTNET ? 'devnet' : 'mainnet-beta';

const DEFAULT_RPC = IS_TESTNET
  ? 'https://api.devnet.solana.com'
  : 'https://api.mainnet-beta.solana.com';

export const SOLANA_RPC_URL =
  (IS_TESTNET
    ? process.env.NEXT_PUBLIC_SOLANA_RPC_URL_TESTNET
    : process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL) || DEFAULT_RPC;
