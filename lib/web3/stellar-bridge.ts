import { ConnectedWallet } from "@privy-io/react-auth";
import { executeReceiveMessage } from "./bridge-actions";
import { SupportedChain, CHAIN_NAMES } from "@/lib/circle/gateway";

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
  destChain?: SupportedChain;
  onStatus?: (status: string) => void;
  timeoutMs?: number;
  /**
   * True when this bridge is a step inside a withdrawal rather than a transfer the user chose
   * to make. Such a bridge must not become history: it is held in `consolidation_claims` until
   * delivered and then deleted, so a withdrawal is recorded once and counted once.
   */
  consolidation?: boolean;
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
      chargeFee: true,
      consolidation: params.consolidation === true,
      // Always internal, and not the same claim as `consolidation` above.
      //
      // `consolidation` decides where the burn is RECORDED — scratch table or history — and
      // only the withdrawal path sets it. `internal` decides whether the route demands its own
      // transaction PIN, and the answer here is always no, because nothing reaches this
      // function as a top-level user action: the bridge screen calls /api/stellar/bridge
      // directly and passes its own authorisation. Every caller of this helper is a step
      // inside a transfer, a send or a withdrawal that the user already approved with a PIN
      // moments earlier, and stopping mid-flow to ask again would interrupt an operation they
      // are not watching — after money has started moving.
      internal: true,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to submit Stellar bridge transaction");
  }

  const { burnTxHash } = (await res.json()) as { burnTxHash: string };

  onStatus?.(`Burn confirmed! Minting on ${CHAIN_NAMES[destChain]}…`);
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
