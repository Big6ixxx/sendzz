"use server";

/**
 * KYC Guard — Withdrawal Enforcement
 *
 * Call `kycGuard()` before initiating a withdrawal. It answers one question: may this user take
 * this amount off the platform, or must they verify their identity first?
 *
 * That is the only limit in the product. Deposits are uncapped, and sending — on-chain, by
 * email, or in a batch — never calls this at all. See lib/kyc/limits.ts for why.
 *
 * ─── Usage ────────────────────────────────────────────────────────────────
 *
 *   const guard = await kycGuard(user.id, amountUsdc);
 *   if (!guard.allowed) {
 *     return NextResponse.json(
 *       { error: guard.message, reason: guard.reason },
 *       { status: 403 }
 *     );
 *   }
 */

import { getUserKycStatus, getWithdrawnAgainstAllowance } from "./supabase-kyc";
import {
  UNVERIFIED_WITHDRAWAL_ALLOWANCE,
  exceedsUnverifiedAllowance,
  remainingUnverifiedAllowance,
} from "./limits";

// ─── Types ──────────────────────────────────────────────────────────────────

/** The only reason a movement is ever refused: the user must verify to continue. */
export type KycGuardReason = "kyc_required";

export type KycGuardResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: KycGuardReason;
      message: string;
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
 * Enforces the unverified withdrawal allowance for a given user and amount.
 *
 * This is the only limit in the product. It applies to withdrawals and nothing else — deposits
 * are uncapped and sends never call this — so the guard's whole job is: has this unverified user
 * already spent their allowance, and would this withdrawal take them past it?
 *
 * @param userIdOrEmail - The authenticated user's Supabase UUID or email address
 * @param transactionAmountUsdc - The USDC amount of the proposed withdrawal
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
    // No user record yet, so nothing has been withdrawn — the whole allowance is available and
    // only an oversized first withdrawal can fail here.
    if (exceedsUnverifiedAllowance(0, transactionAmountUsdc)) {
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

  const kyc = await getUserKycStatus(resolvedUserId);

  // A verified user has no allowance to spend, so there is nothing left to ask the database.
  if (kyc.status === "approved") {
    return { allowed: true };
  }

  const used = await getWithdrawnAgainstAllowance(resolvedUserId);
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

  return { allowed: true };
}

/**
 * Lightweight check: returns whether the user has completed KYC. Useful for UI gating.
 */
export async function isKycApproved(userIdOrEmail: string): Promise<boolean> {
  const resolvedUserId = await resolveSupabaseUserId(userIdOrEmail);
  if (!resolvedUserId) return false;
  const kyc = await getUserKycStatus(resolvedUserId);
  return kyc.status === "approved";
}

/**
 * Server Action for the client-side pre-check, so the withdraw screen can warn before a user
 * fills in bank details rather than after. The binding check is `kycGuard` on the server.
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
