import { NextResponse } from 'next/server';
import { createNotification } from '@/lib/supabase/notifications';
import { sendSecurityEmail } from '@/lib/email/sendEmail';

const SECURITY_MESSAGES: Record<string, { title: string; body: string }> = {
  totp_enabled: {
    title: '2FA Authenticator Enabled',
    body: "An authenticator app has been linked to your account. If this wasn't you, contact support immediately.",
  },
  totp_disabled: {
    title: '2FA Authenticator Disabled',
    body: "Your authenticator app 2FA has been removed. If this wasn't you, secure your account now.",
  },
  passkey_enabled: {
    title: 'Passkey Registered',
    body: "A new passkey has been added to your account. If this wasn't you, contact support immediately.",
  },
  passkey_disabled: {
    title: 'Passkey Removed',
    body: "A passkey has been removed from your account. If this wasn't you, secure your account now.",
  },
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, event } = body;

    if (!email || !event) {
      return NextResponse.json({ error: 'Email and event are required' }, { status: 400 });
    }

    const message = SECURITY_MESSAGES[event];
    if (!message) {
      return NextResponse.json({ error: 'Unknown security event' }, { status: 400 });
    }

    // In-app + web push (always fires regardless of preferences)
    await createNotification(
      email,
      message.title,
      message.body,
      'security',
      { url: '/dashboard/settings' }
    );

    // Email alert — respects user's email_notif_security preference
    await sendSecurityEmail(email, message.title, message.body);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[API Security Notification] Error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
