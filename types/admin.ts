import { Database } from './database';

export type TransactionType = 'transfer' | 'deposit' | 'withdrawal';

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

export type AdminTransaction = AdminTransfer | AdminDeposit | AdminWithdrawal;

export type WebhookLog = Database['public']['Tables']['webhook_events']['Row'];
export type AuditLog = Database['public']['Tables']['audit_logs']['Row'];

export type AdminLog = WebhookLog | AuditLog;
