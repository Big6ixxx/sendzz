import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/adminClient";
import {
  generatePasskeyRegistrationOptions,
  verifyPasskeyRegistration,
} from "@/lib/webauthn";

interface StoredCredential {
  credentialID: string;
  credentialPublicKey: string;
  counter: number;
  transports: ("ble" | "hybrid" | "internal" | "nfc" | "usb")[];
}

// Challenge TTL: 5 minutes
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email, action, credential } = body;

    if (!email) {
      return NextResponse.json(
        { error: "Please provide your email address" },
        { status: 400 },
      );
    }

    if (action === "generate-options") {
      // Generate registration options
      const { data: profile } = await supabaseAdmin
        .from("user_profiles")
        .select("webauthn_credentials")
        .eq("email", email)
        .single();

      const existingCredentials = Array.isArray(profile?.webauthn_credentials)
        ? (profile.webauthn_credentials as unknown as StoredCredential[]).map(
            (cred) => ({
              credentialID: Buffer.from(cred.credentialID, "base64"),
              credentialPublicKey: Buffer.from(
                cred.credentialPublicKey,
                "base64",
              ),
              counter: cred.counter,
              transports: cred.transports,
            }),
          )
        : [];

      const options = await generatePasskeyRegistrationOptions(
        email,
        existingCredentials,
      );

      // Persist challenge in Supabase so it survives across serverless instances
      const challengeId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();

      const { error: insertError } = await supabaseAdmin
        .from("webauthn_challenges")
        .insert({
          id: challengeId,
          challenge: options.challenge,
          email,
          type: "registration",
          used: false,
          expires_at: expiresAt,
        });

      if (insertError) {
        console.error("Failed to store passkey challenge:", insertError);
        return NextResponse.json(
          { error: "Failed to initiate registration. Please try again." },
          { status: 500 },
        );
      }

      return NextResponse.json({
        options,
        challengeId,
      });
    }

    if (action === "verify-registration") {
      const { challengeId } = body;

      if (!challengeId) {
        return NextResponse.json(
          { error: "Session expired. Please try again." },
          { status: 400 },
        );
      }

      // Fetch challenge from Supabase
      const { data: storedData, error: fetchError } = await supabaseAdmin
        .from("webauthn_challenges")
        .select("*")
        .eq("id", challengeId)
        .eq("email", email)
        .eq("type", "registration")
        .eq("used", false)
        .single();

      if (fetchError || !storedData) {
        return NextResponse.json(
          { error: "Session expired. Please try again." },
          { status: 400 },
        );
      }

      // Check expiry
      if (new Date(storedData.expires_at) < new Date()) {
        await supabaseAdmin
          .from("webauthn_challenges")
          .delete()
          .eq("id", challengeId);
        return NextResponse.json(
          { error: "Session expired. Please try again." },
          { status: 400 },
        );
      }

      // Mark challenge as used immediately to prevent replay attacks
      await supabaseAdmin
        .from("webauthn_challenges")
        .update({ used: true })
        .eq("id", challengeId);

      // Verify registration — pass the configured origin from env
      const verification = await verifyPasskeyRegistration(
        credential,
        storedData.challenge,
      );

      if (!verification.verified) {
        return NextResponse.json(
          { error: "Registration failed. Please try again." },
          { status: 400 },
        );
      }

      // Store the new credential
      const { registrationInfo } = verification;

      const newCredential = {
        credentialID: Buffer.from(registrationInfo.credential.id).toString(
          "base64",
        ),
        credentialPublicKey: Buffer.from(
          registrationInfo.credential.publicKey,
        ).toString("base64"),
        counter: 0,
        transports: registrationInfo.credential.transports || [],
      };

      // Replace all credentials with the new one (only keep the latest)
      const updatedCredentials = [newCredential];

      await supabaseAdmin
        .from("user_profiles")
        .update({
          webauthn_credentials: updatedCredentials,
          two_fa_enabled: true, // Enable 2FA when passkey is registered
        })
        .eq("email", email);

      // Clean up the used challenge
      await supabaseAdmin
        .from("webauthn_challenges")
        .delete()
        .eq("id", challengeId);

      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { error: "Invalid request. Please try again." },
      { status: 400 },
    );
  } catch (error) {
    console.error("Passkey registration error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
