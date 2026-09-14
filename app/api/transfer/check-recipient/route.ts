import { getVerifiedIdentity } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

/**
 * GET /api/transfer/check-recipient?email=<email>
 *
 * Used by the transfer form to show inline warnings before sending.
 * Returns:
 *   - exists: whether the email has a Sendzz account
 *   - priorTransactionCount: number of past transfers between current user & target
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const email = searchParams.get('email')?.toLowerCase().trim();

    if (!email) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 });
    }

    // The caller is whoever the SESSION says, never a query parameter.
    //
    // This used to read `senderEmail` from the URL and only fall back to the token when it was
    // absent — so supplying it skipped authentication entirely. That made this an open endpoint
    // for two things worth having: checking whether any email address holds a Sendzz account,
    // and reading how many times one arbitrary person had paid another.
    //
    // Callers still append `senderEmail`; it is ignored. Arguments say what to look up, only the
    // session says who is asking.
    const identity = await getVerifiedIdentity();
    if (!identity) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const senderEmail = identity.email;

    const adminSupabase = createAdminClient();

    // 1. Check if the target email has a Sendzz account
    const { data: targetUser } = await adminSupabase
      .from('users')
      .select('id')
      .ilike('email', email)
      .maybeSingle();

    const exists = !!targetUser;

    // Get the sender's user ID if registered
    const { data: senderUser } = await adminSupabase
      .from('users')
      .select('id')
      .ilike('email', senderEmail)
      .maybeSingle();

    const senderId = senderUser?.id;

    // 2. Count prior transfers sent by the current user to the target email
    let query = adminSupabase
      .from('transfers')
      .select('id', { count: 'exact', head: true })
      .ilike('recipient_email', email);

    if (senderId) {
      query = query.or(`sender_id.eq.${senderId},sender_email.eq.${senderEmail}`);
    } else {
      query = query.eq('sender_email', senderEmail);
    }

    const { count } = await query;
    const priorTransactionCount = count ?? 0;

    return NextResponse.json({ exists, priorTransactionCount });
  } catch (error) {
    console.error('[CheckRecipient API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
