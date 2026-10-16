"use client";

/**
 * Send a USDC payment on Solana with our fee payer paying the gas (and any new token account's
 * rent): prepare on the server, sign in the page, submit to the server, which signs as fee
 * payer, broadcasts and waits. See lib/solana/sponsor for why it is split this way.
 */

import { Buffer } from "buffer";
import { Transaction } from "@solana/web3.js";

/** Signs with the user's Privy Solana wallet; returns the signed transaction bytes. */
export type SolanaSign = (tx: Transaction) => Promise<Uint8Array>;

export interface SponsoredSendResult {
  txHash: string;
  /** Broadcast but not yet confirmed. It may well land — never offer a retry. */
  pending: boolean;
  /** Pending, and the server will write the history row itself once it confirms. */
  recordedByServer: boolean;
}

/**
 * Thrown for a refusal the server explained. The code leads the message so lib/errors/appErrors
 * can turn it into a sentence; `code` is there for callers that branch on it.
 */
export class SolanaSendError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`[${code}] ${message}`);
    this.name = "SolanaSendError";
  }
}

async function post(path: string, body: Record<string, unknown>) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof data.code === "string" ? data.code : `http_${res.status}`;
    const message = typeof data.error === "string" ? data.error : res.statusText;
    throw new SolanaSendError(code, message);
  }
  return data;
}

export async function sendSponsoredSolanaTx(params: {
  /** Built by lib/solana/usdc-transfer, sender as placeholder fee payer. */
  tx: Transaction;
  sign: SolanaSign;
  /** For off-ramp settlement: the server attaches the signature to this withdrawal on broadcast. */
  withdrawalOrderId?: string;
  /**
   * For a direct send: the history row, so the server can write it if the send is still
   * confirming when it answers — the page may be closed by the time it lands.
   */
  record?: { recipient: string; amount: number; note?: string };
  onStatus?: (status: string) => void;
}): Promise<SponsoredSendResult> {
  const { tx, sign, withdrawalOrderId, record, onStatus } = params;

  onStatus?.("Preparing your transfer on Solana…");
  const prepared = await post("/api/solana/sponsor", {
    transaction: tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64"),
  });
  const preparedTx = Transaction.from(Buffer.from(String(prepared.transaction), "base64"));

  const signed = await sign(preparedTx);

  onStatus?.("Confirming on Solana…");
  const submitted = await post("/api/solana/submit", {
    transaction: Buffer.from(signed).toString("base64"),
    ...(withdrawalOrderId ? { withdrawalOrderId } : {}),
    ...(record ? { record } : {}),
  });

  return {
    txHash: String(submitted.txHash),
    pending: submitted.pending === true,
    recordedByServer: submitted.recordedByServer === true,
  };
}

/**
 * Wait, from the page, for a send the server reported as still confirming. Resolves true once
 * it confirms, false if it failed or did not show within `timeoutMs`.
 */
export async function waitForSolanaSignature(
  connection: {
    getSignatureStatus: (
      sig: string,
      cfg: { searchTransactionHistory: boolean },
    ) => Promise<{ value: { err: unknown; confirmationStatus?: string } | null }>;
  },
  signature: string,
  timeoutMs = 120_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value } = await connection
      .getSignatureStatus(signature, { searchTransactionHistory: true })
      .catch(() => ({ value: null }));
    if (value?.err) return false;
    if (value?.confirmationStatus === "confirmed" || value?.confirmationStatus === "finalized") {
      return true;
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  return false;
}
