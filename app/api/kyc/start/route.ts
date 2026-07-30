import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { upsertKycVerification, getUserKycStatus } from "@/lib/kyc";

export const runtime = "nodejs";

/**
 * POST /api/kyc/start
 *
 * Called when the user clicks "Start Verification" in the KycModal.
 * Updates the user's KYC status to "pending" (meaning they opened the link).
 */
export async function POST(req: Request) {
  try {
    let email: string | null = null;
    try {
      const body = await req.json();
      email = body.email || null;
    } catch {
      // Body empty or invalid JSON
    }

    let userId: string | null = null;
    if (email) {
      const { ensureUserInDatabase } = await import("@/lib/supabase/users");
      userId = await ensureUserInDatabase(email);
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
