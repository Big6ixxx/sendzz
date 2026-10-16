import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { handleSponsorRequest } from '@/lib/solana/sponsor';

/**
 * Solana gas sponsor for USDC payments (off-ramp settlement): puts the Circle DCW fee payer on
 * the transaction and has Circle sign it.
 *
 * Only a USDC TransferChecked out of the caller's own wallet is signed — see
 * lib/solana/sponsor-policy. Unlike /api/bridge/solana-sponsor it mutates no instruction keys.
 */
export async function POST(req: Request) {
  // Signed-in callers only: every call spends our SOL.
  let caller;
  try {
    caller = await requireUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return handleSponsorRequest(req, 'transfer', caller);
}
