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

import { getKycStatusAndTotals, getWithdrawnAgainstAllowance } from "./supabase-kyc";
import {
  KYC_LIMITS,
  UNVERIFIED_WITHDRAWAL_ALLOWANCE,
  exceedsUnverifiedAllowance,
  getBindingPeriod,
  remainingUnverifiedAllowance,
} from "./limits";

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
      /** Unverified withdrawal allowance: how much of it is already spent. */
      allowanceUsed?: number;
      /** Unverified withdrawal allowance: how much is left, in USD. */
      allowanceRemaining?: number;
      /** The allowance itself, so callers never restate the number. */
      allowanceTotal?: number;
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
 * What kind of movement is being checked.
 *
 * Only a withdrawal spends the unverified allowance.
 *
 * A transfer to another Sendzz user does not take money off the platform — the recipient meets
 * the same allowance when they cash out — so capping both would charge the same 100 twice and
 * stop an unverified user paying a friend. A deposit is money arriving; charging a withdrawal
 * allowance for it would mean topping up made it harder to take anything out.
 *
 * Defaults to "withdrawal" so a caller that forgets to say gets the stricter treatment.
 */
export type TransactionKind = "withdrawal" | "transfer" | "deposit";

/** Wording for a user who has spent some, but not all, of their allowance. */
function allowanceMessage(used: number, amount: number): string {
  const left = remainingUnverifiedAllowance(used);
  if (left <= 0) {
    return (
      `You have used your $${UNVERIFIED_WITHDRAWAL_ALLOWANCE} withdrawal allowance. ` +
      `Verify your identity to withdraw any amount.`
    );
  }
  return (
    `This withdrawal of $${amount} would take you past your $${UNVERIFIED_WITHDRAWAL_ALLOWANCE} ` +
    `allowance — you have $${left} left. Verify your identity to withdraw any amount.`
  );
}

/**
 * Enforces KYC and transaction limits for a given user and transaction amount.
 *
 * @param userIdOrEmail - The authenticated user's Supabase UUID or email address
 * @param transactionAmountUsdc - The USDC amount of the proposed transaction
 * @param kind - Whether this is a withdrawal (spends the allowance) or a transfer
 */
export async function kycGuard(
  userIdOrEmail: string,
  transactionAmountUsdc: number,
  kind: TransactionKind = "withdrawal",
): Promise<KycGuardResult> {
  if (transactionAmountUsdc <= 0) {
    return { allowed: true };
  }

  const resolvedUserId = await resolveSupabaseUserId(userIdOrEmail);

  if (!resolvedUserId) {
    // No user record yet, so nothing has been withdrawn — the whole allowance is available and
    // only an oversized first withdrawal can fail here.
    if (
      kind === "withdrawal" &&
      exceedsUnverifiedAllowance(0, transactionAmountUsdc)
    ) {
      return {
        allowed: false,
        reason: "kyc_required",
        message: allowanceMessage(0, transactionAmountUsdc),
        allowanceUsed: 0,
        allowanceRemaining: UNVERIFIED_WITHDRAWAL_ALLOWANCE,
        allowanceTotal: UNVERIFIED_WITHDRAWAL_ALLOWANCE,
      };
    }
    return { allowed: true };
  }

  // Both reads at once. They are independent — one is the KYC row plus rolling totals, the
  // other a single sum — and running them in series put two round trips on the critical path
  // between tapping Get Quote and seeing the next screen.
  const [{ kyc, totals }, withdrawnSoFar] = await Promise.all([
    getKycStatusAndTotals(resolvedUserId),
    kind === "withdrawal"
      ? getWithdrawnAgainstAllowance(resolvedUserId)
      : Promise.resolve(0),
  ]);

  const isApproved = kyc.status === "approved";
  const limits = isApproved ? KYC_LIMITS.VERIFIED : KYC_LIMITS.UNVERIFIED;

  // ── The unverified withdrawal allowance ──────────────────────────────────
  //
  // Checked before the rolling ceilings because it is the rule that actually binds, and
  // because its message is the useful one: it tells the user how much they have left rather
  // than naming a window they have never come close to.
  if (!isApproved && kind === "withdrawal") {
    const used = withdrawnSoFar;
    if (exceedsUnverifiedAllowance(used, transactionAmountUsdc)) {
      return {
        allowed: false,
        reason: "kyc_required",
        message: allowanceMessage(used, transactionAmountUsdc),
        allowanceUsed: used,
        allowanceRemaining: remainingUnverifiedAllowance(used),
        allowanceTotal: UNVERIFIED_WITHDRAWAL_ALLOWANCE,
      };
    }
  }

  const bindingPeriod = getBindingPeriod(transactionAmountUsdc, totals, limits);

  if (bindingPeriod === null) {
    // Transaction fits within all windows — allow
    return { allowed: true };
  }

  const periodTotal = totals[bindingPeriod];
  const periodLimit = limits[bindingPeriod];

  if (!isApproved) {
    // Unreachable while UNVERIFIED is Infinity, and kept deliberately: it is the branch that
    // takes effect the moment a window is ever given a number again.
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
  kind: TransactionKind = "withdrawal",
): Promise<KycGuardResult> {
  // Identity comes from the session. It used to accept an email, which meant a caller whose
  // own limit was exhausted could simply name a fresh account and be measured against theirs.
  const { requireUser } = await import("@/lib/auth/session");
  const { email } = await requireUser(accessToken);
  return kycGuard(email, transactionAmountUsdc, kind);
}
