'use server';

/**
 * Record an EVM send the instant the bundler accepts it.
 *
 * Stellar writes its intent inside `/api/stellar/send`, because the server broadcasts there.
 * EVM has no such route — the browser talks to Circle's bundler directly — so this action is the
 * equivalent hook, called from `onBroadcast` the moment a UserOperation hash exists.
 *
 * The identity comes from the session, never from an argument, so this cannot be used to write
 * an intent into somebody else's account. The amount is not trusted either: nothing is recorded
 * from this table without the chain confirming it first (see reconcilePendingSends).
 */

import { getVerifiedIdentity } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/adminClient';
import { markSendPending } from '@/lib/supabase/pendingSends';

export async function recordSendIntent(params: {
  userOpHash: string;
  chain: string;
  recipient: string;
  amount: number;
  note?: string;
  accessToken?: string;
}): Promise<void> {
  try {
    const identity = await getVerifiedIdentity(params.accessToken);
    if (!identity) return;

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', identity.email)
      .maybeSingle();
    if (!user?.id) return;

    await markSendPending({
      userId: user.id,
      // Keyed on the UserOperation hash rather than a transaction hash — the transaction does
      // not exist yet, and may never. The reconciler resolves one to the other.
      txHash: params.userOpHash,
      chain: params.chain.toLowerCase(),
      senderEmail: identity.email,
      recipient: params.recipient,
      amount: params.amount,
      note: params.note,
    });
  } catch (err) {
    // Never throws: this runs immediately after an irreversible broadcast.
    console.error('[recordSendIntent] failed:', (err as Error).message);
  }
}
