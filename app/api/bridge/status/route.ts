import { fetchAttestation, type SupportedChain } from '@/lib/circle/gateway';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/bridge/status?txHash=0x...&sourceChain=ethereum
 *
 * Polls Circle's Iris API for the status of a CCTP burn using V2 endpoints.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const txHash = searchParams.get('txHash');
  const sourceChain = searchParams.get('sourceChain') as SupportedChain;

  if (!txHash || !sourceChain) {
    return NextResponse.json(
      { error: 'Missing txHash or sourceChain' },
      { status: 400 },
    );
  }

  try {
    const result = await fetchAttestation(sourceChain, txHash);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Bridge Status] Error:', error);
    return NextResponse.json(
      {
        status: 'pending',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 200 },
    );
  }
}

/**
 * POST /api/bridge/status
 *
 * Accepts { txHash, sourceChain } and returns the attestation status.
 */
export async function POST(req: NextRequest) {
  try {
    const { txHash, sourceChain } = await req.json();

    if (!txHash || !sourceChain) {
      return NextResponse.json(
        { error: 'Missing txHash or sourceChain' },
        { status: 400 },
      );
    }

    const result = await fetchAttestation(sourceChain, txHash);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Bridge Status] Error:', error);
    return NextResponse.json({ status: 'pending' }, { status: 200 });
  }
}
