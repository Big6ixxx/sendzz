import { updateBridgeStatus } from '@/lib/supabase/transactions';
import { NextRequest, NextResponse } from 'next/server';
import { PLACEHOLDER_TX_HASH } from '@/lib/explorers';

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

    // `mint_tx_hash` holds a transaction hash or nothing. It previously took the sentinel
    // 'CONFIRMED_ON_CHAIN' whenever the caller had no hash to offer, which made the row
    // look settled while leaving no way to ever reach the transaction — and because
    // updateBridgeStatus treats an existing real hash as authoritative, the sentinel
    // stuck. Write null instead: the pending-claims reconciler re-derives the real hash
    // from the destination chain's delivery log and fills it in on a later pass.
    const isUsableHash = (h: string | null | undefined): h is string =>
      !!h &&
      h.trim() !== '' &&
      h.toLowerCase() !== 'n/a' &&
      h.toUpperCase() !== 'CONFIRMED_ON_CHAIN' &&
      h !== PLACEHOLDER_TX_HASH;

    const targetMintHash = isUsableHash(mintTxHash) ? mintTxHash : undefined;
    console.log(
      `[Bridge Complete API] Recording claim — burn: ${burnTxHash} | mint: ${targetMintHash ?? 'unresolved (left null for reconciliation)'}`,
    );
    await updateBridgeStatus(burnTxHash, 'complete', targetMintHash);
    return NextResponse.json({ ok: true, mintTxHash: targetMintHash ?? null });
  } catch (error) {
    console.error('[Bridge Complete] Error:', error);
    return NextResponse.json({ error: 'Failed to update bridge status' }, { status: 500 });
  }
}
