/**
 * POST /api/bridge/record — record a CCTP burn against the caller's account.
 *
 * ─── Authentication ──────────────────────────────────────────────────────────
 *
 * This took an `email` straight from the request body and recorded a bridge against it, with no
 * authentication at all: anyone could write bridge history into any account.
 *
 * The account is now the signed-in one, and the body's email is ignored entirely rather than
 * merely cross-checked — a value that is never read cannot be spoofed.
 *
 * It verifies the Privy token WITHOUT the session idle check, which is deliberate and the one
 * place in the app that does so. By the time this runs the burn is already irreversible, and a
 * burn with no row is invisible everywhere: it shows in no balance and on no claim screen, so
 * the USDC is stranded. Refusing to record one because a session lapsed in the seconds between
 * signing and reporting would destroy funds to enforce a timeout. Holding a valid token is proof
 * enough of identity for a write that can only ever help its own owner.
 */

import { recordBridgeTransaction } from '@/lib/supabase/transactions';
import { getVerifiedIdentity, touchSession } from '@/lib/auth/session';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const identity = await getVerifiedIdentity();
    if (!identity) {
      // The client surfaces this with the burn hash so the user can quote it to support —
      // see recordBurn in lib/web3/record-burn.ts.
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { sourceChain, destChain, amountUsdc, burnTxHash } = await req.json();

    if (!sourceChain || !destChain || !burnTxHash) {
      return NextResponse.json(
        { error: 'sourceChain, destChain, and burnTxHash are required' },
        { status: 400 },
      );
    }

    await recordBridgeTransaction({
      // The signed-in account, never the body. Callers still send `email`/`userEmail`; it is
      // read nowhere.
      userEmail: identity.email,
      sourceChain,
      destChain,
      amountUsdc: Number(amountUsdc) || 0,
      burnTxHash,
    });

    // Bridging is user-initiated, so it extends THIS device's session.
    await touchSession(identity.sessionId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[api/bridge/record] Error recording bridge tx:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to record bridge tx' },
      { status: 500 },
    );
  }
}
