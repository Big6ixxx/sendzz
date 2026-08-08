import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth/session';
import { getNotifications, markNotificationsAsRead } from '@/lib/supabase/notifications';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    // The account is whoever is signed in. It used to come from `?email=`, which made this an
    // unauthenticated read of any user's notifications from the address bar.
    const { email } = await requireUser();

    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 20;
    const notifications = await getNotifications(email, limit);

    return NextResponse.json({ notifications });
  } catch (err: unknown) {
    // Being signed out is an expected state here — the notification poller keeps running
    // through logout — so answer 401 quietly rather than logging a stack every few seconds.
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[API Notifications] GET Error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { ids } = body;

    // The account is the signed-in one. This handler previously took `email` from the request
    // body with no authentication, so anyone could mark another person's notifications read.
    const { email } = await requireUser();

    await markNotificationsAsRead(email, ids);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[API Notifications] POST Error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
