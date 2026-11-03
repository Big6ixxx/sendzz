/**
 * The shape of one row of activity, shared by every list, modal, receipt and detail page.
 * The list that used to live here was replaced by components/dashboard/HistoryList.
 */

export type ActivityType =
  | 'sent'
  | 'received'
  | 'deposit'
  | 'withdrawal'
  | 'bridge'
  | 'security';

export interface Activity {
  id: string;
  type: ActivityType;
  amount: number;
  status: string;
  timestamp: string;
  details: string;
  asset: string;
  txHash?: string;
  senderEmail?: string;
  note?: string;
  fiatAmount?: number;
  fiatCurrency?: string;
  exchangeRate?: number;
  /** ISO timestamp — present on outgoing pending_claim transfers */
  expiresAt?: string;
  sourceChain?: string;
  /** Bridges: the destination chain funds were minted on. */
  destChain?: string;
  mintTxHash?: string;
  /** Withdrawals: true when funds were bridged/consolidated onto sourceChain first. */
  consolidated?: boolean;
  /** Ramp provider that settled a deposit/withdrawal (e.g. "bitnob", "paycrest", "onchain"). */
  provider?: string;
  /** The provider's own order/reference id, for support + tracing. */
  providerOrderId?: string;
  /** Provider-specific reference kept in metadata (e.g. a Bitnob payout quote id). */
  providerRef?: string;
  /** Settlement/deposit network when it differs from (or refines) sourceChain. */
  settlementNetwork?: string;
  /** Last time the record changed — useful for pending/failed diagnostics. */
  updatedAt?: string;
}
