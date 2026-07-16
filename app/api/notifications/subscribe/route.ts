import { NextResponse } from 'next/server';
import { savePushSubscription } from '@/lib/supabase/notifications';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, subscription } = body;

    if (!email || !subscription) {
      return NextResponse.json({ error: 'Email and subscription are required' }, { status: 400 });
    }

    await savePushSubscription(email, subscription);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[API Subscribe] Error registering push subscription:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
