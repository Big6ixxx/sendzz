import { recordBridgeTransaction } from '@/lib/supabase/transactions';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { email, userEmail, sourceChain, destChain, amountUsdc, burnTxHash } = await req.json();
    const targetEmail = email || userEmail;

    if (!targetEmail || !sourceChain || !destChain || !burnTxHash) {
      return NextResponse.json(
        { error: 'email, sourceChain, destChain, and burnTxHash are required' },
        { status: 400 },
      );
    }

    await recordBridgeTransaction({
      userEmail: targetEmail,
      sourceChain,
      destChain,
      amountUsdc: Number(amountUsdc) || 0,
      burnTxHash,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[api/bridge/record] Error recording bridge tx:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to record bridge tx' },
      { status: 500 },
    );
  }
}
