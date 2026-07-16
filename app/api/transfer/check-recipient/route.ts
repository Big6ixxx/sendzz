import { createAdminClient } from '@/lib/supabase/server';
import { PrivyClient } from '@privy-io/node';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const privy = new PrivyClient({
  appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID || '',
  appSecret: process.env.PRIVY_APP_SECRET || '',
});

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

    // Authenticate the sender: try senderEmail param first, then fallback to Privy token
    let senderEmail = searchParams.get('senderEmail')?.toLowerCase().trim();

    if (!senderEmail) {
      const cookieStore = await cookies();
      const privyToken = cookieStore.get('privy-token')?.value;

      if (privyToken) {
        try {
          const verifiedClaims = await privy.utils().auth().verifyAccessToken(privyToken);
          const privyUser = await privy.users()._get(verifiedClaims.user_id);
          const emailAccount = privyUser.linked_accounts.find(
            (acc) => acc.type === 'email',
          ) as any;
          senderEmail = (emailAccount?.address || '').toLowerCase().trim();
        } catch (authError) {
          console.error('[CheckRecipient API] Auth error:', authError);
        }
      }
    }

    if (!senderEmail) {
      return NextResponse.json({ error: 'senderEmail is required' }, { status: 400 });
    }

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
