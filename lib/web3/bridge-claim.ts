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
 *   Solana  — build `receiveMessage`, have the server sponsor the fee, user signs
 *   Stellar — server calls `mint_and_forward` on the Soroban forwarder (sponsor pays)
 */

import { Buffer } from 'buffer';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import type { ConnectedWallet } from '@privy-io/react-auth';
import { buildReceiveMessageOnSolanaTx } from '@/lib/circle/solana-gateway';
import { executeReceiveMessage } from '@/lib/web3/bridge-actions';
import type { SupportedChain } from '@/lib/circle/gateway';

/** Signs a Solana transaction and returns the raw signed bytes. */
export type SolanaTxSigner = (tx: Transaction) => Promise<Uint8Array>;

export interface BridgeClaimParams {
  destChain: string;
  messageBytes: string;
  attestation: string;
  /** Required for Solana destinations. */
  connection?: Connection;
  /** Required for EVM destinations. */
  embeddedWallet?: ConnectedWallet | null;
  /** Required for Solana destinations. */
  solanaWallet?: { address: string } | null;
  /** Required for Solana destinations. */
  signSolanaTx?: SolanaTxSigner;
  /** Required for Stellar destinations. */
  stellarWallet?: { walletId: string; address: string } | null;
  /** Required for Stellar destinations — the server re-fetches the attestation itself. */
  burnTxHash?: string;
  sourceChain?: string;
}

const EVM_DEST_CHAINS = ['base', 'arbitrum', 'optimism', 'polygon', 'avalanche', 'ethereum'];

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
  if (EVM_DEST_CHAINS.includes(dest)) {
    return withClaimTimeout(claimOnEvm(params, dest as SupportedChain));
  }

  throw new Error(`Claiming to ${params.destChain} is not supported.`);
}

async function claimOnSolana(params: BridgeClaimParams): Promise<string> {
  const { connection, solanaWallet, signSolanaTx, messageBytes, attestation } = params;
  if (!connection || !solanaWallet || !signSolanaTx) {
    throw new Error('Solana wallet not ready. Please wait a moment and try again.');
  }

  const { transaction } = await buildReceiveMessageOnSolanaTx(
    connection,
    new PublicKey(solanaWallet.address),
    messageBytes,
    attestation,
  );

  const txBase64 = transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString('base64');

  const sponsorRes = await fetch('/api/bridge/solana-sponsor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction: txBase64 }),
  });
  if (!sponsorRes.ok) {
    const errData = await sponsorRes.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to sponsor Solana claim transaction');
  }

  const { sponsoredTransaction } = await sponsorRes.json();
  const sponsoredTx = Transaction.from(Buffer.from(sponsoredTransaction, 'base64'));
  const signedBytes = await signSolanaTx(sponsoredTx);

  const signature = await connection.sendRawTransaction(signedBytes, {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });
  const lb = await connection.getLatestBlockhash();
  await connection.confirmTransaction(
    { signature, blockhash: lb.blockhash, lastValidBlockHeight: lb.lastValidBlockHeight },
    'confirmed',
  );

  return signature;
}

async function claimOnStellar(params: BridgeClaimParams): Promise<string> {
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
    throw new Error(data.error || 'Failed to claim on Stellar');
  }
  return data.txHash;
}

async function claimOnEvm(
  params: BridgeClaimParams,
  dest: SupportedChain,
): Promise<string | undefined> {
  const { embeddedWallet, messageBytes, attestation } = params;
  if (!embeddedWallet) {
    throw new Error('Embedded wallet not found. Please wait a moment and try again.');
  }

  const hash = await executeReceiveMessage(embeddedWallet, messageBytes, attestation, dest);
  // `executeReceiveMessage` returns 'N/A' when a claim for this message is already in flight.
  return hash === 'N/A' ? undefined : hash;
}
