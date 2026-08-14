import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth/session';
import { savePushSubscription } from '@/lib/supabase/notifications';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { subscription } = body;

    if (!subscription) {
      return NextResponse.json({ error: 'Subscription is required' }, { status: 400 });
    }

    // Bound to the signed-in account so nobody can attach a push endpoint to someone else's.
    const { email } = await requireUser();
    await savePushSubscription(email, subscription);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[API Subscribe] Error registering push subscription:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
