import { fetchAttestation } from '@/lib/circle/gateway';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/bridge/status?messageHash=0x...
 *
 * Polls Circle's Iris API for the attestation status of a CCTP burn.
 * Once Circle attests the burn, their own relayer automatically mints USDC
 * on Base — no server-side signer or hot wallet needed.
 *
 * The client can call this endpoint to show real-time bridge progress.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const messageHash = searchParams.get('messageHash');

  if (!messageHash || !messageHash.startsWith('0x')) {
    return NextResponse.json(
      { error: 'Missing or invalid messageHash' },
      { status: 400 },
    );
  }

  try {
    const result = await fetchAttestation(messageHash);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Bridge Status] Error:', error);
    return NextResponse.json(
      {
        status: 'pending',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 200 }, // Return 200 so client keeps polling
    );
  }
}

/**
 * POST /api/bridge/status
 *
 * Accepts { messageHash } and returns the attestation status.
 * Equivalent to GET but usable from fetch with a body.
 */
export async function POST(req: NextRequest) {
  try {
    const { messageHash } = await req.json();

    if (!messageHash) {
      return NextResponse.json(
        { error: 'Missing messageHash' },
        { status: 400 },
      );
    }

    const result = await fetchAttestation(messageHash);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Bridge Status] Error:', error);
    return NextResponse.json({ status: 'pending' }, { status: 200 });
  }
}
