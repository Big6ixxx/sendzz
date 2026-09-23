import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { getEmailNotifPrefs, saveEmailNotifPrefs, DEFAULT_PREFS } from '@/lib/supabase/emailPrefs';

/**
 * Which emails a user wants. Identity from the session on both halves.
 *
 * These were keyed on an email from the request. The write half is the one that matters: an
 * attacker could silence somebody's SECURITY alerts and then take their time, with the victim
 * never told that anything had changed. The read half leaked whether an address has an
 * account at all.
 */
export async function GET() {
  let email: string;
  try {
    ({ email } = await requireUser());
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const prefs = await getEmailNotifPrefs(email);
    return NextResponse.json({ prefs });
  } catch (err: unknown) {
    console.error('[API email-prefs GET] Error:', err);
    return NextResponse.json({ prefs: DEFAULT_PREFS });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { prefs } = body;
    if (!prefs) return NextResponse.json({ error: 'prefs required' }, { status: 400 });

    let email: string;
    try {
      ({ email } = await requireUser());
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await saveEmailNotifPrefs(email, prefs);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[API email-prefs POST] Error:', err);
    // 500, not 200. Returning 200 here meant the client's `res.ok` check passed and it told the
    // user "Preference updated" for a save that had failed.
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}
