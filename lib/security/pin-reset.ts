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

import { sendEmail } from "@/lib/email/sendEmail";
import { pinResetTemplate } from "@/lib/email/templates";
import { consumeEmailCode, issueEmailCode } from "./email-code";

/**
 * Send a reset code to the account's own email address.
 *
 * The address comes from the session, never from the caller. A reset that could be pointed at
 * a supplied mailbox is a way to take over an account, not a way to recover one.
 */
export async function requestPinReset(userEmail: string): Promise<string> {
  const { id, code } = await issueEmailCode({ userEmail, purpose: "pin_reset" });

  await sendEmail({
    to: userEmail,
    subject: "Reset your Sendzz transaction PIN",
    html: pinResetTemplate(code),
  });

  return id;
}

/** Check a reset code and spend it, so one code sets one PIN. */
export async function verifyPinResetCode(
  resetId: string,
  code: string,
  userEmail: string,
): Promise<boolean> {
  return consumeEmailCode({
    id: resetId,
    code,
    userEmail,
    purpose: "pin_reset",
  });
}
