"use client";

/**
 * Solana → EVM bridge helpers (Circle CCTP V2).
 *
 * Solana uses a different execution path from EVM (Privy embedded Solana wallet, a
 * Circle DCW fee-payer for gas, SPL USDC). This module makes Solana usable as a
 * *spendable source*: bridge its USDC onto Base, after which the normal EVM routing
 * spends it. `prepareSolanaBurnTx` is shared with ChainBridgeModule; `bridgeSolanaToBase`
 * is the awaitable end-to-end used by auto-consolidation.
 */

import { Buffer } from "buffer";
import { clearConsolidationBurn, recordConsolidationBurn } from "./record-burn";
import { isPlaceholderHash } from "@/lib/explorers";
import { keepLifetime } from "@/lib/solana/confirm";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  buildDepositForBurnTx,
  SOLANA_CCTP_DOMAIN,
  SOLANA_USDC_MINT,
} from "@/lib/circle/solana-gateway";
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import {
  fetchCctpFees,
  CCTP_DOMAINS,
  CHAIN_NAMES,
  type SupportedChain,
} from "@/lib/circle/gateway";
import {
  deliverOnEvmChain,
  FUNDS_IN_TRANSIT_MESSAGE,
  waitForBridgeAttestation,
} from "./bridge-actions";
import type { ConnectedWallet } from "@privy-io/react-auth";

/**
 * Build a Solana depositForBurn transaction targeting `recipientEvm` on `destChain`, fund its
 * gas via the Circle fee-payer sponsor route, and pre-sign the event account. Returns a
 * sponsored transaction ready for the user's Solana wallet to sign and broadcast.
 *
 * `platformFee` is optional ON PURPOSE, as in `executeSmartBridge`: only a bridge the user came
 * to perform is billed, and consolidation never passes it. When supplied, the fee transfer to
 * the treasury rides in the SAME transaction as the burn, so the two land together or not at all.
 */
export async function prepareSolanaBurnTx(params: {
  connection: Connection;
  walletAddress: string;
  amount: string;
  recipientEvm: string;
  destChain?: SupportedChain;
  platformFee?: { usdc: string; treasury: string };
}): Promise<{ sponsoredTx: Transaction }> {
  const {
    connection,
    walletAddress,
    amount,
    recipientEvm,
    destChain = "base",
    platformFee,
  } = params;
  const owner = new PublicKey(walletAddress);

  // CCTP fee (non-fatal — fall back to 0).
  let feeSubunits = 0n;
  try {
    const amtSubunits = usdcSubunits(amount);
    const destDomain = CCTP_DOMAINS[destChain];
    const fees = await fetchCctpFees(SOLANA_CCTP_DOMAIN, destDomain);
    const fast = fees.find((f) => f.finalityThreshold === 1000) ?? fees[0];
    const fee =
      (amtSubunits * BigInt(Math.round(fast.minimumFee * 100))) / 1_000_000n;
    feeSubunits = (fee * 120n) / 100n; // 20% buffer
  } catch {
    /* use 0 fee */
  }

  const { transaction, messageSentEventData } = await buildDepositForBurnTx(
    connection,
    owner,
    amount,
    recipientEvm,
    feeSubunits,
    destChain,
  );

  if (platformFee && usdcSubunits(platformFee.usdc) > 0n) {
    const feeIx = await buildPlatformFeeInstruction(connection, owner, platformFee);
    // Ahead of the burn; the sponsor policy accepts it in either position.
    transaction.instructions.unshift(feeIx);
    // Adding an instruction invalidates the event account's pre-signature.
    transaction.signatures = [];
    transaction.partialSign(messageSentEventData);
  }

  const txBase64 = transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");

  const res = await fetch("/api/bridge/solana-sponsor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: txBase64 }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`Gas station error: ${err.error ?? res.statusText}`);
  }
  const { sponsoredTransaction } = (await res.json()) as {
    sponsoredTransaction: string;
  };

  const sponsoredTx = keepLifetime(
    Transaction.from(Buffer.from(sponsoredTransaction, "base64")),
    transaction,
  );
  // Circle replaced the fee-payer; re-apply our event-account signature.
  sponsoredTx.partialSign(messageSentEventData);
  return { sponsoredTx };
}

/** "1.5" → 1_500_000n, without going through a float. */
function usdcSubunits(amount: string): bigint {
  const [whole, frac = ""] = amount.split(".");
  return BigInt((whole || "0") + (frac + "000000").slice(0, 6));
}

/**
 * The platform fee as a USDC TransferChecked from the caller to the treasury's token account.
 *
 * The treasury account must already exist. Creating it would need SOL for rent, which the user
 * does not have and the fee payer is not allowed to spend — and finding out after the burn would
 * be too late, so this throws first.
 */
async function buildPlatformFeeInstruction(
  connection: Connection,
  owner: PublicKey,
  platformFee: { usdc: string; treasury: string },
) {
  const treasuryAta = getAssociatedTokenAddressSync(
    SOLANA_USDC_MINT,
    new PublicKey(platformFee.treasury),
    true,
  );
  if (!(await connection.getAccountInfo(treasuryAta))) {
    throw new Error(
      "Bridging from Solana is unavailable right now. Please try another network.",
    );
  }
  return createTransferCheckedInstruction(
    getAssociatedTokenAddressSync(SOLANA_USDC_MINT, owner),
    SOLANA_USDC_MINT,
    treasuryAta,
    owner,
    usdcSubunits(platformFee.usdc),
    6,
  );
}

/**
 * Bridge USDC from the user's Solana wallet to `recipientEvm` on `destChain`, end to end:
 * burn on Solana → wait for Circle's attestation → mint (Circle's relayed mint if present,
 * otherwise `receiveMessage` from the user's smart account).
 *
 * Behaves like `bridgeAndDeliver`: the burn is recorded the moment it lands, a failed mint
 * throws rather than reporting success, and the record is cleared only once a real mint hash
 * proves delivery. Anything left over keeps its Claim button.
 *
 * `signAndBroadcast` is supplied by the React layer (it holds the Privy Solana signer);
 * it signs the sponsored tx, broadcasts it and waits for confirmation.
 */
export async function bridgeSolanaToBase(params: {
  connection: Connection;
  walletAddress: string;
  amount: string;
  recipientEvm: string;
  evmWallet: ConnectedWallet;
  signAndBroadcast: (tx: Transaction) => Promise<string>;
  destChain?: SupportedChain;
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
    destChain = "base",
  } = params;
  const destName = CHAIN_NAMES[destChain] ?? destChain;

  onStatus?.("Preparing Solana transfer…");
  const { sponsoredTx } = await prepareSolanaBurnTx({
    connection,
    walletAddress,
    amount,
    recipientEvm,
    destChain,
  });

  onStatus?.("Confirming on Solana…");
  const burnTxHash = await signAndBroadcast(sponsoredTx);

  // Irreversible from here, so make it known before anything else can fail.
  await recordConsolidationBurn({
    burnTxHash,
    sourceChain: "solana",
    destChain,
    amountUsdc: amount,
  });

  onStatus?.(`Burn confirmed! Moving funds onto ${destName}…`);
  const attestation = await waitForBridgeAttestation(
    burnTxHash,
    "solana",
    params.timeoutMs ?? 20 * 60_000,
  );
  // The burn is recorded, so the user can finish it from the Claim card.
  if (!attestation) throw new Error(FUNDS_IN_TRANSIT_MESSAGE);

  let mintTxHash: string | undefined = attestation.mintTxHash;
  if (!mintTxHash && attestation.attestation && attestation.messageBytes) {
    mintTxHash = await deliverOnEvmChain(
      evmWallet,
      attestation.messageBytes,
      attestation.attestation,
      destChain,
      onStatus,
    );
  }

  // Only a real hash proves delivery; see bridgeAndDeliver.
  if (!isPlaceholderHash(mintTxHash)) await clearConsolidationBurn(burnTxHash);

  return { burnTxHash, mintTxHash };
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
  /**
   * Platform fee, sent to the treasury in the SAME transaction as the transfer — so the two
   * confirm together, matching how the EVM rails batch the fee into one user operation.
   */
  platformFee?: { usdc: string; treasury: string };
}): Promise<Transaction> {
  const { connection, senderAddress, recipientAddress, amount, platformFee } = params;
  const senderPubKey = new PublicKey(senderAddress);
  const recipientPubKey = new PublicKey(recipientAddress);

  const senderAta = getAssociatedTokenAddressSync(
    SOLANA_USDC_MINT,
    senderPubKey,
  );
  const recipientAta = getAssociatedTokenAddressSync(
    SOLANA_USDC_MINT,
    recipientPubKey,
  );

  const tx = new Transaction();

  const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
  if (!recipientAtaInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        senderPubKey,
        recipientAta,
        recipientPubKey,
        SOLANA_USDC_MINT,
      ),
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
      6,
    ),
  );

  if (platformFee) {
    const treasuryPubKey = new PublicKey(platformFee.treasury);
    const treasuryAta = getAssociatedTokenAddressSync(SOLANA_USDC_MINT, treasuryPubKey, true);

    // The treasury's token account may not exist yet — create it here rather than letting the
    // transfer fail, which would take the user's send down with it.
    const treasuryAtaInfo = await connection.getAccountInfo(treasuryAta);
    if (!treasuryAtaInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          senderPubKey,
          treasuryAta,
          treasuryPubKey,
          SOLANA_USDC_MINT,
        ),
      );
    }

    tx.add(
      createTransferCheckedInstruction(
        senderAta,
        SOLANA_USDC_MINT,
        treasuryAta,
        senderPubKey,
        BigInt(Math.round(parseFloat(platformFee.usdc) * 1_000_000)),
        6,
      ),
    );
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = senderPubKey;

  return tx;
}
