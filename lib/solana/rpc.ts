/**
 * Where Solana reads and sends go.
 *
 * One place, because the endpoint was inlined at six call sites with two different fallback
 * operators — some `||`, some `??` — so blanking the environment variable would have fixed half
 * of them and left the other half pointing at an empty string.
 *
 * ─── Why Alchemy is skipped ─────────────────────────────────────────────────
 *
 * Solana is switched off on the Alchemy app, but NEXT_PUBLIC_SOLANA_RPC_URL still points at
 * `solana-mainnet.g.alchemy.com`. Reading it would send every Solana call to an endpoint that
 * now refuses — and Solana sends, bridging and balance reads are deliberately still available so
 * anyone already holding USDC there can move it out (see SOLANA_RECEIVE_ENABLED in
 * lib/circle/gateway). Those paths have to keep working, so they use public infrastructure
 * instead. It is free, and Solana reads here are rare enough not to need more.
 *
 * The variable is left in place, untouched, so nothing else that reads it changes and turning
 * Alchemy back on is a one-line edit here rather than an environment hunt.
 */

/** Solana Foundation's public endpoint — the same one every call site already fell back to. */
const PUBLIC_SOLANA_RPC = 'https://api.mainnet-beta.solana.com';

/**
 * Set to false once Solana is re-enabled on the Alchemy app, and NEXT_PUBLIC_SOLANA_RPC_URL
 * becomes the preferred endpoint again.
 */
const SKIP_ALCHEMY_SOLANA = true;

/**
 * The Solana RPC endpoint to use.
 *
 * `SOLANA_RPC_URL` (server-only, no NEXT_PUBLIC prefix) still wins where it is set, so a private
 * or paid endpoint can be pointed at without touching this file. It is simply absent in the
 * browser bundle, where the public endpoint is used instead.
 */
export function solanaRpcUrl(): string {
  const serverOverride = process.env.SOLANA_RPC_URL;
  if (serverOverride) return serverOverride;

  if (!SKIP_ALCHEMY_SOLANA) {
    const configured = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    if (configured) return configured;
  }

  return PUBLIC_SOLANA_RPC;
}
