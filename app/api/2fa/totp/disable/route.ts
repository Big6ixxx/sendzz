/**
 * Unpair the authenticator app.
 *
 * Identity from the session and a PIN authorisation bound to the TOTP control — see
 * lib/security/security-change.ts. This route previously took an email in the body and
 * trusted it, so anyone could unpair anyone's authenticator with a single unauthenticated
 * POST.
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
    ({ email } = await authorizeSecurityChange({ control: "totp", authorization }));
  } catch (err) {
    const { status, error } = securityChangeError(err);
    return NextResponse.json({ error }, { status });
  }

  try {
    const { error } = await supabaseAdmin
      .from("user_profiles")
      .update({
        totp_secret: null,
        totp_enabled: false,
        totp_verified_at: null,
      })
      .eq("email", email);

    if (error) {
      console.error("[2FA/TOTP] failed to disable:", error.message);
      return NextResponse.json({ error: "Could not turn that off." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
