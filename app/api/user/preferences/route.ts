/**
 * The signed-in user's own security preferences.
 *
 * Both halves used to key on an email taken from the request and trust it. That made the GET
 * an oracle for anyone's security posture — whether they have TOTP, which passkeys are
 * registered, what their verification threshold is — and the POST a way to turn somebody
 * else's verification off, or raise their threshold past every withdrawal they would ever
 * make. Neither needed a session.
 *
 * Identity now comes from the session on both. Beyond that the POST splits by what the change
 * DOES, which is the distinction that matters:
 *
 *   weakening   two_fa_enabled, two_fa_threshold — these decide whether a large withdrawal is
 *               challenged at all, so they additionally spend a PIN authorisation. A session
 *               alone is not enough: somebody at an unlocked laptop has one, and turning the
 *               checks off is the first thing they would do.
 *   cosmetic    two_fa_nudge_dismissed_at — "stop showing me this banner". Worth nothing to an
 *               attacker, and demanding a PIN to dismiss a prompt would train people to enter
 *               it without reading.
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/adminClient";
import { requireUser } from "@/lib/auth/session";
import {
  authorizeSecurityChange,
  securityChangeError,
} from "@/lib/security/security-change";

export const runtime = "nodejs";

export async function GET() {
  let email: string;
  try {
    ({ email } = await requireUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("user_profiles")
      .select(
        "two_fa_enabled, two_fa_threshold, two_fa_nudge_dismissed_at, totp_enabled, webauthn_credentials",
      )
      .eq("email", email)
      .maybeSingle();

    // No profile row yet is not an error — it is a new account, and the defaults are what a
    // new account has.
    if (error || !data) {
      return NextResponse.json({
        two_fa_enabled: false,
        two_fa_threshold: 500,
        two_fa_nudge_dismissed_at: null,
        totp_enabled: false,
        webauthn_credentials: [],
      });
    }

    return NextResponse.json({
      two_fa_enabled: data.two_fa_enabled ?? false,
      two_fa_threshold: data.two_fa_threshold ?? 500,
      two_fa_nudge_dismissed_at: data.two_fa_nudge_dismissed_at,
      totp_enabled: data.totp_enabled ?? false,
      webauthn_credentials: data.webauthn_credentials ?? [],
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { two_fa_enabled, two_fa_threshold, two_fa_nudge_dismissed_at, authorization } = body;

  const weakensSecurity =
    two_fa_enabled !== undefined || two_fa_threshold !== undefined;

  let email: string;
  try {
    if (weakensSecurity) {
      // Bound to whichever control is being touched. A token minted for the on/off switch
      // cannot be spent moving the threshold, and vice versa.
      ({ email } = await authorizeSecurityChange({
        control: two_fa_threshold !== undefined ? "threshold" : "two_fa",
        authorization,
      }));
    } else {
      ({ email } = await requireUser());
    }
  } catch (err) {
    const { status, error } = securityChangeError(err);
    return NextResponse.json({ error }, { status });
  }

  try {
    // Built from an allow-list, never spread from the body: a caller must not be able to write
    // `pin_hash`, `totp_secret` or anything else on this table by naming it.
    const updates: Record<string, unknown> = {};
    if (two_fa_enabled !== undefined) updates.two_fa_enabled = !!two_fa_enabled;
    if (two_fa_threshold !== undefined) {
      const threshold = Number(two_fa_threshold);
      if (!Number.isFinite(threshold) || threshold < 0) {
        return NextResponse.json({ error: "That threshold is not valid." }, { status: 400 });
      }
      updates.two_fa_threshold = threshold;
    }
    if (two_fa_nudge_dismissed_at !== undefined) {
      updates.two_fa_nudge_dismissed_at = two_fa_nudge_dismissed_at;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("user_profiles")
      .update(updates)
      .eq("email", email);

    if (error) {
      console.error("[Preferences] update failed:", error.message);
      return NextResponse.json({ error: "Could not save that." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
