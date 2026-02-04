/**
 * Repositories Module
 *
 * Centralized exports for all database repositories.
 */

// User
export {
  findUserByEmail,
  findUserById,
  markOnboardingComplete,
  updateUser,
  upsertUser,
  userExistsByEmail
} from './userRepository';

// Balance
export {
  creditBalance,
  debitBalance,
  getBalance,
  lockBalance,
  releaseLockedBalance,
  unlockBalance
} from './balanceRepository';
export type { BalanceInfo } from './balanceRepository';

// Transfer
export {
  cancelTransfer,
  createTransfer,
  expireOldTransfers,
  findPendingClaimsForEmail,
  findTransferByClaimTokenHash,
  findTransferById,
  getAllUserTransfers,
  getTransfersByRecipient,
  getTransfersBySender,
  markTransferClaimed,
  markTransferCompleted
} from './transferRepository';
export type { CreateTransferParams } from './transferRepository';

// Withdrawal
export {
  createWithdrawal,
  expireUnverifiedWithdrawals,
  findWithdrawalById,
  findWithdrawalByPaycrestOrderId,
  findWithdrawalByVerificationToken,
  getWithdrawalsByUser,
  markWithdrawalVerified,
  updateWithdrawalStatus,
  updateWithdrawalStatusByPaycrestId
} from './withdrawalRepository';
export type { CreateWithdrawalParams } from './withdrawalRepository';

// Webhook
export {
  getUnprocessedEvents,
  isEventProcessed,
  markEventProcessed,
  storeWebhookEvent
} from './webhookRepository';

// Audit
export { AUDIT_ACTIONS, createAuditLog } from './auditRepository';
export type { AuditAction, AuditLogEntry } from './auditRepository';

// OTP Log
export {
  countRecentFailedAttempts,
  getRecentOtpLogs,
  isLockedOut,
  logOtpAttempt
} from './otpLogRepository';
export type { OtpLogEntry } from './otpLogRepository';

