import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

// Solana USDC mint (mainnet)
const SOLANA_USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

const SOLANA_RPC =
  process.env.SOLANA_RPC_URL ??
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  'https://api.mainnet-beta.solana.com';

/**
 * GET /api/balances/solana?address=<base58>
 *
 * Returns the USDC balance for the given Solana wallet.
 * Used by Smart Bridge when scanning for Solana-held USDC.
 */
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address');

  if (!address) {
    return NextResponse.json({ error: 'Missing address' }, { status: 400 });
  }

  let walletPubkey: PublicKey;
  try {
    walletPubkey = new PublicKey(address);
  } catch {
    return NextResponse.json({ error: 'Invalid Solana address' }, { status: 400 });
  }

  try {
    const connection = new Connection(SOLANA_RPC, 'confirmed');
    const ata = getAssociatedTokenAddressSync(SOLANA_USDC_MINT, walletPubkey);
    const info = await connection.getTokenAccountBalance(ata);
    const balance = Number(info.value.uiAmount ?? 0);

    return NextResponse.json({
      chain: 'solana',
      balance: balance.toString(),
      hasBalance: balance > 0,
    });
  } catch {
    // Token account doesn't exist = 0 balance
    return NextResponse.json({
      chain: 'solana',
      balance: '0',
      hasBalance: false,
    });
  }
}
