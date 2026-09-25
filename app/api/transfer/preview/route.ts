import { createAdminClient, createClient } from '@/lib/supabase/server';
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import {
  RATE_LIMITS,
  checkRateLimit,
  rateLimitResponse,
} from '@/lib/security/rate-limit';

/**
 * GET /api/transfer/preview?token=<rawToken>
 *
 * Returns transfer details (amount, senderEmail, note, expiresAt) WITHOUT claiming.
 * Used by the /claim page to show a confirmation step before the user accepts.
 */
export async function GET(req: Request) {
  try {

    // Signed-in callers only.
    //
    // Prices a transfer using our rate and RPC calls. Free to anyone who knew the URL.
    try {
      await requireUser();
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Prices a transfer using our rate and RPC calls.
    {
      const limit = await checkRateLimit(RATE_LIMITS.read, null);
      if (!limit.allowed) return rateLimitResponse(limit);
    }
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 });
    }

    // Require authentication — the claim page gates on Privy login first
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const adminSupabase = createAdminClient();

    const { data: transfer, error } = await adminSupabase
      .from('transfers')
      .select('id, amount, sender_email, note, expires_at, status')
      .eq('claim_token_hash', tokenHash)
      .single();

    if (error || !transfer) {
      return NextResponse.json(
        { error: 'Invalid or already-used claim link' },
        { status: 404 },
      );
    }

    if (transfer.status !== 'pending_claim') {
      return NextResponse.json(
        {
          error:
            transfer.status === 'completed'
              ? 'These funds have already been claimed'
              : `Transfer is ${transfer.status}`,
        },
        { status: 409 },
      );
    }

    const isExpired =
      transfer.expires_at && new Date(transfer.expires_at) < new Date();

    if (isExpired) {
      return NextResponse.json(
        { error: 'This claim link has expired.' },
        { status: 410 },
      );
    }

    return NextResponse.json({
      amount: transfer.amount,
      senderEmail: transfer.sender_email,
      note: transfer.note ?? null,
      expiresAt: transfer.expires_at ?? null,
    });
  } catch (error) {
    console.error('[Preview API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
