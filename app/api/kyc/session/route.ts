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
 */
export async function POST(req: Request) {
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
    // Waiting on an admin: a new session would replace the one under review on the record, and
    // its review would no longer count. The modal waits on that one instead.
    if (existing.status === "in_review" && existing.diditSessionId) {
      return NextResponse.json({ inReview: true, status: "in_review" });
    }

    // Already verified: nothing to start, unless the ID they verified with lacks what this
    // deposit currency needs (depositIdentityGap). Then they verify again. The approved session
    // stays on the record until the new one is approved (applyReverification), so an abandoned
    // attempt costs the user nothing.
    if (existing.status === "approved") {
      const { depositCurrency } = (await req.json().catch(() => ({}))) as { depositCurrency?: string };
      if (!depositCurrency) return NextResponse.json({ alreadyVerified: true, status: "approved" });
      const { reverificationUnderWay, verifiedIdentityOf } = await import("@/lib/kyc/verified-identity");
      const { depositIdentityGap } = await import("@/lib/ramp/onramp-kyc");
      // A failed lookup is not a reason to verify again: that would send a verified user through
      // KYC because Didit was briefly unreachable.
      let identity;
      try {
        identity = await verifiedIdentityOf({ id: userId });
      } catch (err) {
        console.error(`[KYC Session] Could not read the verified identity for ${userId}:`, err);
        return NextResponse.json(
          { error: "We couldn't check your verification just now. Please try again in a moment." },
          { status: 503 },
        );
      }
      if (identity && !depositIdentityGap(identity, depositCurrency)) {
        return NextResponse.json({ alreadyVerified: true, status: "approved" });
      }
      // What is already under way only saves a session; not knowing it is no reason to stop the
      // user verifying, so a failed lookup goes on to a new session.
      const underWay = existing.diditSessionId
        ? await reverificationUnderWay(userId, existing.diditSessionId).catch((err) => {
            console.warn(`[KYC Session] Could not list ${userId}'s sessions; starting a new one:`, err);
            return null;
          })
        : null;
      // A new ID already sent and waiting on an admin: wait on that one, not a third session.
      if (underWay?.inReview) {
        return NextResponse.json({ inReview: true, status: "in_review", sessionId: underWay.inReview.sessionId, reverify: true });
      }
      // One already started and not finished: continue it, rather than opening (and paying for)
      // another and leaving the first link orphaned.
      if (underWay?.open?.url) {
        return NextResponse.json({ sessionId: underWay.open.sessionId, sessionUrl: underWay.open.url, reverify: true });
      }
    }

    // ── 3. Create session with Didit ───────────────────────────────────────
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
    const session = await createVerificationSession({
      vendorData: userId,
      callback: `${appUrl}/dashboard/settings`,
    });

    // Re-verifying: the new session is not recorded until approved (see above).
    if (existing.status === "approved") {
      const { forgetReverification } = await import("@/lib/kyc/verified-identity");
      if (existing.diditSessionId) forgetReverification(userId, existing.diditSessionId);
      console.log(`[KYC Session] Created re-verification session ${session.sessionId} for approved user ${userId}`);
      return NextResponse.json({
        sessionId: session.sessionId,
        sessionUrl: session.sessionUrl,
        status: session.status,
        reverify: true,
      });
    }

    // ── 4. Persist the session record ──────────────────────────────────────
    // The new session's own status, not the last one's: copying a previous "declined" or
    // "in_review" onto it would make that same outcome on the new session look like no change,
    // and its email (or the admins' review alert) would never be sent.
    await upsertKycVerification({
      userId,
      diditSessionId: session.sessionId,
      vendorData: userId,
      status: "not_started",
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
