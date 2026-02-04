/**
 * Audit Log Repository
 *
 * Database operations for security audit logging.
 */

import { createAdminClient } from '@/lib/supabase/server';
import type { Json } from '@/types/database';

export interface AuditLogEntry {
  userId?: string;
  action: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

/**
 * Create an audit log entry
 */
export async function createAuditLog(entry: AuditLogEntry): Promise<boolean> {
  const supabase = createAdminClient();
  const { error } = await supabase.from('audit_logs').insert({
    user_id: entry.userId,
    action: entry.action,
    metadata_json: (entry.metadata || {}) as Json,
    ip: entry.ip,
    user_agent: entry.userAgent,
  });

  if (error) {
    console.error('[AuditRepo] create error:', error);
    return false;
  }
  return true;
}

// ===========================================
// AUDIT ACTIONS CONSTANTS
// ===========================================

export const AUDIT_ACTIONS = {
  // Auth
  LOGIN_ATTEMPT: 'auth.login_attempt',
  LOGIN_SUCCESS: 'auth.login_success',
  LOGIN_FAILED: 'auth.login_failed',
  LOGOUT: 'auth.logout',

  // Transfers
  TRANSFER_INITIATED: 'transfer.initiated',
  TRANSFER_CLAIMED: 'transfer.claimed',
  TRANSFER_CANCELLED: 'transfer.cancelled',
  TRANSFER_EXPIRED: 'transfer.expired',

  // Withdrawals
  WITHDRAWAL_INITIATED: 'withdrawal.initiated',
  WITHDRAWAL_VERIFIED: 'withdrawal.verified',
  WITHDRAWAL_COMPLETED: 'withdrawal.completed',
  WITHDRAWAL_FAILED: 'withdrawal.failed',

  // Balance
  BALANCE_CREDITED: 'balance.credited',
  BALANCE_DEBITED: 'balance.debited',

  // Webhook
  WEBHOOK_RECEIVED: 'webhook.received',
  WEBHOOK_PROCESSED: 'webhook.processed',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
