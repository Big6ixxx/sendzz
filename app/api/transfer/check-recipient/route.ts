import { createAdminClient, createClient } from '@/lib/supabase/server';
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

    // Authenticate the sender
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminSupabase = createAdminClient();

    // 1. Check if the target email has a Sendzz account
    const { data: targetUser } = await adminSupabase
      .from('users')
      .select('id')
      .ilike('email', email)
      .maybeSingle();

    const exists = !!targetUser;

    // 2. Count prior transfers between the current user and the target email
    //    (either as sender or recipient)
    const [{ count: sentCount }, { count: receivedCount }] = await Promise.all([
      adminSupabase
        .from('transfers')
        .select('id', { count: 'exact', head: true })
        .eq('sender_id', user.id)
        .ilike('recipient_email', email),
      adminSupabase
        .from('transfers')
        .select('id', { count: 'exact', head: true })
        .ilike('sender_email', user.email!)
        .ilike('recipient_email', email),
    ]);

    const priorTransactionCount = (sentCount ?? 0) + (receivedCount ?? 0);

    return NextResponse.json({ exists, priorTransactionCount });
  } catch (error) {
    console.error('[CheckRecipient API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
