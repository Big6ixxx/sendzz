"use client";

/**
 * Solana → Base bridge helpers (Circle CCTP V2).
 *
 * Solana uses a different execution path from EVM (Privy embedded Solana wallet, a
 * Circle DCW fee-payer for gas, SPL USDC). This module makes Solana usable as a
 * *spendable source*: bridge its USDC onto Base, after which the normal EVM routing
 * spends it. `prepareSolanaBurnTx` is shared with ChainBridgeModule; `bridgeSolanaToBase`
 * is the awaitable end-to-end used by auto-consolidation.
 */

import { Buffer } from "buffer";
import { recordConsolidationBurn } from "./record-burn";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  buildDepositForBurnTx,
  SOLANA_CCTP_DOMAIN,
} from "@/lib/circle/solana-gateway";
import {
  fetchCctpFees,
  CCTP_DOMAINS,
  type SupportedChain,
} from "@/lib/circle/gateway";
import { executeReceiveMessage } from "./bridge-actions";
import type { ConnectedWallet } from "@privy-io/react-auth";

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
  const {
    connection,
    walletAddress,
    amount,
    recipientEvm,
    destChain = "base",
  } = params;

  // CCTP fee (non-fatal — fall back to 0).
  let feeSubunits = 0n;
  try {
    const [whole, frac = ""] = amount.split(".");
    const amtSubunits = BigInt(whole + (frac + "000000").slice(0, 6));
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
    new PublicKey(walletAddress),
    amount,
    recipientEvm,
    feeSubunits,
    destChain,
  );

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

  const sponsoredTx = Transaction.from(
    Buffer.from(sponsoredTransaction, "base64"),
  );
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

  onStatus?.("Preparing Solana transfer…");
  const { sponsoredTx } = await prepareSolanaBurnTx({
    connection,
    walletAddress,
    amount,
    recipientEvm,
  });

  onStatus?.("Confirming on Solana…");
  const burnTxHash = await signAndBroadcast(sponsoredTx);

  // Irreversible from here. Nothing on this path recorded the burn at all before, so a Solana
  // consolidation that failed to deliver left USDC burned with nothing pointing at it.
  await recordConsolidationBurn({
    burnTxHash,
    sourceChain: "solana",
    destChain: "base",
    amountUsdc: params.amount,
  });

  onStatus?.("Burn confirmed! Consolidating funds onto Base…");
  const deadline = Date.now() + (params.timeoutMs ?? 20_000); // 20-second max client wait
  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `/api/bridge/status?txHash=${burnTxHash}&sourceChain=solana`,
      );
      if (res.ok) {
        const data = await res.json();
        if (data.status === "complete") {
          let mintTxHash: string | undefined = data.mintTxHash;
          if (!mintTxHash && data.attestation && data.messageBytes) {
            onStatus?.("Finalizing consolidation on Base…");
            mintTxHash = await executeReceiveMessage(
              evmWallet,
              data.messageBytes,
              data.attestation,
              "base",
            ).catch((err) => {
              console.warn("[bridgeSolanaToBase] client mint notice:", err);
              return undefined;
            });
          }
          return { burnTxHash, mintTxHash };
        }
      }
    } catch (err) {
      console.warn("[bridgeSolanaToBase] status poll error:", err);
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }

  // Handoff to background completion if client polling deadline reached
  onStatus?.("Bridge processing on-chain. Finalizing delivery in background…");
  fetch("/api/bridge/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      burnTxHash,
      sourceChain: "solana",
      destChain: "base",
    }),
  }).catch(() => {});

  return { burnTxHash };
}
