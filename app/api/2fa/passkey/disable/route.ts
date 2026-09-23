/**
 * Remove every passkey on the account.
 *
 * Identity from the session and a PIN authorisation bound to the passkey control — see
 * lib/security/security-change.ts. This route previously took an email in the body and
 * trusted it, so anyone could strip anyone's passkeys with a single unauthenticated POST.
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/adminClient";
import {
  authorizeSecurityChange,
  securityChangeError,
} from "@/lib/security/security-change";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let email: string;
  try {
    const { authorization } = await req.json().catch(() => ({}));
    ({ email } = await authorizeSecurityChange({ control: "passkey", authorization }));
  } catch (err) {
    const { status, error } = securityChangeError(err);
    return NextResponse.json({ error }, { status });
  }

  try {
    const { data: profile } = await supabaseAdmin
      .from("user_profiles")
      .select("webauthn_credentials, totp_enabled")
      .eq("email", email)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ error: "No profile found." }, { status: 404 });
    }

    const credentials = Array.isArray(profile.webauthn_credentials)
      ? profile.webauthn_credentials
      : [];

    if (credentials.length === 0) {
      return NextResponse.json({ error: "No passkey to remove." }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("user_profiles")
      .update({
        webauthn_credentials: [],
        // Verification stays on only if the authenticator app is still paired. Removing the
        // last factor must not leave the flag claiming a protection that no longer exists.
        two_fa_enabled: profile.totp_enabled || false,
      })
      .eq("email", email);

    if (error) {
      console.error("[2FA/Passkey] failed to remove:", error.message);
      return NextResponse.json({ error: "Could not remove that." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[2FA/Passkey] disable failed:", error);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
