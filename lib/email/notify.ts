'use server';

/**
 * The one email a signed-in user may cause to be sent.
 *
 * lib/email/sendEmail.ts is internal precisely so there is no generic "send mail to anyone
 * with any body" endpoint. This is the narrow exception: when you pay somebody, they are told.
 *
 * What makes it safe is what it does NOT accept. The sender is read from the session, not
 * passed in — so nobody can send "Alice sent you $50,000" over Alice's name. The body is a
 * fixed template, so nobody can put their own HTML inside our DKIM signature. The only things
 * a caller chooses are who to notify and about how much, which is exactly the transfer they
 * were already allowed to make.
 */

import { requireUser } from '@/lib/auth/session';
import { sendTransferEmail } from './sendEmail';

/**
 * Tell a recipient they were paid.
 *
 * Never throws. This runs after the money has already moved — a failed notification must not
 * surface as a failed transfer, and the ledger is the record either way.
 */
export async function notifyTransferSent(input: {
  recipientEmail: string;
  amountUsdc: string;
  isPendingClaim?: boolean;
  note?: string;
  accessToken?: string;
}): Promise<void> {
  try {
    // The sender is whoever is signed in, full stop. Taking it from an argument was what made
    // the old surface worth abusing.
    const { email: senderEmail } = await requireUser(input.accessToken);

    await sendTransferEmail(input.recipientEmail, input.amountUsdc, senderEmail, {
      isPendingClaim: input.isPendingClaim ?? false,
      note: input.note,
    });
  } catch (err) {
    console.error('[notifyTransferSent] failed:', (err as Error).message);
  }
}
