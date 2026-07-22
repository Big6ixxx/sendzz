import { NextResponse } from 'next/server';
import { getEmailNotifPrefs, saveEmailNotifPrefs, DEFAULT_PREFS } from '@/lib/supabase/emailPrefs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');
  if (!email) return NextResponse.json({ prefs: DEFAULT_PREFS });

  try {
    const prefs = await getEmailNotifPrefs(email);
    return NextResponse.json({ prefs });
  } catch (err: any) {
    console.error('[API email-prefs GET] Error:', err);
    return NextResponse.json({ prefs: DEFAULT_PREFS });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, prefs } = body;
    if (!email || !prefs) return NextResponse.json({ error: 'email and prefs required' }, { status: 400 });
    await saveEmailNotifPrefs(email, prefs);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[API email-prefs POST] Error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 200 });
  }
}
