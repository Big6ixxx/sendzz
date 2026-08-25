/**
 * Scratch records for bridges that happen inside a withdrawal.
 *
 * Separate from `/api/bridge/record` on purpose. That endpoint writes `bridge_transactions`,
 * which is the user's bridge history; a consolidation is not a transfer they chose to make and
 * must not appear there or count towards any total.
 *
 * A row here exists only between the burn and the delivery. POST writes it the moment the burn
 * lands, DELETE removes it as soon as the funds arrive, so a completed withdrawal leaves no
 * trace. What it buys is the window in between: if delivery fails, the burn is still known and
 * the user can finish it from Pending Claims instead of the USDC being invisible.
 */
import { supabaseAdmin } from '@/lib/supabase/adminClient';
import { requireUser } from '@/lib/auth/session';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

async function userIdFor(accessToken?: string): Promise<string | null> {
  const { email } = await requireUser(accessToken);
  const { data } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  return data?.id ?? null;
}

function tokenFrom(req: Request): string | undefined {
  return req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || undefined;
}

export async function POST(req: Request) {
  try {
    const { burnTxHash, sourceChain, destChain, amountUsdc } = await req.json();
    if (!burnTxHash || !sourceChain || !destChain) {
      return NextResponse.json({ error: 'burnTxHash, sourceChain and destChain are required' }, { status: 400 });
    }

    const userId = await userIdFor(tokenFrom(req));
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Idempotent: the same burn recorded twice is one row, never a duplicate claim.
    const { error } = await supabaseAdmin
      .from('consolidation_claims')
      .upsert(
        {
          user_id: userId,
          burn_tx_hash: burnTxHash,
          source_chain: sourceChain,
          dest_chain: destChain,
          amount: Number(amountUsdc) || 0,
        },
        { onConflict: 'burn_tx_hash' },
      );

    if (error) {
      console.error('[api/bridge/consolidation] record failed:', error.message);
      return NextResponse.json({ error: 'Failed to record' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/bridge/consolidation] POST error:', err);
    return NextResponse.json({ error: 'Failed to record' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const burnTxHash = new URL(req.url).searchParams.get('burnTxHash');
    if (!burnTxHash) {
      return NextResponse.json({ error: 'burnTxHash is required' }, { status: 400 });
    }

    const userId = await userIdFor(tokenFrom(req));
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Scoped to the caller: a burn hash is public, and clearing someone else's outstanding
    // claim would hide money they are still owed.
    const { error } = await supabaseAdmin
      .from('consolidation_claims')
      .delete()
      .eq('burn_tx_hash', burnTxHash)
      .eq('user_id', userId);

    if (error) {
      console.error('[api/bridge/consolidation] clear failed:', error.message);
      return NextResponse.json({ error: 'Failed to clear' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/bridge/consolidation] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to clear' }, { status: 500 });
  }
}
