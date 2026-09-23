import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
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
