import { fetchAttestation, type SupportedChain } from '@/lib/circle/gateway';
import { fetchSolanaAttestation } from '@/lib/circle/solana-gateway';
import { fetchStellarAttestation } from '@/lib/circle/stellar-gateway';
import { NextRequest, NextResponse } from 'next/server';

type ExtendedChain = SupportedChain | 'solana' | 'stellar';

async function getAttestation(sourceChain: ExtendedChain, txHash: string) {
  if (sourceChain === 'solana') {
    return fetchSolanaAttestation(txHash);
  }
  if (sourceChain === 'stellar') {
    return fetchStellarAttestation(txHash);
  }
  return fetchAttestation(sourceChain as SupportedChain, txHash);
}

/**
 * GET /api/bridge/status?txHash=0x...&sourceChain=ethereum|solana|stellar
 *
 * Polls Circle's Iris API for the status of a CCTP burn using V2 endpoints.
 * Supports EVM chains (domain lookup), Solana (domain 5), and Stellar (domain 27).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const txHash = searchParams.get('txHash');
  const sourceChain = searchParams.get('sourceChain') as ExtendedChain;

  if (!txHash || !sourceChain) {
    return NextResponse.json(
      { error: 'Missing txHash or sourceChain' },
      { status: 400 },
    );
  }

  try {
    const result = await getAttestation(sourceChain, txHash);
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

    const result = await getAttestation(sourceChain as ExtendedChain, txHash);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Bridge Status] Error:', error);
    return NextResponse.json({ status: 'pending' }, { status: 200 });
  }
}
