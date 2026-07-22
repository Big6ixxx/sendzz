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

  console.log(`[Bridge Status API] GET request received - txHash: ${txHash}, sourceChain: ${sourceChain}`);

  if (!txHash || !sourceChain) {
    console.warn('[Bridge Status API] Missing parameters:', { txHash, sourceChain });
    return NextResponse.json(
      { error: 'Missing txHash or sourceChain' },
      { status: 400 },
    );
  }

  try {
    // Check DB first — if we already have a completed record with mint_tx_hash,
    // return it immediately without hitting Circle Iris again.
    const { supabaseAdmin } = await import('@/lib/supabase/adminClient');
    const { data: dbTx } = await supabaseAdmin
      .from('bridge_transactions')
      .select('attestation_status, mint_tx_hash')
      .eq('burn_tx_hash', txHash)
      .maybeSingle();

    // Check DB first — if already complete WITH a mint tx hash, return immediately (no need to hit Circle)
    if (dbTx?.attestation_status === 'complete' && dbTx?.mint_tx_hash) {
      return NextResponse.json({ status: 'complete', mintTxHash: dbTx.mint_tx_hash });
    }
    // Otherwise always hit Circle Iris to get fresh attestation data
    // (needed for manual claims where mint_tx_hash is still null)

    const result = await getAttestation(sourceChain, txHash);

    // If Circle's relayer already minted (forwardTxHash present), persist via
    // updateBridgeStatus so notifications fire correctly — same as Stellar path.
    // Only do this when relayer provided the mint hash; for EVM→EVM manual-claim
    // bridges, leave the DB alone so the monitoring loop can save it after the user signs.
    if (result.status === 'complete' && result.mintTxHash && dbTx && dbTx.attestation_status !== 'complete') {
      const { updateBridgeStatus } = await import('@/lib/supabase/transactions');
      updateBridgeStatus(txHash, 'complete', result.mintTxHash).catch(() => {});
    }

    console.log(`[Bridge Status API] Attestation query result for ${txHash}:`, {
      status: result.status,
      hasAttestation: !!result.attestation,
      hasMessageBytes: !!result.messageBytes,
      mintTxHash: result.mintTxHash,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Bridge Status API] Failed to fetch attestation:', error);
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
