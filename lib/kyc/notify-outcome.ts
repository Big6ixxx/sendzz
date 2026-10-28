import 'server-only';

import { supabaseAdmin } from '@/lib/supabase/adminClient';
import { claimReverifyNotice, recordKycTransition } from './supabase-kyc';
import { getDecisionReasons, getSessionState } from './didit-client';
import { reverificationMayReplace } from './verified-identity';

/**
 * Emails on a verification's outcome: the admins when Didit could not decide it and it waits In
 * Review, the user when it is approved or declined.
 *
 * Called by whichever path records the change — the Didit webhook, or the status endpoint's live
 * sync while the user waits — and only on a change, so one outcome is one email.
 *
 * Keyed on Didit's own status, not ours: "Abandoned" is stored as declined, and a user who simply
 * closed the window must not be told they were rejected. Never throws: an email must not make
 * Didit redeliver the event, or fail the status check.
 */
export async function notifyKycOutcome(params: {
  userId: string;
  sessionId: string;
  diditStatus: string;
  /** Already verified once, and this session is a new ID (see app/api/kyc/session). */
  reverify: boolean;
}): Promise<void> {
  const { userId, sessionId, diditStatus, reverify } = params;
  if (diditStatus !== 'In Review' && diditStatus !== 'Approved' && diditStatus !== 'Declined') return;
  try {
    const { data: user } = await supabaseAdmin.from('users').select('email').eq('id', userId).maybeSingle();
    if (!user?.email) {
      console.warn(`[KYC Notify] No email on file for user=${userId}; nothing sent`);
      return;
    }
    // Why Didit held it back. Asked for a review (the admins decide on it) and for a decline (the
    // user is told what to fix); an approval needs no reason.
    const reasons =
      diditStatus === 'Approved' ? [] : await getDecisionReasons(sessionId, diditStatus === 'In Review' ? 'admin' : 'user');
    if (diditStatus === 'In Review') {
      const { sendKycReviewAlert } = await import('@/lib/email/admin-alerts');
      await sendKycReviewAlert({ userEmail: user.email, sessionId, reverify, reasons });
    } else {
      const { sendKycResultEmail } = await import('@/lib/email/sendEmail');
      await sendKycResultEmail(user.email, diditStatus === 'Approved' ? 'approved' : 'declined', { reverify, reasons });
    }
  } catch (err) {
    console.error(`[KYC Notify] session=${sessionId} ${diditStatus}:`, err);
  }
}

/**
 * Announce a re-verification outcome that is not on the record (In Review, Declined), once:
 * redeliveries are dropped by claimReverifyNotice. Only for a session started after the one on
 * record: a late event for an older one (a decline before the approval now on record) is not a
 * new ID, and telling the user their "new ID" failed would be false.
 */
export async function notifyReverifyOutcome(
  userId: string,
  sessionId: string,
  currentSessionId: string,
  diditStatus: string,
): Promise<void> {
  if (diditStatus !== 'In Review' && diditStatus !== 'Declined') return;
  const [state, current] = await Promise.all([getSessionState(sessionId), getSessionState(currentSessionId)]);
  if (!(Date.parse(state.createdAt ?? '') > Date.parse(current.createdAt ?? ''))) return;
  if (!(await claimReverifyNotice(userId, `${sessionId}:${diditStatus}`))) return;
  await notifyKycOutcome({ userId, sessionId, diditStatus, reverify: true });
}

/**
 * Put an approved re-verification on the record in place of the approved session, when it may
 * replace it (reverificationMayReplace). Called by the Didit webhook and by the status endpoint
 * while the user waits, whichever sees the approval first; the write is conditional, so only one
 * of them sends the email. A refusal is told to the user once, with the reason. A stale event
 * for a session already superseded reads as applied: the record already carries a newer
 * approval. Throws when Didit cannot be asked.
 */
export async function applyReverification(params: {
  userId: string;
  currentSessionId: string;
  sessionId: string;
  vendorData?: string;
  webhookPayload?: Record<string, unknown>;
}): Promise<{ applied: true } | { applied: false; message?: string }> {
  const { userId, currentSessionId, sessionId } = params;
  const replace = await reverificationMayReplace(currentSessionId, sessionId);
  if (!replace.ok) {
    // Older than the session on record: that one is a newer approval, so the record has already
    // moved past this session. Nothing to apply, and nothing wrong for the user.
    if (replace.stale) return { applied: true };
    console.error(
      `[KYC] Approved re-verification ${sessionId} NOT applied for user=${userId}: ${replace.why}. ` +
        `Session ${currentSessionId} stays on record.`,
    );
    const message = `Your new ID was verified, but ${replace.why}, so your current verification stays in place.`;
    if (await claimReverifyNotice(userId, `${sessionId}:refused`)) {
      try {
        const { data: user } = await supabaseAdmin.from('users').select('email').eq('id', userId).maybeSingle();
        if (user?.email) {
          const { sendKycResultEmail } = await import('@/lib/email/sendEmail');
          const { sendKycReviewAlert } = await import('@/lib/email/admin-alerts');
          await sendKycResultEmail(user.email, 'declined', {
            reverify: true,
            reasons: [{ title: "Your new ID couldn't be used", detail: message }],
          });
          // The admins too: a different name or date of birth can be someone putting another
          // person's ID on this account, and only a person can settle it.
          await sendKycReviewAlert({
            userEmail: user.email,
            sessionId,
            reverify: true,
            reasons: [{ title: 'Approved by Didit, not applied', detail: `It was not put on the account because ${replace.why}.` }],
          });
        }
      } catch (err) {
        console.error(`[KYC Notify] refusal email for session=${sessionId}:`, err);
      }
    }
    return { applied: false, message };
  }

  const changed = await recordKycTransition({
    userId,
    diditSessionId: sessionId,
    status: 'approved',
    vendorData: params.vendorData,
    webhookPayload: params.webhookPayload,
  });
  if (changed) await notifyKycOutcome({ userId, sessionId, diditStatus: 'Approved', reverify: true });
  return { applied: true };
}
