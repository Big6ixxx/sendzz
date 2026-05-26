import { createAdminClient, createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { transferId } = await req.json();

    if (!transferId || typeof transferId !== 'string') {
      return NextResponse.json(
        { error: 'transferId is required' },
        { status: 400 },
      );
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

    // Call the atomic RPC — it validates ownership, expiry, and status
    const { error: rpcError } = await adminSupabase.rpc('reclaim_transfer', {
      p_transfer_id: transferId,
      p_sender_id: user.id,
    });

    if (rpcError) {
      console.error('[Reclaim API] RPC error:', rpcError);

      if (rpcError.message?.includes('not yet expired')) {
        return NextResponse.json(
          { error: 'This transfer has not expired yet. The recipient still has time to claim it.' },
          { status: 409 },
        );
      }
      if (rpcError.message?.includes('not owned by sender')) {
        return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
      }
      if (rpcError.message?.includes('cannot be reclaimed')) {
        return NextResponse.json(
          { error: rpcError.message },
          { status: 409 },
        );
      }

      return NextResponse.json(
        { error: rpcError.message || 'Failed to reclaim transfer' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Reclaim API] Critical error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
