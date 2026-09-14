/**
 * Device sessions: list them, and sign any or all of them out.
 *
 * GET  — every live session for the signed-in user, newest activity first.
 * POST — revoke one by id, or every session except the one making the request.
 *
 * Revocation is a `revoked_at` stamp, checked by `getSessionUser` on every authenticated
 * request. That makes it immediate: the revoked device's next call fails, rather than it staying
 * usable until a token happens to expire.
 *
 * A session may only ever be revoked by the account that owns it — the update is filtered on
 * `user_id`, so passing someone else's session id changes nothing.
 */

import { NextResponse } from 'next/server';
import {
  AuthError,
  getVerifiedIdentity,
  requireUserId,
  SESSION_IDLE_LIMIT_MS,
} from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/adminClient';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const { userId } = await requireUserId();
    const identity = await getVerifiedIdentity();

    // Read through the view for Postgres-measured idle time, so this screen agrees with the gate
    // that actually enforces expiry.
    const { data, error } = await supabaseAdmin
      .from('user_sessions_state')
      .select('id, session_id, last_active_at, user_agent, idle_seconds')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .order('last_active_at', { ascending: false });

    if (error) throw new Error(error.message);

    // Hide sessions that are already dead.
    //
    // Filtering on `revoked_at` alone was not enough: a session that lapsed through inactivity is
    // refused by getSessionUser but still has no revoked_at, so it kept appearing here as though
    // it were live. The screen listed phantom devices, and signing one out did nothing visible
    // because it had been dead for weeks — which is worse than useless on a screen someone opens
    // specifically to check whether a lost phone still has access.
    const live = (data ?? []).filter(
      (s) => (s.idle_seconds ?? 0) * 1000 <= SESSION_IDLE_LIMIT_MS,
    );

    // `current` lets the UI label this device and refuse to offer it as a "sign out" target,
    // which would just log the user out of the screen they are standing on.
    const sessions = live.map((s) => ({
      id: s.id,
      current: s.session_id === identity?.sessionId,
      lastActiveAt: s.last_active_at,
      userAgent: s.user_agent,
    }));

    return NextResponse.json({ sessions });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[Session] devices GET error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { userId } = await requireUserId();
    const identity = await getVerifiedIdentity();
    const { sessionRowId, all } = (await request.json()) as {
      sessionRowId?: string;
      all?: boolean;
    };

    const now = new Date().toISOString();
    let query = supabaseAdmin
      .from('user_sessions')
      .update({ revoked_at: now })
      // Scoped to the caller's own sessions. Without this, an id from another account would be
      // revocable by anyone who guessed it.
      .eq('user_id', userId)
      .is('revoked_at', null);

    if (all) {
      // "Sign out everywhere else" — deliberately keeps the current device signed in, so the
      // user is not ejected from the screen they just used to secure their account.
      if (identity?.sessionId) query = query.neq('session_id', identity.sessionId);
    } else if (sessionRowId) {
      query = query.eq('id', sessionRowId);
    } else {
      return NextResponse.json({ error: 'sessionRowId or all is required' }, { status: 400 });
    }

    const { data, error } = await query.select('id');
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, revoked: data?.length ?? 0 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[Session] devices POST error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
