import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/adminClient";
import { generateTOTPSecret, generateTOTPUri } from "@/lib/totp";
import { encrypt } from "@/lib/encryption";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const encryptionKey = process.env.TOTP_ENCRYPTION_KEY;
    if (!encryptionKey) {
      console.error("TOTP_ENCRYPTION_KEY not configured");
      return NextResponse.json(
        { error: "Something went wrong. Please try again." },
        { status: 500 },
      );
    }

    // Generate TOTP secret
    const secret = generateTOTPSecret();

    // Generate QR code URI
    const qrUri = generateTOTPUri(email, secret);

    // Encrypt secret before storing
    const encryptedSecret = encrypt(secret, encryptionKey);

    console.log("Setting up TOTP for email:", email);

    // Fetch user ID from users table
    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", email)
      .single();

    console.log("User lookup result:", { user, userError });

    if (userError || !user) {
      console.error("User not found in users table:", userError);
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    console.log("Found user with ID:", user.id);

    // Check if profile already exists
    const { data: existingProfile, error: checkError } = await supabaseAdmin
      .from("user_profiles")
      .select("id, email")
      .eq("email", email)
      .maybeSingle();

    console.log("Profile check result:", { existingProfile, checkError });

    if (existingProfile) {
      // Update existing profile
      console.log("Updating existing profile with ID:", existingProfile.id);
      const { error: updateError } = await supabaseAdmin
        .from("user_profiles")
        .update({
          totp_secret: encryptedSecret,
        })
        .eq("id", existingProfile.id);

      if (updateError) {
        console.error("Update failed:", updateError);
        return NextResponse.json(
          { error: "Something went wrong. Please try again." },
          { status: 500 },
        );
      }
    } else {
      // Profile doesn't exist - create it automatically with TOTP data
      console.log("No profile found, creating profile automatically with TOTP");
      const { error: insertError } = await supabaseAdmin
        .from("user_profiles")
        .insert({
          id: user.id,
          email,
          onboarding_completed: true,
          two_fa_enabled: false,
          two_fa_threshold: 500,
          totp_secret: encryptedSecret,
        });

      if (insertError) {
        console.error("Auto-create profile failed:", insertError);
        return NextResponse.json(
          { error: "Something went wrong. Please try again." },
          { status: 500 },
        );
      }
    }

    console.log("TOTP setup successful for email:", email);

    return NextResponse.json({
      secret,
      qrUri,
    });
  } catch {
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
