import { updateBridgeStatus } from '@/lib/supabase/transactions';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/bridge/complete
 * Called by the client when Circle's Iris API confirms a bridge is complete.
 * Updates the bridge_transactions row so history shows "confirmed".
 */
export async function POST(req: NextRequest) {
  try {
    const { burnTxHash, mintTxHash } = await req.json();

    if (!burnTxHash) {
      return NextResponse.json({ error: 'Missing burnTxHash' }, { status: 400 });
    }

    await updateBridgeStatus(burnTxHash, 'complete', mintTxHash);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[Bridge Complete] Error:', error);
    return NextResponse.json({ error: 'Failed to update bridge status' }, { status: 500 });
  }
}
