import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import {
  RATE_LIMITS,
  checkRateLimit,
  rateLimitResponse,
} from "@/lib/security/rate-limit";
import { generateAndSend2FA } from "@/lib/twoFactor";

export async function POST(req: Request) {
  try {
    const { actionType, payload } = await req.json();
    // ── Identity from the session, never the body ───────────────────────────
    //
    // This route used to take an email and trust it, so anyone could flood anyone's inbox
    // with codes — and probe which addresses have accounts by watching which calls
    // succeeded.
    let email: string;
    try {
      ({ email } = await requireUser());
    } catch {
      return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    }

    // Each of these lands in somebody's inbox. Unbounded, it is a way to make Sendzz spam a
    // user until they stop trusting our mail.
    {
      const limit = await checkRateLimit(RATE_LIMITS.codeSend, email);
      if (!limit.allowed) return rateLimitResponse(limit);
    }


    if (!email || !actionType || !payload) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    const id = await generateAndSend2FA(email, actionType, payload);

    return NextResponse.json({ success: true, otp_id: id });
  } catch (error: unknown) {
    console.error("[2FA Send] Error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
