import { createAdminClient, createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

/**
 * POST /api/transfer/accept
 * Body: { transferId: string }
 *
 * Allows an existing authenticated user to accept a pending incoming transfer
 * from their dashboard — no claim token needed.
 * Only works when recipient_id on the transfer matches the authenticated user.
 */
export async function POST(req: Request) {
  try {
    const { transferId } = await req.json();

    if (!transferId || typeof transferId !== 'string') {
      return NextResponse.json(
        { error: 'transferId is required' },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminSupabase = createAdminClient();

    const { error: rpcError } = await adminSupabase.rpc('accept_transfer', {
      p_transfer_id: transferId,
      p_recipient_id: user.id,
    });

    if (rpcError) {
      console.error('[Accept API] RPC error:', rpcError);

      if (rpcError.message?.includes('not the intended recipient')) {
        return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
      }
      if (rpcError.message?.includes('not pending')) {
        return NextResponse.json(
          { error: rpcError.message },
          { status: 409 },
        );
      }
      if (rpcError.message?.includes('expired')) {
        return NextResponse.json(
          { error: 'This transfer has expired. Ask the sender to resend.' },
          { status: 410 },
        );
      }

      return NextResponse.json(
        { error: rpcError.message || 'Failed to accept transfer' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Accept API] Critical error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
