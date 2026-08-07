/**
 * Destination-side claim for a CCTP burn.
 *
 * A bridge is two halves: burn on the source chain, then claim (mint) on the
 * destination. The burn is irreversible, so a claim that fails leaves real funds
 * sitting unminted — they stay claimable forever, but only if something retries.
 * This module is that single retry path, shared by the live bridge flow and the
 * "Pending Claims" panel so both behave identically.
 *
 * Each destination family needs a different mechanism:
 *   EVM     — user signs `receiveMessage` on the MessageTransmitter (gasless via AA)
 *   Solana  — server builds, signs and submits `receiveMessage` (sponsor pays)
 *   Stellar — server calls `mint_and_forward` on the Soroban forwarder (sponsor pays)
 */

import type { ConnectedWallet } from '@privy-io/react-auth';
import { executeReceiveMessage } from '@/lib/web3/bridge-actions';
import { EVM_CLAIM_CHAINS } from '@/lib/web3/cctp-delivery';
import type { SupportedChain } from '@/lib/circle/gateway';

export interface BridgeClaimParams {
  destChain: string;
  messageBytes: string;
  attestation: string;
  /** Required for EVM destinations. */
  embeddedWallet?: ConnectedWallet | null;
  /** Required for Solana destinations — only the address; the server signs. */
  solanaWallet?: { address: string } | null;
  /** Required for Stellar destinations. */
  stellarWallet?: { walletId: string; address: string } | null;
  /** Required for Stellar destinations — the server re-fetches the attestation itself. */
  burnTxHash?: string;
  sourceChain?: string;
}

/**
 * A claim involves a bundler, a paymaster and an RPC, none of which are guaranteed to
 * answer. Without a ceiling a single unresolved promise leaves the caller's "minting in
 * progress" latch stuck on and the UI spinning forever. Retrying is safe — the nonce
 * check runs first, and CCTP rejects a replay — so time out and let the caller retry.
 */
const CLAIM_TIMEOUT_MS = 120_000;

function withClaimTimeout<T>(work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('The claim is taking longer than expected. Please try again.')),
        CLAIM_TIMEOUT_MS,
      ),
    ),
  ]);
}

/**
 * Claim a burn on its destination chain. Returns the mint tx hash, or `undefined`
 * when the destination reports the message as already processed.
 *
 * Throws on failure — callers should route the error through `classifyAppError`.
 */
export async function claimBridgeOnDestination(
  params: BridgeClaimParams,
): Promise<string | undefined> {
  const dest = params.destChain.toLowerCase();

  if (dest === 'solana') return withClaimTimeout(claimOnSolana(params));
  if (dest === 'stellar') return withClaimTimeout(claimOnStellar(params));
  if (EVM_CLAIM_CHAINS.includes(dest)) {
    return withClaimTimeout(claimOnEvm(params, dest as SupportedChain));
  }

  throw new Error(`Claiming to ${params.destChain} is not supported.`);
}

/**
 * Delivering the message needs no wallet signature — see `/api/bridge/solana-claim`
 * — so the whole claim is one server call. That also means it survives the tab
 * closing mid-claim, which the previous browser-side sponsor/sign/submit dance
 * did not.
 */
async function claimOnSolana(params: BridgeClaimParams): Promise<string | undefined> {
  const { solanaWallet, messageBytes, attestation, burnTxHash, sourceChain } = params;
  if (!solanaWallet) {
    throw new Error('Solana wallet not ready. Please wait a moment and try again.');
  }

  const res = await fetch('/api/bridge/solana-claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      burnTxHash,
      sourceChain,
      solanaAddress: solanaWallet.address,
      messageBytes,
      attestation,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Failed to claim on Solana');
  }
  // Already delivered — the caller reconciles this the same way it does on EVM.
  if (data.alreadyClaimed) return undefined;
  return data.txHash;
}

async function claimOnStellar(params: BridgeClaimParams): Promise<string | undefined> {
  const { burnTxHash, sourceChain, stellarWallet } = params;
  if (!burnTxHash || !sourceChain) {
    throw new Error('Missing burn transaction details for the Stellar claim.');
  }

  const res = await fetch('/api/stellar/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      txHash: burnTxHash,
      sourceChain,
      // Lets the server repair a missing USDC trustline before it simulates.
      walletId: stellarWallet?.walletId,
      stellarAddress: stellarWallet?.address,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 409 || data.code === 'already_claimed' || data.alreadyClaimed) {
      return undefined;
    }
    throw new Error(data.error || 'Failed to claim on Stellar');
  }
  if (data.alreadyClaimed) return undefined;
  return data.txHash;
}

async function claimOnEvm(
  params: BridgeClaimParams,
  dest: SupportedChain,
): Promise<string | undefined> {
  const { embeddedWallet, burnTxHash, sourceChain } = params;
  let { messageBytes, attestation } = params;

  if (!embeddedWallet) {
    throw new Error('Embedded wallet not found. Please wait a moment and try again.');
  }

  // If attestation is missing or stale, fetch a fresh attestation directly from Circle Iris API
  if (!attestation || !messageBytes || attestation.length < 10) {
    if (burnTxHash && sourceChain) {
      console.log(`[claimOnEvm] Fetching fresh Circle attestation for ${sourceChain} burn ${burnTxHash}...`);
      const { fetchAttestation } = await import('@/lib/circle/gateway');
      const fresh = await fetchAttestation(sourceChain as SupportedChain, burnTxHash);
      if (fresh.status !== 'complete' || !fresh.attestation || !fresh.messageBytes) {
        throw new Error('Circle is still verifying this transfer. Please try again in 1–2 minutes.');
      }
      attestation = fresh.attestation;
      messageBytes = fresh.messageBytes;
    }
  }

  const hash = await executeReceiveMessage(embeddedWallet, messageBytes, attestation, dest);
  // `executeReceiveMessage` returns 'N/A' when a claim for this message is already in flight.
  return hash === 'N/A' ? undefined : hash;
}
