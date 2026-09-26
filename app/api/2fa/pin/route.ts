/**
 * Set, verify, authorise with, and remove a transaction PIN.
 *
 * Identity always comes from the session, never from the request body. An endpoint that
 * accepted an email would let anyone set a PIN on someone else's account, which is the whole
 * of the security here.
 *
 * Responses never distinguish "no PIN set" from "wrong PIN" beyond what the user needs, and
 * never echo the PIN or the hash.
 *
 * `authorize` is the action the payment paths use. It checks the PIN exactly as `verify` does
 * and then mints a single-use token bound to the specific transaction the user was shown, so
 * that the acceptance cannot be reused for a different amount or a different recipient.
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/adminClient";
import { getVerifiedIdentity, requireUser } from "@/lib/auth/session";
import {
  mintAuthorization,
  type AuthorizationPayload,
  type AuthorizationPurpose,
} from "@/lib/security/transaction-auth";
import { requestPinReset, verifyPinResetCode } from "@/lib/security/pin-reset";
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

/** The purposes the payment paths may ask for. Anything else is refused as an unknown action. */
const AUTHORIZATION_PURPOSES = [
  "transfer",
  "crypto_transfer",
  "withdrawal",
  "bridge",
  "batch_send",
  "security_change",
] as const;

function isAuthorizationPurpose(value: unknown): value is AuthorizationPurpose {
  return typeof value === "string" &&
    (AUTHORIZATION_PURPOSES as readonly string[]).includes(value);
}

/** The stored PIN state this endpoint reasons about. */
type PinProfile = {
  pin_hash: string | null;
  pin_failed_attempts: number | null;
  pin_locked_until: string | null;
} | null;

/**
 * Check a PIN and move the attempt counter.
 *
 * Returns the response to send when the PIN is NOT accepted, or null when it is — so a caller
 * that forgets to handle the result falls through to its success path only in the one case
 * where that is correct.
 *
 * The counter is advanced here and nowhere else. On success it is cleared, so ordinary
 * mistyping never accumulates towards a lockout across days.
 */
async function checkPin(
  email: string,
  pin: unknown,
  profile: PinProfile,
): Promise<NextResponse | null> {
  if (!profile?.pin_hash) {
    // `code` so the client can act on this rather than parse the sentence. It is the one
    // rejection here that is not "you got it wrong" — there is nothing to get right yet, so a
    // caller that only shows `error` leaves somebody retyping a PIN that does not exist.
    return NextResponse.json(
      { error: "You have not set a transaction PIN yet.", code: "no_pin" },
      { status: 400 },
    );
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

  const ok = await verifyPin(typeof pin === "string" ? pin : "", profile.pin_hash);

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

  // Correct: the counter starts fresh.
  await supabaseAdmin
    .from("user_profiles")
    .update({
      pin_failed_attempts: CLEARED_LOCKOUT.failedAttempts,
      pin_locked_until: CLEARED_LOCKOUT.lockedUntil,
    })
    .eq("email", email);

  return null;
}

export async function POST(req: Request) {
  try {
    const { action, pin, currentPin, purpose, payload, resetId, resetCode } =
      await req.json();
    const { email, userId } = await requireUser(token(req));

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

      // Upsert, not update, and the row is counted afterwards.
      //
      // An UPDATE that matches nothing is not an error in Postgres — it is a successful
      // statement that changed zero rows. This used to `.update().eq("email", …)` against a
      // `user_profiles` row that, for accounts created after migration 022, frequently does
      // not exist: profiles were only ever created by a trigger on `auth.users`, and Privy
      // means nothing has inserted into `auth.users` since. So the write silently did
      // nothing, this returned `{ success: true }`, the user was congratulated on setting a
      // PIN, and then could not spend their own money — every payment asked for a PIN that
      // was never stored.
      //
      // `id` is required because it is the primary key with no default. It is the same id as
      // `public.users`, which is what migration 022 backfilled and what emailPrefs already
      // assumes.
      if (!userId) {
        // No account row at all is a different failure, and not one to paper over: a profile
        // keyed to nothing would break every later lookup in a harder-to-find way.
        console.error(`[PIN] no users row for ${email}; refusing to create an orphan profile.`);
        return NextResponse.json({ error: "Could not save your PIN." }, { status: 500 });
      }

      const { hash } = await hashPin(pin);
      const { data: saved, error } = await supabaseAdmin
        .from("user_profiles")
        .upsert(
          {
            id: userId,
            email,
            pin_hash: hash,
            pin_set_at: new Date().toISOString(),
            pin_failed_attempts: 0,
            pin_locked_until: null,
          },
          { onConflict: "id" },
        )
        .select("id");

      if (error) {
        console.error("[PIN] failed to store:", error.message);
        return NextResponse.json({ error: "Could not save your PIN." }, { status: 500 });
      }

      // The point of the select: "no error" and "wrote something" are different claims, and
      // telling somebody their PIN is set when it is not is the whole bug above.
      if (!saved || saved.length === 0) {
        console.error(`[PIN] upsert affected no rows for ${email}`);
        return NextResponse.json({ error: "Could not save your PIN." }, { status: 500 });
      }

      return NextResponse.json({ success: true });
    }

    // ── Verify, and authorise ──────────────────────────────────────────────
    //
    // One PIN check, two callers. `verify` answers a question and is enough for a settings
    // change, which the server performs itself in the same request. `authorize` additionally
    // mints a token bound to one operation, for the payment paths — see
    // lib/security/transaction-auth.ts on why a yes/no answer authorises nothing there.
    //
    // They share `checkPin` rather than each carrying a copy, because the attempt counter is
    // what makes four digits defensible at all: a second code path that forgot to increment it
    // would hand an attacker unlimited guesses through the endpoint that happened to skip it.
    if (action === "verify" || action === "authorize") {
      const failure = await checkPin(email, pin, profile);
      if (failure) return failure;

      if (action === "verify") return NextResponse.json({ success: true });

      // ── Mint the operation-bound token ───────────────────────────────────
      if (!isAuthorizationPurpose(purpose)) {
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
      }
      if (!payload || typeof payload !== "object") {
        return NextResponse.json({ error: "Nothing to authorise." }, { status: 400 });
      }
      if (!userId) {
        return NextResponse.json({ error: "Your account is still being set up." }, { status: 409 });
      }

      // The device session out of the signed token, so the authorisation cannot be spent from
      // a browser that never entered the PIN. requireUser already verified this token; reading
      // the claim again is cheap and keeps the session id out of the function's return shape.
      const identity = await getVerifiedIdentity(token(req));
      if (!identity) {
        return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
      }

      try {
        const { token: authorization, expiresAt } = await mintAuthorization({
          userId,
          sessionId: identity.sessionId,
          purpose,
          payload: payload as AuthorizationPayload,
        });
        return NextResponse.json({ success: true, authorization, expiresAt });
      } catch (err) {
        return NextResponse.json(
          { error: (err as Error).message ?? "Could not authorise this transaction." },
          { status: 500 },
        );
      }
    }

    // ── Forgot the PIN ─────────────────────────────────────────────────────
    //
    // Two steps, because proving control of the mailbox has to happen before a new PIN is
    // accepted — not alongside it. See lib/security/pin-reset.ts on why this does not undo
    // the protection the PIN provides.
    if (action === "reset-request") {
      if (!profile?.pin_hash) {
        return NextResponse.json({ error: "No PIN is set up." }, { status: 400 });
      }
      try {
        // The address comes from the session, never the body. A reset that could be pointed at
        // a caller-supplied mailbox would be a way to take over an account, not to recover one.
        const id = await requestPinReset(email);
        return NextResponse.json({ success: true, resetId: id });
      } catch (err) {
        return NextResponse.json(
          { error: (err as Error).message ?? "Could not send the reset code." },
          { status: 429 },
        );
      }
    }

    if (action === "reset") {
      const policy = checkPinPolicy(pin);
      if (!policy.ok) {
        return NextResponse.json({ error: policy.reason }, { status: 400 });
      }

      const ok =
        typeof resetId === "string" &&
        typeof resetCode === "string" &&
        (await verifyPinResetCode(resetId, resetCode, email));

      if (!ok) {
        return NextResponse.json(
          { error: "That code is wrong or has expired. Send yourself a new one." },
          { status: 401 },
        );
      }

      const { hash } = await hashPin(pin);
      const { error } = await supabaseAdmin
        .from("user_profiles")
        .update({
          pin_hash: hash,
          pin_set_at: new Date().toISOString(),
          // A reset clears the lockout too. Someone who reached this point proved control of
          // the mailbox, and leaving them locked out by the counter that sent them here would
          // make the recovery they just completed useless for another quarter of an hour.
          pin_failed_attempts: 0,
          pin_locked_until: null,
        })
        .eq("email", email);

      if (error) {
        console.error("[PIN] failed to store after reset:", error.message);
        return NextResponse.json({ error: "Could not save your new PIN." }, { status: 500 });
      }
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
