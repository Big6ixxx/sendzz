/**
 * GET /api/session/status — is this session still usable?
 *
 * 200 while alive, 401 once it is not, with a `reason` that says WHICH of three different
 * things happened. That distinction is the whole point of the route.
 *
 *   revoked         — signed out from another device. Ours to act on: end it here too.
 *   expired         — 24 hours with no transaction from this device. Also ours to act on.
 *   unauthenticated — the token did not verify. NOT ours to act on.
 *
 * The third one used to be reported as `expired`, and that conflation signed people out of
 * perfectly good sessions. A Privy access token is short-lived and refreshed in the background;
 * the client checks this route when a tab regains focus, which is exactly the moment a
 * just-woken tab still holds the old token. The answer was "expired", the client believed it
 * meant the 24-hour rule, and it called logout — on a session hours away from any limit.
 *
 * So `unauthenticated` is reported plainly and the client ignores it. Either the SDK refreshes
 * the token a moment later and nothing happened, or the session really is dead and Privy ends
 * it itself. Nothing is weakened by waiting: `getSessionUser` refuses every API call in the
 * meantime, which is the boundary that actually protects the account.
 */

import { NextResponse } from 'next/server';
import { getVerifiedIdentity, SESSION_IDLE_LIMIT_MS } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/adminClient';

export const runtime = 'nodejs';

type Reason = 'revoked' | 'expired' | 'unauthenticated';

const refuse = (reason: Reason) =>
  NextResponse.json({ error: 'Session ended', reason }, { status: 401 });

export async function GET() {
  try {
    // Step 1: does the token verify? A "no" here says nothing about our session rules.
    const identity = await getVerifiedIdentity();
    if (!identity?.sessionId) return refuse('unauthenticated');

    // Step 2: it does. Now the two rules that ARE ours, read from the same view
    // `resolveSession` uses, so this route and the API agree on every decision.
    const { data, error } = await supabaseAdmin
      .from('user_sessions_state')
      .select('idle_seconds, revoked_at')
      .eq('session_id', identity.sessionId)
      .maybeSingle();

    // Unreadable, or a device we have not recorded yet. `resolveSession` lets both proceed —
    // it creates the row on first sight and fails open on a database blip — so saying anything
    // else here would have the client end a session the API is still happily serving.
    if (error || !data) return NextResponse.json({ ok: true });

    if (data.revoked_at) return refuse('revoked');
    if ((data.idle_seconds ?? 0) * 1000 > SESSION_IDLE_LIMIT_MS) return refuse('expired');

    return NextResponse.json({ ok: true });
  } catch (err) {
    // Never answer 401 for an internal fault: the client treats 401 as a verdict and 500 as
    // noise, so a bug in here must not read as "your session is over".
    console.error('[Session] status error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
