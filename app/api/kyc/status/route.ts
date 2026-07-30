import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { getKycStatusAndTotals } from "@/lib/kyc";
import { KYC_LIMITS } from "@/lib/kyc/limits";

export const runtime = "nodejs";

/**
 * GET /api/kyc/status
 *
 * Returns the authenticated user's KYC status and rolling transaction totals.
 * Used by the frontend to render the KYC banner, settings section, and
 * the LimitsMeter component.
 *
 * Response shape:
 * {
 *   kyc: { status, diditSessionId, updatedAt },
 *   totals: { daily, weekly, monthly },
 *   limits: { daily, weekly, monthly },      // from central config
 *   percentages: { daily, weekly, monthly }, // 0-100 for progress bars
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

    // ── 2. Fetch status + totals ───────────────────────────────────────────
    const { kyc, totals } = await getKycStatusAndTotals(userId);

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
    const activeLimits = isApproved
      ? KYC_LIMITS.VERIFIED
      : KYC_LIMITS.UNVERIFIED;

    // Compute percentages (cap at 100 to avoid visual overflow)
    const clamp = (v: number) => Math.min(100, Math.max(0, v));
    const pct = (used: number, limit: number) =>
      limit === Infinity || limit === 0 ? 0 : clamp((used / limit) * 100);

    const percentages = {
      daily: pct(totals.daily, activeLimits.daily),
      weekly: pct(totals.weekly, activeLimits.weekly),
      monthly: pct(totals.monthly, activeLimits.monthly),
    };

    return NextResponse.json({
      kyc: {
        status: kyc.status,
        diditSessionId: kyc.diditSessionId,
        updatedAt: kyc.updatedAt,
      },
      totals: {
        daily: totals.daily,
        weekly: totals.weekly,
        monthly: totals.monthly,
      },
      limits: {
        daily: activeLimits.daily === Infinity ? null : activeLimits.daily,
        weekly: activeLimits.weekly === Infinity ? null : activeLimits.weekly,
        monthly: activeLimits.monthly === Infinity ? null : activeLimits.monthly,
      },
      unverifiedLimits: {
        daily: KYC_LIMITS.UNVERIFIED.daily,
        weekly: KYC_LIMITS.UNVERIFIED.weekly,
        monthly: KYC_LIMITS.UNVERIFIED.monthly,
      },
      percentages,
    });
  } catch (error) {
    console.error("[KYC Status] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch KYC status" },
      { status: 500 },
    );
  }
}
