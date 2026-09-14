/**
 * GET /api/session/status — is this session still usable?
 *
 * 200 while alive, 401 once it is not. The client polls this rather than counting down locally:
 * a device clock can be wrong or deliberately set back, and the answer has to be the one the API
 * will actually enforce.
 *
 * `requireUser` already applies both rules, so this route is a thin exposure of that single
 * decision rather than a second implementation of it. It only adds a `reason`, so the user can
 * be told whether they were signed out from another device or simply went idle — those deserve
 * different words, and "revoked" is the one someone needs to act on.
 */

import { NextResponse } from 'next/server';
import { AuthError, getVerifiedIdentity, requireUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/adminClient';

export const runtime = 'nodejs';

export async function GET() {
  try {
    await requireUser();
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (!(err instanceof AuthError)) {
      console.error('[Session] status error:', err);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }

    // Why it was refused. Best-effort: if this lookup fails we still report the 401, because
    // being unable to explain a dead session is no reason to treat it as alive.
    let reason: 'revoked' | 'expired' = 'expired';
    try {
      const identity = await getVerifiedIdentity();
      if (identity?.sessionId) {
        const { data } = await supabaseAdmin
          .from('user_sessions')
          .select('revoked_at')
          .eq('session_id', identity.sessionId)
          .maybeSingle();
        if (data?.revoked_at) reason = 'revoked';
      }
    } catch {
      // Keep the default.
    }

    return NextResponse.json({ error: 'Session ended', reason }, { status: 401 });
  }
}
