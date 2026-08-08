"use server";

/**
 * KYC Guard — Transaction Enforcement Layer
 *
 * Call `kycGuard()` at the start of any API route that initiates a transaction
 * (transfers, withdrawals). It atomically checks:
 *   1. The user's KYC verification status
 *   2. Their rolling transaction totals (daily / weekly / monthly)
 *
 * Returns a `KycGuardResult` indicating whether the transaction is allowed
 * and, if not, why and what action the user must take.
 *
 * ─── Usage ────────────────────────────────────────────────────────────────
 *
 *   const guard = await kycGuard(user.id, transactionAmountUsdc);
 *   if (!guard.allowed) {
 *     return NextResponse.json(
 *       { error: guard.message, reason: guard.reason, kycUrl: guard.kycUrl },
 *       { status: 403 }
 *     );
 *   }
 */

import { getKycStatusAndTotals } from "./supabase-kyc";
import { KYC_LIMITS, getBindingPeriod } from "./limits";

// ─── Types ──────────────────────────────────────────────────────────────────

export type KycGuardReason =
  | "kyc_required"     // user must complete KYC to unlock higher limits
  | "limit_exceeded";  // user is verified but hit a compliance ceiling

export type KycGuardResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: KycGuardReason;
      message: string;
      /** Period that is binding (daily / weekly / monthly). */
      bindingPeriod?: "daily" | "weekly" | "monthly";
      /** How much the user has spent in the binding period. */
      periodTotal?: number;
      /** The limit that was exceeded. */
      periodLimit?: number;
    };

/**
 * Resolves a user's Supabase UUID whether given a UUID or an email address.
 */
export async function resolveSupabaseUserId(identifier: string): Promise<string | null> {
  if (!identifier) return null;
  const { supabaseAdmin } = await import("@/lib/supabase/adminClient");

  if (identifier.includes("@")) {
    const { data } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", identifier.toLowerCase())
      .maybeSingle();
    return data?.id ?? null;
  }

  const { data } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("id", identifier)
    .maybeSingle();

  return data?.id ?? identifier;
}

// ─── Main Guard ──────────────────────────────────────────────────────────────

/**
 * Enforces KYC and transaction limits for a given user and transaction amount.
 *
 * @param userIdOrEmail - The authenticated user's Supabase UUID or email address
 * @param transactionAmountUsdc - The USDC amount of the proposed transaction
 */
export async function kycGuard(
  userIdOrEmail: string,
  transactionAmountUsdc: number,
): Promise<KycGuardResult> {
  if (transactionAmountUsdc <= 0) {
    return { allowed: true };
  }

  const resolvedUserId = await resolveSupabaseUserId(userIdOrEmail);

  if (!resolvedUserId) {
    // User has no record in users table yet — enforce default UNVERIFIED limits
    const limits = KYC_LIMITS.UNVERIFIED;
    const bindingPeriod = getBindingPeriod(
      transactionAmountUsdc,
      { daily: 0, weekly: 0, monthly: 0 },
      limits,
    );
    if (bindingPeriod !== null) {
      return {
        allowed: false,
        reason: "kyc_required",
        message:
          `This transaction would exceed your ${bindingPeriod} limit of $${limits[bindingPeriod]} USD. ` +
          `Complete identity verification to unlock higher limits.`,
        bindingPeriod,
        periodTotal: 0,
        periodLimit: limits[bindingPeriod],
      };
    }
    return { allowed: true };
  }

  const { kyc, totals } = await getKycStatusAndTotals(resolvedUserId);

  const isApproved = kyc.status === "approved";
  const limits = isApproved ? KYC_LIMITS.VERIFIED : KYC_LIMITS.UNVERIFIED;

  const bindingPeriod = getBindingPeriod(transactionAmountUsdc, totals, limits);

  if (bindingPeriod === null) {
    // Transaction fits within all windows — allow
    return { allowed: true };
  }

  const periodTotal = totals[bindingPeriod];
  const periodLimit = limits[bindingPeriod];

  if (!isApproved) {
    // User is unverified and would exceed a limit
    return {
      allowed: false,
      reason: "kyc_required",
      message:
        `This transaction would exceed your ${bindingPeriod} limit of $${periodLimit} USD. ` +
        `Complete identity verification to unlock higher limits.`,
      bindingPeriod,
      periodTotal,
      periodLimit,
    };
  }

  // User is verified but hit a compliance ceiling (Infinity by default)
  return {
    allowed: false,
    reason: "limit_exceeded",
    message:
      `This transaction would exceed your verified ${bindingPeriod} limit of $${periodLimit} USD. ` +
      `Please contact support to increase your limit.`,
    bindingPeriod,
    periodTotal,
    periodLimit,
  };
}

/**
 * Lightweight check: returns whether the user has completed KYC.
 * Useful for UI gating without computing full totals.
 */
export async function isKycApproved(userIdOrEmail: string): Promise<boolean> {
  const resolvedUserId = await resolveSupabaseUserId(userIdOrEmail);
  if (!resolvedUserId) return false;
  const { kyc } = await getKycStatusAndTotals(resolvedUserId);
  return kyc.status === "approved";
}

/**
 * Server Action for client-side pre-checks.
 * Accepts transaction amount and optional user email to evaluate kycGuard.
 */
export async function checkKycLimitAction(
  transactionAmountUsdc: number,
  accessToken?: string,
): Promise<KycGuardResult> {
  // Identity comes from the session. It used to accept an email, which meant a caller whose
  // own limit was exhausted could simply name a fresh account and be measured against theirs.
  const { requireUser } = await import("@/lib/auth/session");
  const { email } = await requireUser(accessToken);
  return kycGuard(email, transactionAmountUsdc);
}

