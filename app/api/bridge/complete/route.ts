import { updateBridgeStatus } from '@/lib/supabase/transactions';
import { NextRequest, NextResponse } from 'next/server';
import { isPlaceholderHash, PLACEHOLDER_TX_HASH } from '@/lib/explorers';

/**
 * POST /api/bridge/complete
 * Called by the client when Circle's Iris API confirms a bridge is complete.
 * Updates the bridge_transactions row so history shows "confirmed".
 */
export async function POST(req: NextRequest) {
  try {
    const { burnTxHash, mintTxHash, delivered } = await req.json();

    if (!burnTxHash) {
      return NextResponse.json({ error: 'Missing burnTxHash' }, { status: 400 });
    }

    // Three outcomes, because "no hash" means two different things.
    //
    // A real hash is stored as-is. `delivered` — the caller has proof the funds arrived but no
    // hash to show for it, which is how Solana reports an already-consumed nonce — stores the
    // placeholder, a state the UI already renders without a dead link. Writing null there left
    // `mint_tx_hash` empty, and the pending-claims query keys off exactly that, so the card
    // vanished on click and came back on the next poll, forever.
    //
    // Anything else stays null so the reconciler can fill in the real hash later. Never the old
    // 'CONFIRMED_ON_CHAIN' sentinel: it made a row look settled while leaving no way to reach
    // the transaction, and updateBridgeStatus treated it as authoritative, so it stuck.
    const targetMintHash = !isPlaceholderHash(mintTxHash)
      ? mintTxHash
      : delivered
        ? PLACEHOLDER_TX_HASH
        : undefined;
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
