import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { upsertKycVerification, getUserKycStatus } from "@/lib/kyc";

export const runtime = "nodejs";

/**
 * POST /api/kyc/start
 *
 * Called when the user clicks "Start Verification" in the KycModal.
 * Updates the user's KYC status to "pending" (meaning they opened the link).
 */
export async function POST() {
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

    const existing = await getUserKycStatus(userId);

    // Only transition to pending if status is not_started or already pending
    if (existing.status === "not_started" || existing.status === "pending") {
      await upsertKycVerification({
        userId,
        diditSessionId: existing.diditSessionId || undefined,
        status: "pending",
      });
    }

    return NextResponse.json({ success: true, status: "pending" });
  } catch (error) {
    console.error("[KYC Start] Error marking verification as started:", error);
    return NextResponse.json(
      { error: "Failed to update status" },
      { status: 500 },
    );
  }
}
