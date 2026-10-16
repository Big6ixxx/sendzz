import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { handleSponsorRequest } from '@/lib/solana/sponsor';

/**
 * Solana gas sponsor for CCTP burns: puts the Circle DCW fee payer on the transaction, moves the
 * `deposit_for_burn` event rent payer onto it, and has Circle sign.
 *
 * Only a single deposit_for_burn of the caller's own USDC is signed — see
 * lib/solana/sponsor-policy.
 */
export async function POST(req: Request) {
  // Signed-in callers only: every call spends our SOL.
  let caller;
  try {
    caller = await requireUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return handleSponsorRequest(req, 'burn', caller);
}
