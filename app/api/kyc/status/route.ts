import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { getUserKycStatus } from "@/lib/kyc";
import { getWithdrawnAgainstAllowance } from "@/lib/kyc/supabase-kyc";
import {
  UNVERIFIED_WITHDRAWAL_ALLOWANCE,
  remainingUnverifiedAllowance,
} from "@/lib/kyc/limits";

export const runtime = "nodejs";

/**
 * GET /api/kyc/status
 *
 * Returns the authenticated user's KYC status and how much of the unverified withdrawal
 * allowance they have spent. Read by the KYC banner, the settings section and LimitsMeter.
 *
 * Response shape:
 * {
 *   kyc: { status, diditSessionId, updatedAt },
 *   allowance: { total, used, remaining, percentage } | null,  // unverified users only
 * }
 */
export async function GET() {
  try {
    // ── Identity from the session ───────────────────────────────────────────
    //
    // This took an email from the request and fell back to Supabase Auth — which the rest of
    // the app does not use, so in practice the email WAS the credential. KYC state governs how
    // much a user may withdraw before verifying, so setting or reading it for an arbitrary
    // address is a compliance control operated from outside.
    //
    // ensureUserRecord rather than requireUserId: somebody can reach verification before a
    // `users` row exists, and refusing there would block the very step that creates it.
    let email: string;
    try {
      ({ email } = await requireUser());
    } catch {
      return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    }

    const { ensureUserRecord } = await import("@/lib/supabase/user-records");
    const userId = await ensureUserRecord(email);

    if (!userId) {
      return NextResponse.json({ error: "Email or user ID required" }, { status: 400 });
    }

    // ── 2. Fetch status ────────────────────────────────────────────────────
    const kyc = await getUserKycStatus(userId);

    // Live sync: if not approved/declined yet and session ID exists, check Didit API directly
    if (
      kyc.status !== "approved" &&
      kyc.status !== "declined" &&
      kyc.diditSessionId
    ) {
      try {
        const { getSessionStatus, normalizeDiditStatus } = await import(
          "@/lib/kyc/didit-client"
        );
        const { upsertKycVerification } = await import("@/lib/kyc/supabase-kyc");

        const rawDiditStatus = await getSessionStatus(kyc.diditSessionId);
        const normalized = normalizeDiditStatus(rawDiditStatus);

        if (normalized !== kyc.status) {
          console.log(
            `[KYC Status] Syncing status from Didit for user ${userId}: ${kyc.status} -> ${normalized} (Didit: ${rawDiditStatus})`,
          );
          await upsertKycVerification({
            userId,
            diditSessionId: kyc.diditSessionId,
            status: normalized,
          });
          kyc.status = normalized;
        }
      } catch (syncErr) {
        console.error("[KYC Status] Live sync with Didit failed:", syncErr);
      }
    }

    const isApproved = kyc.status === "approved";
    const clamp = (v: number) => Math.min(100, Math.max(0, v));

    // The only rule there is: a one-off withdrawal allowance. Null for a verified user, who has
    // none to spend. This endpoint also used to publish daily/weekly/monthly totals and ceilings
    // — the ceilings bound nobody and the totals were read by nothing, so both are gone.
    const used = isApproved
      ? 0
      : await getWithdrawnAgainstAllowance(userId);

    const allowance = isApproved
      ? null
      : {
          total: UNVERIFIED_WITHDRAWAL_ALLOWANCE,
          used,
          remaining: remainingUnverifiedAllowance(used),
          percentage: clamp((used / UNVERIFIED_WITHDRAWAL_ALLOWANCE) * 100),
        };

    return NextResponse.json({
      kyc: {
        status: kyc.status,
        diditSessionId: kyc.diditSessionId,
        updatedAt: kyc.updatedAt,
      },
      allowance,
    });
  } catch (error) {
    console.error("[KYC Status] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch KYC status" },
      { status: 500 },
    );
  }
}
