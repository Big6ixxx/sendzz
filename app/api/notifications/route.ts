import { NextResponse } from 'next/server';
import { getNotifications, markNotificationsAsRead } from '@/lib/supabase/notifications';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');

    if (!email) {
      return NextResponse.json({ error: 'Email parameter is required' }, { status: 400 });
    }

    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 20;
    const notifications = await getNotifications(email, limit);

    return NextResponse.json({ notifications });
  } catch (err: any) {
    console.error('[API Notifications] GET Error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, ids } = body;

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    await markNotificationsAsRead(email, ids);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[API Notifications] POST Error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
