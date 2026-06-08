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

// In-memory challenge storage (in production, use Redis or similar)
const challengeStore = new Map<string, { challenge: string; email: string }>();

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

      // Store challenge for verification
      const challengeId = crypto.randomUUID();
      challengeStore.set(challengeId, {
        challenge: options.challenge,
        email,
      });

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

      const storedData = challengeStore.get(challengeId);
      if (!storedData || storedData.email !== email) {
        return NextResponse.json(
          { error: "Session expired. Please try again." },
          { status: 400 },
        );
      }

      // Verify registration
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

      // Clean up challenge
      challengeStore.delete(challengeId);

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
