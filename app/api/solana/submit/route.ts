import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { handleSubmitRequest } from '@/lib/solana/sponsor';

/**
 * Submit a USDC payment prepared by /api/solana/sponsor and signed by the user: the fee payer
 * signs, we broadcast and wait. See lib/solana/sponsor for the whole flow.
 *
 * Body: { transaction: base64, withdrawalOrderId? }
 * Returns: { txHash } | { txHash, pending: true } | { error, code }
 */
export async function POST(req: Request) {
  // Signed-in callers only: every call spends our SOL.
  let caller;
  try {
    caller = await requireUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return handleSubmitRequest(req, caller);
}
