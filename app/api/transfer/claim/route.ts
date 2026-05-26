import { createAdminClient, createClient } from '@/lib/supabase/server';
import crypto from 'crypto';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { token } = await req.json();

    if (!token || typeof token !== 'string') {
      return NextResponse.json(
        { error: 'Claim token is required' },
        { status: 400 },
      );
    }

    // Authenticate the recipient via their Privy/Supabase session
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Hash the raw token — the DB only stores the SHA256 hash (never the raw token)
    const tokenHash = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    const adminSupabase = createAdminClient();

    // Look up the pending transfer by its token hash so we can return the amount
    const { data: transfer, error: lookupError } = await adminSupabase
      .from('transfers')
      .select('id, amount, status, expires_at, recipient_email')
      .eq('claim_token_hash', tokenHash)
      .single();

    if (lookupError || !transfer) {
      return NextResponse.json(
        { error: 'Invalid or already-used claim link' },
        { status: 404 },
      );
    }

    if (transfer.status !== 'pending_claim') {
      return NextResponse.json(
        { error: transfer.status === 'completed' ? 'These funds have already been claimed' : `Transfer is ${transfer.status}` },
        { status: 409 },
      );
    }

    if (transfer.expires_at && new Date(transfer.expires_at) < new Date()) {
      return NextResponse.json(
        { error: 'This claim link has expired. Ask the sender to cancel and resend.' },
        { status: 410 },
      );
    }

    // Call the atomic RPC to credit the recipient and unlock the sender
    const { error: rpcError } = await adminSupabase.rpc('claim_transfer', {
      p_recipient_id: user.id,
      p_claim_token_hash: tokenHash,
    });

    if (rpcError) {
      console.error('[Claim API] RPC error:', rpcError);

      if (rpcError.message?.includes('Transfer expired')) {
        return NextResponse.json(
          { error: 'This claim link has expired. Ask the sender to cancel and resend.' },
          { status: 410 },
        );
      }

      return NextResponse.json(
        { error: rpcError.message || 'Failed to claim transfer' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      amount: transfer.amount,
    });
  } catch (error) {
    console.error('[Claim API] Critical error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
