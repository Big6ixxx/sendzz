/**
 * A burn that has not been minted on its destination chain yet.
 *
 * The row exists so the user can find and finish a bridge whose claim leg failed — a closed tab,
 * a rejected signature, a destination that wasn't ready to receive. The burn is on-chain and
 * irreversible, so the claim stays owed however long it takes.
 *
 * A FAST transfer's attestation does expire, though: it is signed before source finality and is
 * only valid until a given destination block, after which every claim reverts permanently. Those
 * are re-attested automatically rather than being left unclaimable — see reattestIfExpired.
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
