/**
 * Where Solana reads and sends go.
 *
 * One place, because the endpoint was inlined at six call sites with two different fallback
 * operators — some `||`, some `??` — so blanking the environment variable would have fixed half
 * of them and left the other half pointing at an empty string.
 */

import { NETWORK } from '@/lib/network';

/** Solana Foundation's public endpoint: mainnet-beta, or devnet when lib/network says testnet. */
const PUBLIC_SOLANA_RPC = NETWORK.solana.publicRpc;

/**
 * The Solana RPC endpoint to use.
 *
 * `SOLANA_RPC_URL` (server-only, no NEXT_PUBLIC prefix) wins where it is set, so the server can
 * use a private endpoint whose key never reaches the browser bundle. Then
 * `NEXT_PUBLIC_SOLANA_RPC_URL`, which the browser can read too. Then the public endpoint, which
 * is rate-limited and not meant for production traffic.
 */
export function solanaRpcUrl(): string {
  return (
    process.env.SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    PUBLIC_SOLANA_RPC
  );
}
