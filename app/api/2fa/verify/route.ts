import { NextResponse } from "next/server";
import { verifyOTP } from "@/lib/twoFactor";

export async function POST(req: Request) {
  try {
    const { userEmail, otp_id, otp_code } = await req.json();

    if (!userEmail || !otp_id || !otp_code) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    await verifyOTP(otp_id, otp_code, userEmail);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("[2FA Verify] Error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Invalid code";
    return NextResponse.json({ error: errorMessage }, { status: 400 });
  }
}
