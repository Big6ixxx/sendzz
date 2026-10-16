import { updateBridgeStatus, verifyBridgeClaimSettled } from '@/lib/supabase/transactions';
import { NextRequest, NextResponse } from 'next/server';
import { isPlaceholderHash } from '@/lib/explorers';
import { requireUser } from '@/lib/auth/session';

/**
 * POST /api/bridge/complete
 * Called by the client when Circle's Iris API confirms a bridge is complete.
 * Updates the bridge_transactions row so history shows "confirmed".
 */
export async function POST(req: NextRequest) {
  try {

    // Signed-in callers only.
    //
    // Marks a bridge delivered in our ledger. Open, anyone could write history against a burn
    // they did not make.
    try {
      await requireUser();
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { burnTxHash, mintTxHash, delivered } = await req.json();

    if (!burnTxHash) {
      return NextResponse.json({ error: 'Missing burnTxHash' }, { status: 400 });
    }

    // Three outcomes, because "no hash" means two different things.
    //
    // A real hash is stored as-is. `delivered` — the caller says the funds arrived but has no
    // hash to show for it — is checked against the destination chain below, which records the
    // placeholder itself when delivery is real. Writing null there left `mint_tx_hash` empty,
    // and the pending-claims query keys off exactly that, so the card vanished on click and
    // came back on the next poll, forever.
    //
    // Anything else stays null so the reconciler can fill in the real hash later. Never the old
    // 'CONFIRMED_ON_CHAIN' sentinel: it made a row look settled while leaving no way to reach
    // the transaction, and updateBridgeStatus treated it as authoritative, so it stuck.
    // `delivered` without a hash is a CLAIM by the client, not proof. Taking it at face value is
    // how a 101 USDC Stellar->Base transfer was recorded as arrived when it never minted: the
    // EVM claim returns 'N/A' both when a claim is merely already in flight and when a UserOp
    // was sent but never confirmed, the caller read either as "delivered", and the placeholder
    // this wrote removed the Claim button — leaving the funds attested and unreachable.
    //
    // So on any chain we can read, ask the chain. verifyBridgeClaimSettled checks delivery on
    // the destination (fail-closed: an unreachable RPC is "not delivered") and records the
    // result itself only if it is real. Otherwise the row stays null and the claim stays open.
    //
    // Solana included: verifyBridgeClaimSettled reads its `used_nonce` account. It used to be
    // the exception, trusted on the client's word, because it had no delivery read.
    if (isPlaceholderHash(mintTxHash) && delivered) {
      const verdict = await verifyBridgeClaimSettled(burnTxHash);
      console.log(
        `[Bridge Complete API] Client reported delivery for ${burnTxHash} — chain says ` +
          `${verdict.settled ? 'delivered' : 'NOT delivered; leaving it claimable'}`,
      );
      return NextResponse.json({
        ok: true,
        delivered: verdict.settled,
        mintTxHash: verdict.mintTxHash,
      });
    }

    const targetMintHash = !isPlaceholderHash(mintTxHash) ? mintTxHash : undefined;
    console.log(
      `[Bridge Complete API] Recording claim — burn: ${burnTxHash} | mint: ${targetMintHash ?? 'unresolved (left null for reconciliation)'}`,
    );
    await updateBridgeStatus(burnTxHash, 'complete', targetMintHash);
    return NextResponse.json({
      ok: true,
      delivered: !!targetMintHash,
      mintTxHash: targetMintHash ?? null,
    });
  } catch (error) {
    console.error('[Bridge Complete] Error:', error);
    return NextResponse.json({ error: 'Failed to update bridge status' }, { status: 500 });
  }
}
