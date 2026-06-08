import { NextResponse } from "next/server";
import { generateAndSend2FA } from "@/lib/twoFactor";

export async function POST(req: Request) {
  try {
    const { userEmail, actionType, payload } = await req.json();

    if (!userEmail || !actionType || !payload) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    const id = await generateAndSend2FA(userEmail, actionType, payload);

    return NextResponse.json({ success: true, otp_id: id });
  } catch (error: unknown) {
    console.error("[2FA Send] Error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
