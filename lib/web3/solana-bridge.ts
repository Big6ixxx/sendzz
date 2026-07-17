'use client';

/**
 * Solana → Base bridge helpers (Circle CCTP V2).
 *
 * Solana uses a different execution path from EVM (Privy embedded Solana wallet, a
 * Circle DCW fee-payer for gas, SPL USDC). This module makes Solana usable as a
 * *spendable source*: bridge its USDC onto Base, after which the normal EVM routing
 * spends it. `prepareSolanaBurnTx` is shared with SmartBridgeModule; `bridgeSolanaToBase`
 * is the awaitable end-to-end used by auto-consolidation.
 */

import { Buffer } from 'buffer';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import {
  buildDepositForBurnTx,
  SOLANA_CCTP_DOMAIN,
  BASE_CCTP_DOMAIN,
  SOLANA_USDC_MINT,
} from '@/lib/circle/solana-gateway';
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import { fetchCctpFees, CCTP_DOMAINS, type SupportedChain } from '@/lib/circle/gateway';
import { executeReceiveMessage } from './bridge-actions';
import type { ConnectedWallet } from '@privy-io/react-auth';

/**
 * Build a Solana depositForBurn transaction targeting `recipientEvm` on Base, fund its
 * gas via the Circle fee-payer sponsor route, and pre-sign the event account. Returns a
 * sponsored transaction ready for the user's Solana wallet to sign and broadcast.
 */
export async function prepareSolanaBurnTx(params: {
  connection: Connection;
  walletAddress: string;
  amount: string;
  recipientEvm: string;
  destChain?: SupportedChain;
}): Promise<{ sponsoredTx: Transaction }> {
  const { connection, walletAddress, amount, recipientEvm, destChain = 'base' } = params;

  // CCTP fee (non-fatal — fall back to 0).
  let feeSubunits = 0n;
  try {
    const [whole, frac = ''] = amount.split('.');
    const amtSubunits = BigInt(whole + (frac + '000000').slice(0, 6));
    const destDomain = CCTP_DOMAINS[destChain];
    const fees = await fetchCctpFees(SOLANA_CCTP_DOMAIN, destDomain);
    const fast = fees.find((f) => f.finalityThreshold === 1000) ?? fees[0];
    const fee = (amtSubunits * BigInt(Math.round(fast.minimumFee * 100))) / 1_000_000n;
    feeSubunits = (fee * 120n) / 100n; // 20% buffer
  } catch {
    /* use 0 fee */
  }

  const { transaction, messageSentEventData } = await buildDepositForBurnTx(
    connection,
    new PublicKey(walletAddress),
    amount,
    recipientEvm,
    feeSubunits,
    destChain,
  );

  const txBase64 = transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString('base64');

  const res = await fetch('/api/bridge/solana-sponsor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction: txBase64 }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`Gas station error: ${err.error ?? res.statusText}`);
  }
  const { sponsoredTransaction } = (await res.json()) as {
    sponsoredTransaction: string;
  };

  const sponsoredTx = Transaction.from(Buffer.from(sponsoredTransaction, 'base64'));
  // Circle replaced the fee-payer; re-apply our event-account signature.
  sponsoredTx.partialSign(messageSentEventData);
  return { sponsoredTx };
}

/**
 * Bridge USDC from the user's Solana wallet to `recipientEvm` on Base, end to end:
 * burn on Solana → poll Circle for the attestation → mint on Base (Circle's relayed
 * mint if present, otherwise submit `receiveMessage` ourselves).
 *
 * `signAndBroadcast` is supplied by the React layer (it holds the Privy Solana signer);
 * it signs the sponsored tx and returns the broadcast signature.
 */
export async function bridgeSolanaToBase(params: {
  connection: Connection;
  walletAddress: string;
  amount: string;
  recipientEvm: string;
  evmWallet: ConnectedWallet;
  signAndBroadcast: (tx: Transaction) => Promise<string>;
  onStatus?: (status: string) => void;
  timeoutMs?: number;
}): Promise<{ burnTxHash: string; mintTxHash?: string }> {
  const {
    connection,
    walletAddress,
    amount,
    recipientEvm,
    evmWallet,
    signAndBroadcast,
    onStatus,
  } = params;

  onStatus?.('Preparing Solana transfer…');
  const { sponsoredTx } = await prepareSolanaBurnTx({
    connection,
    walletAddress,
    amount,
    recipientEvm,
  });

  onStatus?.('Confirming on Solana…');
  const burnTxHash = await signAndBroadcast(sponsoredTx);

  onStatus?.('Waiting for network confirmation…');
  const deadline = Date.now() + (params.timeoutMs ?? 20 * 60_000);
  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `/api/bridge/status?txHash=${burnTxHash}&sourceChain=solana`,
      );
      const data = await res.json();
      if (data.status === 'complete') {
        let mintTxHash: string | undefined = data.mintTxHash;
        if (!mintTxHash && data.attestation && data.messageBytes) {
          onStatus?.('Delivering on Base…');
          mintTxHash = await executeReceiveMessage(
            evmWallet,
            data.messageBytes,
            data.attestation,
            'base',
          );
        }
        return { burnTxHash, mintTxHash };
      }
    } catch (err) {
      console.warn('[bridgeSolanaToBase] status poll error:', err);
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }

  return { burnTxHash };
}

/**
 * Build a Solana same-chain SPL USDC transfer transaction.
 * Appends associated token account initialization if the recipient doesn't have one.
 */
export async function buildSolanaUsdcTransferTx(params: {
  connection: Connection;
  senderAddress: string;
  recipientAddress: string;
  amount: string;
}): Promise<Transaction> {
  const { connection, senderAddress, recipientAddress, amount } = params;
  const senderPubKey = new PublicKey(senderAddress);
  const recipientPubKey = new PublicKey(recipientAddress);

  const senderAta = getAssociatedTokenAddressSync(SOLANA_USDC_MINT, senderPubKey);
  const recipientAta = getAssociatedTokenAddressSync(SOLANA_USDC_MINT, recipientPubKey);

  const tx = new Transaction();

  const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
  if (!recipientAtaInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        senderPubKey,
        recipientAta,
        recipientPubKey,
        SOLANA_USDC_MINT
      )
    );
  }

  const amountSubunits = BigInt(Math.round(parseFloat(amount) * 1_000_000));
  tx.add(
    createTransferCheckedInstruction(
      senderAta,
      SOLANA_USDC_MINT,
      recipientAta,
      senderPubKey,
      amountSubunits,
      6
    )
  );

  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = senderPubKey;

  return tx;
}
