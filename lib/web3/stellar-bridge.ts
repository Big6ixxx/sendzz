import { ConnectedWallet } from "@privy-io/react-auth";
import { executeReceiveMessage } from "./bridge-actions";
import { SupportedChain, CHAIN_NAMES } from "@/lib/circle/gateway";
import type { StellarSource } from "./routing";

/**
 * Bridge USDC from the user's Privy Stellar wallet to their EVM smart account on Base.
 *
 * Flow:
 *   1. Calls the NextJS route `/api/stellar/bridge` to trigger the Soroban approve and CCTP burn transactions.
 *   2. Polls `/api/bridge/status` until the burn is attested by Circle.
 *   3. Submits the EVM mint transaction to Base via `executeReceiveMessage`.
 *
 * Returns without `mintTxHash` when delivery did not finish in time; the burn stays claimable.
 */
export async function bridgeStellarToBase(params: {
  walletId: string;
  senderAddress: string;
  amount: string;
  recipientEvm: string;
  evmWallet: ConnectedWallet;
  destChain?: SupportedChain;
  onStatus?: (status: string) => void;
  timeoutMs?: number;
}): Promise<{ burnTxHash: string; mintTxHash?: string }> {
  const { walletId, senderAddress, amount, recipientEvm, evmWallet, onStatus, destChain = "base" } =
    params;

  onStatus?.(`Submitting Stellar bridge transaction to ${CHAIN_NAMES[destChain]}…`);
  const res = await fetch("/api/stellar/bridge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      walletId,
      senderAddress,
      recipientAddress: recipientEvm,
      amount,
      destChain,
      // Never billed: every caller is a bridge the user did not ask for, moving funds so a
      // transfer, send or withdrawal can happen. Only the bridge screen charges, and it calls
      // the route directly. See lib/fees/platform-fees.ts.
      chargeFee: false,
      // Every caller is a step inside a transfer, a send or a withdrawal, which is recorded in
      // its own right. So the burn goes to `consolidation_claims`, not history: it still gets
      // a Claim button if delivery stalls, and is deleted once delivered, so nothing is
      // counted twice.
      consolidation: true,
      // No second PIN: the user approved the transfer, send or withdrawal this is part of
      // moments ago, and stopping mid-flow would interrupt something they are not watching,
      // after money has started moving. The route still requires their session and wallet.
      internal: true,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to submit Stellar bridge transaction");
  }

  const { burnTxHash } = (await res.json()) as { burnTxHash: string };

  onStatus?.(`Burn confirmed! Minting on ${CHAIN_NAMES[destChain]}…`);
  // Long enough for a fast-finality attestation plus the mint. The caller still verifies the
  // funds landed before spending them (see consolidateFundsToChain).
  const deadline = Date.now() + (params.timeoutMs ?? 120_000);
  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `/api/bridge/status?txHash=${burnTxHash}&sourceChain=stellar`,
      );
      if (res.ok) {
        const data = await res.json();
        if (data.status === "complete") {
          let mintTxHash: string | undefined = data.mintTxHash;
          if (!mintTxHash && data.attestation && data.messageBytes) {
            onStatus?.(`Finalizing delivery on ${CHAIN_NAMES[destChain]}…`);
            mintTxHash = await executeReceiveMessage(
              evmWallet,
              data.messageBytes,
              data.attestation,
              destChain,
            ).catch((err) => {
              console.warn("[bridgeStellarToBase] client mint notice:", err);
              return undefined;
            });
          }
          return { burnTxHash, mintTxHash };
        }
      }
    } catch (err) {
      console.warn("[bridgeStellarToBase] status poll error:", err);
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }

  // Not delivered yet. The burn is recorded as a pending claim, so the user can finish it from
  // the Claim card; the caller confirms arrival before spending (consolidateFundsToChain).
  return { burnTxHash };
}

/**
 * The user's Stellar balance as a funding source for `consolidateFundsToChain`: bridged to
 * their own EVM account, at no charge, when the other networks don't cover a payment.
 * Undefined when there is nothing on Stellar to draw from.
 */
export function stellarSourceFor(
  wallet: { walletId?: string; address?: string } | null | undefined,
  balance: number | undefined,
  evmWallet: ConnectedWallet | undefined,
): StellarSource | undefined {
  const walletId = wallet?.walletId;
  const address = wallet?.address;
  if (!walletId || !address || !evmWallet || !((balance ?? 0) > 0)) return undefined;
  return {
    walletId,
    address,
    balance: balance!,
    bridgeToBase: async (amount, recipientEvm, onStatus, destChain) => {
      await bridgeStellarToBase({ walletId, senderAddress: address, amount, recipientEvm, evmWallet, destChain, onStatus });
    },
  };
}
