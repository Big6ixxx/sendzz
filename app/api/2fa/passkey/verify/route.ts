import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/adminClient";
import {
  generatePasskeyAuthenticationOptions,
  verifyPasskeyAuthentication,
} from "@/lib/webauthn";

interface StoredCredential {
  credentialID: string;
  credentialPublicKey: string;
  counter: number;
  transports: ("ble" | "hybrid" | "internal" | "nfc" | "usb")[];
}

// In-memory challenge storage (in production, use Redis or similar)
const challengeStore = new Map<
  string,
  { challenge: string; email: string; used: boolean }
>();

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
      // Generate authentication options
      const { data: profile } = await supabaseAdmin
        .from("user_profiles")
        .select("webauthn_credentials")
        .eq("email", email)
        .single();

      if (
        !profile ||
        !Array.isArray(profile.webauthn_credentials) ||
        profile.webauthn_credentials.length === 0
      ) {
        return NextResponse.json(
          { error: "No passkey found. Please set up a passkey first." },
          { status: 400 },
        );
      }

      const options = await generatePasskeyAuthenticationOptions();

      // Store challenge for verification
      const challengeId = crypto.randomUUID();
      challengeStore.set(challengeId, {
        challenge: options.challenge,
        email,
        used: false,
      });

      return NextResponse.json({
        options,
        challengeId,
      });
    }

    if (action === "verify-authentication") {
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

      if (storedData.used) {
        return NextResponse.json(
          { error: "Session expired. Please try again." },
          { status: 400 },
        );
      }

      // Get the authenticator from the database
      const { data: profile } = await supabaseAdmin
        .from("user_profiles")
        .select("webauthn_credentials")
        .eq("email", email)
        .single();

      if (
        !profile ||
        !Array.isArray(profile.webauthn_credentials) ||
        profile.webauthn_credentials.length === 0
      ) {
        return NextResponse.json(
          { error: "No passkey found. Please set up a passkey first." },
          { status: 400 },
        );
      }

      // Find the authenticator that was used
      const credentialsList = Array.isArray(profile.webauthn_credentials)
        ? (profile.webauthn_credentials as unknown as StoredCredential[])
        : [];

      // Try to verify against all stored credentials since the browser might return a different ID
      let verification = null;
      let matchedAuthenticator = null;

      for (const cred of credentialsList) {
        try {
          const authenticatorData = {
            credentialID: Buffer.from(cred.credentialID, "base64"),
            credentialPublicKey: Buffer.from(
              cred.credentialPublicKey,
              "base64",
            ),
            counter: cred.counter,
            transports: cred.transports,
          };
          const result = await verifyPasskeyAuthentication(
            credential,
            storedData.challenge,
            authenticatorData,
          );
          if (result.verified) {
            verification = result;
            matchedAuthenticator = cred;
            break;
          }
        } catch {
          // Try next credential
          continue;
        }
      }

      if (!verification || !matchedAuthenticator) {
        return NextResponse.json(
          { error: "Authentication failed. Please try again." },
          { status: 400 },
        );
      }

      // Update the counter
      const { authenticationInfo } = verification;

      const credentialsList2 = Array.isArray(profile.webauthn_credentials)
        ? (profile.webauthn_credentials as unknown as StoredCredential[])
        : [];

      const updatedCredentials = credentialsList2.map(
        (cred: StoredCredential) => {
          if (cred.credentialID === matchedAuthenticator.credentialID) {
            return {
              ...cred,
              counter: authenticationInfo.newCounter,
            };
          }
          return cred;
        },
      );

      const { error: updateError } = await supabaseAdmin
        .from("user_profiles")
        .update({
          webauthn_credentials: updatedCredentials as any,
        })
        .eq("email", email);

      if (updateError) {
        return NextResponse.json(
          { error: "Failed to update credentials" },
          { status: 500 },
        );
      }

      // Mark challenge as used to prevent replay attacks
      storedData.used = true;

      // Clean up challenge
      challengeStore.delete(challengeId);

      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { error: "Invalid request. Please try again." },
      { status: 400 },
    );
  } catch {
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
