import { createAdminClient } from '@/lib/supabase/server';
import { requireUserId } from '@/lib/auth/session';
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

    // ── Privy, not Supabase Auth ────────────────────────────────────────────
    //
    // This authenticated against `supabase.auth.getUser()`, which nothing else in the product
    // uses — users are provisioned in Privy, so no session ever existed here and the route was
    // unreachable in production. It read as authenticated while being, in practice, dead.
    //
    // `requireUserId` returns the `users.id` the RPC below already expects, which is what
    // `auth.getUser()` was standing in for.
    let session: Awaited<ReturnType<typeof requireUserId>>;
    try {
      session = await requireUserId();
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminSupabase = createAdminClient();

    const { error: rpcError } = await adminSupabase.rpc('accept_transfer', {
      p_transfer_id: transferId,
      p_recipient_id: session.userId,
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
