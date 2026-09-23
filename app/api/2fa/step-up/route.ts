/**
 * Proving a second factor before a security setting is weakened.
 *
 * --- Why not the PIN ----------------------------------------------------------
 *
 * Turning off a protection used to be confirmed with the transaction PIN. That was the wrong
 * secret: the PIN already authorises every outgoing payment, so accepting it here too means
 * one secret satisfies both the payment check AND the check that guards it. Someone who reads
 * it over a shoulder gets the money and the ability to switch off everything that would have
 * stopped them.
 *
 * So weakening a protection costs one of the protections — an emailed code, the authenticator
 * app, or a passkey. Never the PIN.
 *
 * Email is the universal fallback. Every Sendzz account signs in with one, so a user with no
 * authenticator and no passkey is never locked out of their own settings — and a mailbox is a
 * genuinely different thing to hold than four digits, which is the whole point.
 *
 * --- Shape --------------------------------------------------------------------
 *
 *   send            email a code
 *   verify-email    spend that code            -> authorization
 *   verify-totp     a code from the app        -> authorization
 *   passkey-options begin a passkey challenge
 *   verify-passkey  finish it                  -> authorization
 *
 * Every branch requires a session first, and the email is always the session's own — the body
 * never names whose settings are being changed.
 */

import crypto from "node:crypto";
import { NextResponse } from "next/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";

import { requireUserId } from "@/lib/auth/session";
import { decrypt } from "@/lib/encryption";
import { sendEmail } from "@/lib/email/sendEmail";
import { securityCodeTemplate } from "@/lib/email/templates";
import { consumeEmailCode, issueEmailCode } from "@/lib/security/email-code";
import { mintAuthorization } from "@/lib/security/transaction-auth";
import { supabaseAdmin } from "@/lib/supabase/adminClient";
import { verifyTOTPToken } from "@/lib/totp";
import { resolveRp, generatePasskeyAuthenticationOptions, verifyPasskeyAuthentication } from "@/lib/webauthn";

export const runtime = "nodejs";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const CONTROLS = ["two_fa", "threshold", "totp", "passkey", "pin"] as const;
type Control = (typeof CONTROLS)[number];

function isControl(value: unknown): value is Control {
  return typeof value === "string" && (CONTROLS as readonly string[]).includes(value);
}

interface StoredCredential {
  credentialID: string;
  credentialPublicKey: string;
  counter: number;
  transports: ("ble" | "hybrid" | "internal" | "nfc" | "usb")[];
}

/** What the caller gets once a factor has actually been proven. */
async function mint(userId: string, sessionId: string, control: Control) {
  const { token, expiresAt } = await mintAuthorization({
    userId,
    sessionId,
    purpose: "security_change",
    // The same shape lib/security/security-change.ts checks against, so a token minted to
    // unpair an authenticator cannot be spent removing a passkey.
    payload: { destination: control, amount: 0 },
  });
  return NextResponse.json({ success: true, authorization: token, expiresAt });
}

export async function POST(req: Request) {
  let session: Awaited<ReturnType<typeof requireUserId>>;
  try {
    session = await requireUserId();
  } catch {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const { email, userId } = session;

  // The device session out of the signed token, so an authorisation minted in one browser
  // cannot be spent from another.
  const { getVerifiedIdentity } = await import("@/lib/auth/session");
  const identity = await getVerifiedIdentity();
  if (!identity) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { action, control, code, codeId, challengeId, credential } = body;

  if (!isControl(control)) {
    return NextResponse.json({ error: "Unknown setting." }, { status: 400 });
  }

  try {
    // ── Email ──────────────────────────────────────────────────────────────
    if (action === "send") {
      const { id, code: emailed } = await issueEmailCode({
        userEmail: email,
        purpose: "security_change",
      });

      await sendEmail({
        to: email,
        subject: "Confirm a change to your Sendzz security settings",
        html: securityCodeTemplate(emailed, control),
      });

      return NextResponse.json({ success: true, codeId: id });
    }

    if (action === "verify-email") {
      const ok = await consumeEmailCode({
        id: String(codeId ?? ""),
        code: String(code ?? ""),
        userEmail: email,
        purpose: "security_change",
      });
      if (!ok) {
        return NextResponse.json(
          { error: "That code is wrong or has expired." },
          { status: 401 },
        );
      }
      return mint(userId, identity.sessionId, control);
    }

    // ── Authenticator app ──────────────────────────────────────────────────
    if (action === "verify-totp") {
      const { data: profile } = await supabaseAdmin
        .from("user_profiles")
        .select("totp_secret, totp_enabled")
        .eq("email", email)
        .maybeSingle();

      if (!profile?.totp_secret || !profile.totp_enabled) {
        return NextResponse.json(
          { error: "No authenticator app is set up." },
          { status: 400 },
        );
      }

      const key = process.env.TOTP_ENCRYPTION_KEY;
      if (!key) {
        console.error("[StepUp] TOTP_ENCRYPTION_KEY is not configured.");
        return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
      }

      let secret: string;
      try {
        secret = decrypt(profile.totp_secret, key);
      } catch {
        console.error("[StepUp] could not decrypt the stored TOTP secret.");
        return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
      }

      if (!verifyTOTPToken(String(code ?? ""), secret)) {
        return NextResponse.json({ error: "That code is not right." }, { status: 401 });
      }
      return mint(userId, identity.sessionId, control);
    }

    // ── Passkey ────────────────────────────────────────────────────────────
    if (action === "passkey-options") {
      const options = await generatePasskeyAuthenticationOptions(req.headers.get("origin"));
      const id = crypto.randomUUID();

      const { error } = await supabaseAdmin.from("webauthn_challenges").insert({
        id,
        challenge: options.challenge,
        email,
        type: "authentication",
        used: false,
        expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
      });

      if (error) {
        console.error("[StepUp] could not store the passkey challenge:", error.message);
        return NextResponse.json({ error: "Could not start that." }, { status: 500 });
      }

      return NextResponse.json({ options, challengeId: id });
    }

    if (action === "verify-passkey") {
      const { data: stored } = await supabaseAdmin
        .from("webauthn_challenges")
        .select("id, challenge, email, used, expires_at")
        .eq("id", String(challengeId ?? ""))
        .maybeSingle();

      // Bound to this account and spent once: a challenge issued for somebody else, replayed,
      // or left to go stale is all the same answer.
      if (
        !stored ||
        stored.used ||
        stored.email !== email ||
        new Date(stored.expires_at) < new Date()
      ) {
        return NextResponse.json({ error: "That attempt expired. Try again." }, { status: 401 });
      }

      await supabaseAdmin.from("webauthn_challenges").update({ used: true }).eq("id", stored.id);

      const { data: profile } = await supabaseAdmin
        .from("user_profiles")
        .select("webauthn_credentials")
        .eq("email", email)
        .maybeSingle();

      const credentials = Array.isArray(profile?.webauthn_credentials)
        ? (profile.webauthn_credentials as unknown as StoredCredential[])
        : [];

      if (credentials.length === 0) {
        return NextResponse.json({ error: "No passkey is set up." }, { status: 400 });
      }

      const rp = resolveRp(req.headers.get("origin"));
      let verified = false;

      // The browser may return an id that does not match how we stored it, so every
      // credential is tried rather than looked up.
      for (const cred of credentials) {
        try {
          const result = await verifyPasskeyAuthentication(
            credential as AuthenticationResponseJSON,
            stored.challenge,
            {
              credentialID: Buffer.from(cred.credentialID, "base64"),
              credentialPublicKey: Buffer.from(cred.credentialPublicKey, "base64"),
              counter: cred.counter,
              transports: cred.transports,
            },
            rp.origin,
            rp.rpID,
          );
          if (result.verified) {
            verified = true;
            break;
          }
        } catch {
          continue;
        }
      }

      if (!verified) {
        return NextResponse.json({ error: "That passkey was not accepted." }, { status: 401 });
      }
      return mint(userId, identity.sessionId, control);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong.";
    // issueEmailCode throws its own user-safe message for the resend cooldown.
    return NextResponse.json({ error: message }, { status: 429 });
  }
}
