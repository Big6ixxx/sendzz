/**
 * Getting back in after forgetting the PIN.
 *
 * This exists because the PIN became mandatory. Before that, forgetting it cost you the
 * convenience of a shortcut; now it costs you access to your own money, because nothing leaves
 * the account without it. A required factor with no recovery path is not a security control,
 * it is a way to lose customers' funds — and "contact support" is not a recovery path when
 * support has no way to read or reset a hash either.
 *
 * Recovery goes through email, because email is what every Sendzz account already signs in
 * with: there is no user who has a PIN but no mailbox. A code is sent there, and proving
 * control of the mailbox is what permits a NEW PIN to be set. The old one is never revealed —
 * it cannot be, and that property is not weakened to make this work.
 *
 * --- Why this does not undo the PIN -----------------------------------------
 *
 * An obvious objection: if an emailed code can replace the PIN, is the PIN worth anything?
 * Yes, and for a specific reason. The threat the PIN answers is someone at an ALREADY OPEN
 * session — a borrowed laptop, an unlocked phone, a shoulder surfer. Resetting requires
 * reading a fresh email, which is a different thing to have. Someone who holds both the open
 * session and the mailbox was never going to be stopped by four digits anyway; someone who
 * holds only the session now has to find the mailbox too.
 *
 * The rate limit below matters for the same reason. Without it, an open session could mint
 * reset codes indefinitely and wait for one to be read on a shared screen.
 */

import crypto from "node:crypto";

import { decrypt, encrypt } from "@/lib/encryption";
import { sendEmail } from "@/lib/email/sendEmail";
import { pinResetTemplate } from "@/lib/email/templates";
import { supabaseAdmin } from "@/lib/supabase/adminClient";

/** How long a reset code is good for. Matches the other transaction codes. */
const RESET_TTL_MS = 10 * 60 * 1000;

/** The quiet period between reset codes, so an open session cannot spray a mailbox. */
const RESEND_COOLDOWN_MS = 60 * 1000;

function encryptionKey(): string {
  const key = process.env.TOTP_ENCRYPTION_KEY;
  if (!key) throw new Error("TOTP_ENCRYPTION_KEY is not configured.");
  return key;
}

/**
 * Send a reset code to the account's own email address.
 *
 * The address is the one on the account, never one supplied by the caller — otherwise this
 * would be a way to redirect recovery to an attacker's mailbox, which is the single worst
 * thing a reset flow can get wrong.
 */
export async function requestPinReset(userEmail: string): Promise<string> {
  const now = new Date().toISOString();

  await supabaseAdmin
    .from("transaction_otps")
    .delete()
    .lt("expires_at", now)
    .eq("user_email", userEmail);

  const since = new Date(Date.now() - RESEND_COOLDOWN_MS).toISOString();
  const { data: recent } = await supabaseAdmin
    .from("transaction_otps")
    .select("id")
    .eq("user_email", userEmail)
    .eq("action_type", "pin_reset")
    .gt("created_at", since)
    .maybeSingle();

  if (recent) {
    throw new Error("A reset code was just sent. Check your inbox, or try again in a minute.");
  }

  const code = crypto.randomInt(100000, 999999).toString();

  const { data, error } = await supabaseAdmin
    .from("transaction_otps")
    .insert({
      user_email: userEmail,
      // Stored encrypted, exactly as the transaction codes are: a database dump should not
      // hand someone a live reset code for every account mid-flow.
      otp_code: encrypt(code, encryptionKey()),
      action_type: "pin_reset",
      payload: {},
      expires_at: new Date(Date.now() + RESET_TTL_MS).toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[PIN reset] could not store code:", error?.message);
    throw new Error("Could not start the reset. Please try again.");
  }

  await sendEmail({
    to: userEmail,
    subject: "Reset your Sendzz transaction PIN",
    html: pinResetTemplate(code),
  });

  return data.id;
}

/**
 * Check a reset code and spend it.
 *
 * Deletes the row on success so one code sets one PIN. Returns false rather than throwing for
 * anything that simply did not match, so the caller answers every wrong code identically and
 * nothing distinguishes "expired" from "never existed" from "belongs to someone else".
 */
export async function verifyPinResetCode(
  resetId: string,
  code: string,
  userEmail: string,
): Promise<boolean> {
  try {
    const { data: row } = await supabaseAdmin
      .from("transaction_otps")
      .select("id, user_email, otp_code, action_type, expires_at")
      .eq("id", resetId)
      .maybeSingle();

    if (!row) return false;
    if (row.action_type !== "pin_reset") return false;
    if (row.user_email !== userEmail) return false;
    if (new Date(row.expires_at) < new Date()) return false;

    if (decrypt(row.otp_code, encryptionKey()) !== code) return false;

    await supabaseAdmin.from("transaction_otps").delete().eq("id", row.id);
    return true;
  } catch (err) {
    console.error("[PIN reset] verification failed:", (err as Error).message);
    return false;
  }
}
