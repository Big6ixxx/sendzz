/**
 * Set, verify and remove a transaction PIN.
 *
 * Identity always comes from the session, never from the request body. An endpoint that
 * accepted an email would let anyone set a PIN on someone else's account, which is the whole
 * of the security here.
 *
 * Responses never distinguish "no PIN set" from "wrong PIN" beyond what the user needs, and
 * never echo the PIN or the hash.
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/adminClient";
import { requireUser } from "@/lib/auth/session";
import {
  CLEARED_LOCKOUT,
  MAX_PIN_ATTEMPTS,
  checkPinPolicy,
  hashPin,
  lockoutRemainingMs,
  nextLockout,
  verifyPin,
} from "@/lib/security/pin";

export const runtime = "nodejs";

function token(req: Request): string | undefined {
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || undefined;
}

function minutes(ms: number): number {
  return Math.max(1, Math.ceil(ms / 60000));
}

export async function POST(req: Request) {
  try {
    const { action, pin, currentPin } = await req.json();
    const { email } = await requireUser(token(req));

    const { data: profile } = await supabaseAdmin
      .from("user_profiles")
      .select("pin_hash, pin_failed_attempts, pin_locked_until")
      .eq("email", email)
      .maybeSingle();

    // ── Set or change ──────────────────────────────────────────────────────
    if (action === "set") {
      const policy = checkPinPolicy(pin);
      if (!policy.ok) {
        return NextResponse.json({ error: policy.reason }, { status: 400 });
      }

      // Changing a PIN requires the current one. Without this, anyone who reaches an open
      // session can silently replace the factor that protects the account.
      if (profile?.pin_hash) {
        const ok = await verifyPin(currentPin ?? "", profile.pin_hash);
        if (!ok) {
          return NextResponse.json(
            { error: "That is not your current PIN." },
            { status: 401 },
          );
        }
      }

      const { hash } = await hashPin(pin);
      const { error } = await supabaseAdmin
        .from("user_profiles")
        .update({
          pin_hash: hash,
          pin_set_at: new Date().toISOString(),
          pin_failed_attempts: 0,
          pin_locked_until: null,
        })
        .eq("email", email);

      if (error) {
        console.error("[PIN] failed to store:", error.message);
        return NextResponse.json({ error: "Could not save your PIN." }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    // ── Verify ─────────────────────────────────────────────────────────────
    if (action === "verify") {
      if (!profile?.pin_hash) {
        return NextResponse.json({ error: "No PIN is set up." }, { status: 400 });
      }

      const state = {
        failedAttempts: profile.pin_failed_attempts ?? 0,
        lockedUntil: profile.pin_locked_until,
      };

      const remaining = lockoutRemainingMs(state);
      if (remaining > 0) {
        return NextResponse.json(
          {
            error: `Too many wrong attempts. Try again in ${minutes(remaining)} minutes.`,
            lockedForMs: remaining,
          },
          { status: 429 },
        );
      }

      const ok = await verifyPin(pin ?? "", profile.pin_hash);

      if (!ok) {
        const next = nextLockout(state);
        await supabaseAdmin
          .from("user_profiles")
          .update({
            pin_failed_attempts: next.failedAttempts,
            pin_locked_until: next.lockedUntil,
          })
          .eq("email", email);

        if (next.lockedUntil) {
          return NextResponse.json(
            {
              error: `Too many wrong attempts. Try again in ${minutes(lockoutRemainingMs(next))} minutes.`,
              lockedForMs: lockoutRemainingMs(next),
            },
            { status: 429 },
          );
        }

        const left = MAX_PIN_ATTEMPTS - next.failedAttempts;
        return NextResponse.json(
          {
            error: `Incorrect PIN. ${left} ${left === 1 ? "try" : "tries"} left.`,
            attemptsLeft: left,
          },
          { status: 401 },
        );
      }

      // Correct: the counter starts fresh, so ordinary mistyping never accumulates.
      await supabaseAdmin
        .from("user_profiles")
        .update({
          pin_failed_attempts: CLEARED_LOCKOUT.failedAttempts,
          pin_locked_until: CLEARED_LOCKOUT.lockedUntil,
        })
        .eq("email", email);

      return NextResponse.json({ success: true });
    }

    // ── Remove ─────────────────────────────────────────────────────────────
    if (action === "remove") {
      if (profile?.pin_hash) {
        const ok = await verifyPin(currentPin ?? "", profile.pin_hash);
        if (!ok) {
          return NextResponse.json({ error: "That is not your current PIN." }, { status: 401 });
        }
      }
      const { error } = await supabaseAdmin
        .from("user_profiles")
        .update({
          pin_hash: null,
          pin_set_at: null,
          pin_failed_attempts: 0,
          pin_locked_until: null,
        })
        .eq("email", email);

      if (error) {
        console.error("[PIN] failed to remove:", error.message);
        return NextResponse.json({ error: "Could not remove your PIN." }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    // A missing PIN_PEPPER lands here. Never leak which misconfiguration it was.
    console.error("[PIN] request failed:", err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}

/** Whether a PIN exists, for rendering settings. Never returns the hash. */
export async function GET(req: Request) {
  try {
    const { email } = await requireUser(token(req));
    const { data } = await supabaseAdmin
      .from("user_profiles")
      .select("pin_hash, pin_set_at")
      .eq("email", email)
      .maybeSingle();

    return NextResponse.json({
      enabled: !!data?.pin_hash,
      setAt: data?.pin_set_at ?? null,
    });
  } catch {
    return NextResponse.json({ enabled: false, setAt: null });
  }
}
