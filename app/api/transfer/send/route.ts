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

    // 2. Generate claim token — required for all transfers (universal escrow)
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

    // 4. Send Notification Email — all transfers are now pending_claim (universal escrow)
    try {
      await sendTransferEmail(recipientEmail, amount, senderEmail, {
        isPendingClaim: true,
        rawToken,
        note: note || undefined,
      });
    } catch (emailErr) {
      console.error('[Transfer API] Email notification failed:', emailErr);
      // Don't fail the whole request if email fails
    }

    return NextResponse.json({
      success: true,
      transferId,
      claimRequired: true,
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
