import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import {
  RATE_LIMITS,
  checkRateLimit,
  rateLimitResponse,
} from "@/lib/security/rate-limit";
import { verifyOTP } from "@/lib/twoFactor";

export async function POST(req: Request) {
  try {
    const { otp_id, otp_code } = await req.json();
    // ── Identity from the session, never the body ───────────────────────────
    //
    // This route used to take an email and trust it. The code is six digits and the endpoint
    // was open, so anyone could grind them against somebody else's pending transaction.
    let email: string;
    try {
      ({ email } = await requireUser());
    } catch {
      return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    }

    // Six digits is 10^6, which is not a large number when the attempts are free.
    {
      const limit = await checkRateLimit(RATE_LIMITS.codeVerify, email);
      if (!limit.allowed) return rateLimitResponse(limit);
    }


    if (!email || !otp_id || !otp_code) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    await verifyOTP(otp_id, otp_code, email);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("[2FA Verify] Error:", error);
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }
}
