import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/adminClient";
import { verifyTOTPToken } from "@/lib/totp";
import { decrypt } from "@/lib/encryption";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email, token } = body;

    if (!email || !token) {
      return NextResponse.json(
        { error: "Email and token are required" },
        { status: 400 },
      );
    }

    const encryptionKey = process.env.TOTP_ENCRYPTION_KEY;
    if (!encryptionKey) {
      return NextResponse.json(
        { error: "Something went wrong. Please try again." },
        { status: 500 },
      );
    }

    // Fetch user's encrypted TOTP secret
    const { data: profile, error: fetchError } = await supabaseAdmin
      .from("user_profiles")
      .select("totp_secret")
      .eq("email", email)
      .single();

    if (fetchError) {
      console.error("Database error fetching user profile:", fetchError);
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!profile) {
      console.error("No profile found for email:", email);
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!profile.totp_secret) {
      console.error("No TOTP secret found for user:", email);
      return NextResponse.json({ error: "TOTP not set up" }, { status: 400 });
    }

    // Decrypt the TOTP secret
    let secret;
    try {
      secret = decrypt(profile.totp_secret, encryptionKey);
    } catch (decryptError) {
      console.error("Failed to decrypt TOTP secret:", decryptError);
      return NextResponse.json(
        { error: "Something went wrong. Please try again." },
        { status: 500 },
      );
    }

    // Verify TOTP token
    const isValid = verifyTOTPToken(token, secret);

    if (!isValid) {
      return NextResponse.json({ error: "Invalid code" }, { status: 400 });
    }

    // Enable TOTP after first successful verification
    const { error: updateError } = await supabaseAdmin
      .from("user_profiles")
      .update({
        totp_enabled: true,
        totp_verified_at: new Date().toISOString(),
        two_fa_enabled: true, // Also enable general 2FA
      })
      .eq("email", email);

    if (updateError) {
      return NextResponse.json(
        { error: "Something went wrong. Please try again." },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
