import { sendTransferEmail } from '@/lib/email/sendEmail';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import crypto from 'crypto';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { recipientEmail, amount, note } = await req.json();

    if (!recipientEmail || !amount) {
      return NextResponse.json(
        { error: 'Recipient email and amount are required' },
        { status: 400 },
      );
    }

    // 1. Authenticate sender
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const senderEmail = user.email!;
    const adminSupabase = createAdminClient();

    // 2. Generate claim token (only used if recipient doesn't exist)
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');

    // 3. Call the atomic transfer RPC
    // This handles: balance check, locking funds, and mapping to existing user
    const { data: transferId, error: rpcError } = await adminSupabase.rpc(
      'create_transfer_and_lock_balance',
      {
        p_sender_id: user.id,
        p_recipient_email: recipientEmail,
        p_amount: parseFloat(amount),
        p_note: note || null,
        p_claim_token_hash: tokenHash,
        p_expires_at: new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000,
        ).toISOString(), // 7 days
      },
    );

    if (rpcError) {
      console.error('[Transfer API] RPC Error:', rpcError);
      return NextResponse.json(
        { error: rpcError.message || 'Failed to process transfer' },
        { status: 500 },
      );
    }

    // 4. Check if the transfer resulted in a "pending_claim" status
    const { data: transfer } = await adminSupabase
      .from('transfers')
      .select('status, recipient_id')
      .eq('id', transferId)
      .single();

    const claimRequired = transfer?.status === 'pending_claim';

    // 5. Send Notification Email
    try {
      await sendTransferEmail(recipientEmail, amount, senderEmail);
      // If claim is required, we could send a specific link with the rawToken
      // For now, sendTransferEmail uses a generic template
    } catch (emailErr) {
      console.error('[Transfer API] Email notification failed:', emailErr);
      // We don't fail the whole request if email fails, but we log it
    }

    return NextResponse.json({
      success: true,
      transferId,
      claimRequired,
      // In a real app, you might return the txHash if it was a blockchain tx
      // Here we rely on the internal ledger for now
    });
  } catch (error) {
    console.error('[Transfer API] Critical Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 },
    );
  }
}
