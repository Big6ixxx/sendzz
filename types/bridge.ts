/**
 * A burn that has not been minted on its destination chain yet.
 *
 * CCTP attestations never expire, so these stay claimable indefinitely — the row
 * exists so the user can find and finish a bridge whose claim leg failed (a closed
 * tab, a rejected signature, a destination that wasn't ready to receive).
 */
export interface PendingBridgeClaim {
  id: string;
  burnTxHash: string;
  sourceChain: string;
  destChain: string;
  amount: number;
  createdAt: string;
  /** True once Circle has attested the burn and the claim can be submitted. */
  ready: boolean;
  /** Present only when `ready` — the payload the destination chain needs. */
  messageBytes?: string;
  attestation?: string;
}
