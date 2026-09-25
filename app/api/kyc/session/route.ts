import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import {
  createVerificationSession,
  getUserKycStatus,
  upsertKycVerification,
} from "@/lib/kyc";

export const runtime = "nodejs";

/**
 * POST /api/kyc/session
 *
 * Creates a Didit KYC verification session for the authenticated user.
 * Returns the session URL to redirect/embed in the frontend.
 *
 * Idempotent: if the user already has an active (non-declined) session,
 * returns the existing session URL rather than creating a duplicate.
 */
export async function POST() {
  try {
    // ── Identity from the session ───────────────────────────────────────────
    //
    // This took an email from the body and fell back to Supabase Auth — which the rest of the
    // app does not use, so in practice the email WAS the credential. KYC state governs how
    // much a user may withdraw before verifying.
    //
    // ensureUserRecord rather than requireUserId: somebody can reach verification before a
    // `users` row exists, and refusing there would block the step that creates it.
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

    // ── 2. Check for an existing active session ────────────────────────────
    const existing = await getUserKycStatus(userId);
    if (
      existing.diditSessionId &&
      existing.status !== "declined" &&
      existing.status !== "not_started"
    ) {
      // Session exists and is active — caller should re-use the Didit URL.
      // We can't regenerate the URL from our DB so we tell the client to
      // create a fresh one (Didit will idempotently return the existing
      // session if vendor_data matches).
      console.log(
        `[KYC Session] User ${userId} already has session ${existing.diditSessionId} (${existing.status})`,
      );
    }

    // ── 3. Create session with Didit ───────────────────────────────────────
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
    const session = await createVerificationSession({
      vendorData: userId,
      callback: `${appUrl}/dashboard/settings`,
    });

    // ── 4. Persist the session record ──────────────────────────────────────
    const initialStatus = existing?.status && existing.status !== "not_started"
      ? existing.status
      : "not_started";

    await upsertKycVerification({
      userId,
      diditSessionId: session.sessionId,
      vendorData: userId,
      status: initialStatus,
    });

    console.log(
      `[KYC Session] Created session ${session.sessionId} for user ${userId}`,
    );

    return NextResponse.json({
      sessionId: session.sessionId,
      sessionUrl: session.sessionUrl,
      status: session.status,
    });
  } catch (error) {
    console.error("[KYC Session] Error creating session:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to create KYC session",
      },
      { status: 500 },
    );
  }
}
