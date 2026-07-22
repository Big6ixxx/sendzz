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
      .select('attestation_status, mint_tx_hash, dest_chain')
      .eq('burn_tx_hash', txHash)
      .maybeSingle();

    const isPlaceholder = (h: string | null | undefined) => 
      !h || h.trim() === '' || h.toLowerCase() === 'n/a' || h === '0x0000000000000000000000000000000000000000000000000000000000000000';

    const dbMintIsReal = dbTx?.mint_tx_hash && !isPlaceholder(dbTx.mint_tx_hash);

    // Check DB first — if already complete AND we have a real mint hash, return immediately (no need to hit Circle)
    if ((dbTx?.attestation_status as string) === 'complete' && dbMintIsReal) {
      return NextResponse.json({ status: 'complete', mintTxHash: dbTx.mint_tx_hash });
    }
    // Otherwise always hit Circle Iris to get fresh attestation data
    // (needed for manual claims where mint_tx_hash is still null)

    const result = await getAttestation(sourceChain, txHash);

    // Fallback: If DB is complete but Circle says pending/not_found, preserve completion status
    if (dbTx?.attestation_status === 'complete' && result.status !== 'complete') {
      result.status = 'complete';
      if (!result.mintTxHash && dbTx.mint_tx_hash) {
        result.mintTxHash = dbTx.mint_tx_hash;
      }
    }

    // If Iris attestation is complete but mintTxHash is still missing/manual-claim, check on-chain processed state
    if (result.status === 'complete' && !result.mintTxHash && result.messageBytes) {
      const destChain = dbTx?.dest_chain || 'base';
      const evmDestChains = ['base', 'arbitrum', 'optimism', 'polygon', 'avalanche', 'ethereum'];
      
      if (evmDestChains.includes(destChain.toLowerCase())) {
        try {
          const { createPublicClient, http, keccak256 } = await import('viem');
          const { getStandardRpcUrl } = await import('@/lib/web3/circle-client');

          const messageHash = keccak256(result.messageBytes as `0x${string}`);
          const client = createPublicClient({
            transport: http(getStandardRpcUrl(destChain)),
          });

          const MESSAGE_TRANSMITTER =
            process.env.NEXT_PUBLIC_SIMULATION_MODE === 'true'
              ? '0x81D40F2169b009c9103C280963d76e4B4d4c464B'
              : '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64';

          const isProcessed = await client.readContract({
            address: MESSAGE_TRANSMITTER as `0x${string}`,
            abi: [
              {
                name: 'processedMessages',
                type: 'function',
                stateMutability: 'view',
                inputs: [{ name: 'messageHash', type: 'bytes32' }],
                outputs: [{ name: '', type: 'bool' }],
              },
            ],
            functionName: 'processedMessages',
            args: [messageHash],
          }).catch(() => false);

          if (isProcessed) {
            console.log(`[Bridge Status API] Message already processed on-chain on ${destChain} for ${txHash}. Skipping expensive log query.`);
            result.mintTxHash = '0x0000000000000000000000000000000000000000000000000000000000000000';
          }
        } catch (chainErr) {
          console.error('[Bridge Status API] On-chain check failed:', chainErr);
        }
      }
    }

    // If Circle's relayer or the manual claim on-chain check complete, persist and update DB status
    const dbMintIsPlaceholder = !dbTx?.mint_tx_hash || isPlaceholder(dbTx.mint_tx_hash);
    const newMintIsReal = result.mintTxHash && !isPlaceholder(result.mintTxHash);

    if (
      result.status === 'complete' &&
      result.mintTxHash &&
      dbTx &&
      ((dbTx.attestation_status as string) !== 'complete' || (dbMintIsPlaceholder && newMintIsReal))
    ) {
      const { updateBridgeStatus } = await import('@/lib/supabase/transactions');
      await updateBridgeStatus(txHash, 'complete', result.mintTxHash).catch((err) => {
        console.error('[Bridge Status API] updateBridgeStatus failed:', err);
      });
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
