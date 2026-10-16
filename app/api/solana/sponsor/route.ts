import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { handleSponsorRequest } from '@/lib/solana/sponsor';

/**
 * Prepare a sponsored USDC payment (direct sends and off-ramp settlement).
 *
 * Checks the client's transaction against lib/solana/sponsor-policy, makes the Circle DCW fee
 * payer its fee payer and the rent payer of any new token account, and returns it UNSIGNED for
 * the user to sign. /api/solana/submit adds our signature and broadcasts — see lib/solana/sponsor.
 */
export async function POST(req: Request) {
  // Signed-in callers only: what this prepares spends our SOL once submitted.
  let caller;
  try {
    caller = await requireUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return handleSponsorRequest(req, 'transfer', caller);
}
