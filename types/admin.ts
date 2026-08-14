import { Database } from './database';

export type TransactionType = 'transfer' | 'deposit' | 'withdrawal' | 'bridge';

export type AdminTransfer = Database['public']['Tables']['transfers']['Row'] & {
  tx_type: 'transfer';
};

export type AdminDeposit = Database['public']['Tables']['deposits']['Row'] & {
  tx_type: 'deposit';
  amount: number | string;
};

export type AdminWithdrawal = Database['public']['Tables']['withdrawals']['Row'] & {
  tx_type: 'withdrawal';
  amount: number | string;
};

export type AdminBridge = Database['public']['Tables']['bridge_transactions']['Row'] & {
  tx_type: 'bridge';
  status: string;
};

export type AdminTransaction = AdminTransfer | AdminDeposit | AdminWithdrawal | AdminBridge;

/** Reporting windows offered across the admin surface. */
export type AdminDateRange = '7d' | '30d' | '6m' | '1y' | 'all';

export const ADMIN_DATE_RANGE_LABELS: Record<AdminDateRange, string> = {
  '7d': '7 Days',
  '30d': '1 Month',
  '6m': '6 Months',
  '1y': '1 Year',
  all: 'All Time',
};

/** One account's full admin view — profile, KYC, lifetime totals, filtered transactions. */
export interface AdminUserDetail {
  user: Database['public']['Tables']['users']['Row'];
  kyc: {
    status: string;
    diditSessionId: string | null;
    updatedAt: string | null;
    /** Deep link into the Didit console for this session, when there is one. */
    consoleUrl: string | null;
  };
  /** Lifetime, settled-only — independent of the transaction date filter. */
  totals: {
    deposits: number;
    withdrawals: number;
    sent: number;
    received: number;
    bridged: number;
    volume: number;
  };
  transactions: AdminTransaction[];
}

export type WebhookLog = Database['public']['Tables']['webhook_events']['Row'];
export type AuditLog = Database['public']['Tables']['audit_logs']['Row'];

export type AdminLog = WebhookLog | AuditLog;
