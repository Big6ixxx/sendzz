import { ConnectedWallet } from "@privy-io/react-auth";
import { executeReceiveMessage } from "./bridge-actions";

/**
 * Bridge USDC from the user's Privy Stellar wallet to their EVM smart account on Base.
 *
 * Flow:
 *   1. Calls the NextJS route `/api/stellar/bridge` to trigger the Soroban approve and CCTP burn transactions.
 *   2. Polls `/api/bridge/status` until the burn is attested by Circle.
 *   3. Submits the EVM mint transaction to Base via `executeReceiveMessage`.
 */
export async function bridgeStellarToBase(params: {
  walletId: string;
  senderAddress: string;
  amount: string;
  recipientEvm: string;
  evmWallet: ConnectedWallet;
  onStatus?: (status: string) => void;
  timeoutMs?: number;
}): Promise<{ burnTxHash: string; mintTxHash?: string }> {
  const { walletId, senderAddress, amount, recipientEvm, evmWallet, onStatus } =
    params;

  onStatus?.("Submitting Stellar bridge transaction…");
  const res = await fetch("/api/stellar/bridge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      walletId,
      senderAddress,
      recipientAddress: recipientEvm,
      amount,
      destChain: "base",
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to submit Stellar bridge transaction");
  }

  const { burnTxHash } = (await res.json()) as { burnTxHash: string };

  onStatus?.("Burn confirmed on-chain! Delivering on Base…");
  const deadline = Date.now() + (params.timeoutMs ?? 20_000); // 20-second max client wait
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
            onStatus?.("Delivering on Base…");
            mintTxHash = await executeReceiveMessage(
              evmWallet,
              data.messageBytes,
              data.attestation,
              "base",
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

  // Handoff to background completion if client polling deadline reached
  onStatus?.("Bridge processing on-chain. Finalizing delivery in background…");
  fetch("/api/bridge/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      burnTxHash,
      sourceChain: "stellar",
      destChain: "base",
    }),
  }).catch(() => {});

  return { burnTxHash };
}
