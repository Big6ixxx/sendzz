import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/adminClient";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json(
        { error: "Please provide your email address" },
        { status: 400 },
      );
    }

    // Get current credentials
    const { data: profile } = await supabaseAdmin
      .from("user_profiles")
      .select("webauthn_credentials, totp_enabled")
      .eq("email", email)
      .single();

    if (!profile) {
      return NextResponse.json(
        { error: "User profile not found" },
        { status: 404 },
      );
    }

    // Check if user has passkeys
    const credentials = Array.isArray(profile.webauthn_credentials)
      ? profile.webauthn_credentials
      : [];

    if (credentials.length === 0) {
      return NextResponse.json(
        { error: "No passkey found to disable" },
        { status: 400 },
      );
    }

    // Remove all passkey credentials
    await supabaseAdmin
      .from("user_profiles")
      .update({
        webauthn_credentials: [],
        // Only disable 2FA if TOTP is also not enabled
        two_fa_enabled: profile.totp_enabled || false,
      })
      .eq("email", email);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Passkey disable error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again later." },
      { status: 500 },
    );
  }
}
