import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
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
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const email = searchParams.get("email");

    let userId: string | null = null;

    if (email) {
      const { supabaseAdmin } = await import("@/lib/supabase/adminClient");
      const { data } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("email", email.toLowerCase())
        .maybeSingle();
      userId = data?.id ?? null;
    }

    if (!userId) {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      userId = user?.id ?? null;
    }

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
