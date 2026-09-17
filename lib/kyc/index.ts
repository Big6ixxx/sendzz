/**
 * KYC Module — Public API
 *
 * Re-exports all public symbols from the KYC library.
 * Import from this file rather than from individual modules.
 */

// Limits configuration — one rule: the unverified withdrawal allowance.
export {
  UNVERIFIED_WITHDRAWAL_ALLOWANCE,
  UNVERIFIED_ALLOWANCE_START,
  exceedsUnverifiedAllowance,
  remainingUnverifiedAllowance,
} from "./limits";

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
  getUserKycStatus,
  upsertKycVerification,
  getUserIdByVendorData,
  getUserIdBySessionId,
  type KycStatus,
  type KycVerification,
} from "./supabase-kyc";

// Guard (server-only)
export {
  kycGuard,
  isKycApproved,
  type KycGuardResult,
  type KycGuardReason,
} from "./guard";
