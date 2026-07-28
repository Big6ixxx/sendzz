/**
 * KYC Module — Public API
 *
 * Re-exports all public symbols from the KYC library.
 * Import from this file rather than from individual modules.
 */

// Limits configuration
export { KYC_LIMITS, getBindingPeriod, type KycLimitPeriod } from "./limits";

// Didit API client
export {
  createVerificationSession,
  getSessionStatus,
  verifyWebhookSignature,
  isWebhookTimestampValid,
  normalizeDiditStatus,
  type DiditSessionStatus,
  type DiditCreateSessionParams,
  type DiditCreateSessionResult,
} from "./didit-client";

// Supabase data access
export {
  getKycStatusAndTotals,
  getUserKycStatus,
  upsertKycVerification,
  getUserIdByVendorData,
  getUserIdBySessionId,
  type KycStatus,
  type KycVerification,
  type TransactionTotals,
  type KycStatusAndTotals,
} from "./supabase-kyc";

// Guard (server-only)
export {
  kycGuard,
  isKycApproved,
  type KycGuardResult,
  type KycGuardReason,
} from "./guard";
