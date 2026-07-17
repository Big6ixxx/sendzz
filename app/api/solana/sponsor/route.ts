import { NextRequest, NextResponse } from 'next/server';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { Transaction, PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';

/**
 * Generic Solana gas sponsor: sets the Circle DCW fee-payer on an arbitrary transaction and
 * has Circle sign it (paying the fee under our gas policy). Unlike /api/bridge/solana-sponsor,
 * it does NOT mutate any instruction keys — that endpoint is burn-specific (it rewrites the
 * depositForBurn eventRentPayer at instruction[0].keys[1], which for a plain SPL transfer is
 * the DESTINATION and would corrupt the transfer). Use this for off-ramp settlement transfers.
 */
export async function POST(req: NextRequest) {
  try {
    const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY;
    const CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET;
    const FEEPAYER_WALLET_ID = process.env.CIRCLE_SOLANA_FEEPAYER_WALLET_ID;
    const circleWalletAddress = process.env.CIRCLE_SOLANA_FEEPAYER_ADDRESS;

    if (!CIRCLE_API_KEY || !CIRCLE_ENTITY_SECRET || !FEEPAYER_WALLET_ID || !circleWalletAddress) {
      return NextResponse.json(
        { error: 'Circle DCW env vars missing (API Key, Entity Secret, Wallet ID, or Fee-payer Address).' },
        { status: 500 },
      );
    }

    const { transaction } = (await req.json()) as { transaction?: string };
    if (!transaction || typeof transaction !== 'string') {
      return NextResponse.json({ error: 'transaction (base64 string) is required' }, { status: 400 });
    }

    const tx = Transaction.from(Buffer.from(transaction, 'base64'));
    tx.feePayer = new PublicKey(circleWalletAddress);

    const updatedTransactionBase64 = tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString('base64');

    const circleClient = initiateDeveloperControlledWalletsClient({
      apiKey: CIRCLE_API_KEY,
      entitySecret: CIRCLE_ENTITY_SECRET,
    });

    const response = await circleClient.signTransaction({
      walletId: FEEPAYER_WALLET_ID,
      rawTransaction: updatedTransactionBase64,
    });

    const sponsoredTransaction = response.data?.signedTransaction;
    if (!sponsoredTransaction) {
      console.error('[solana/sponsor] No signedTransaction returned from Circle DCW:', response);
      return NextResponse.json({ error: 'Circle did not return a sponsored transaction' }, { status: 502 });
    }

    return NextResponse.json({ sponsoredTransaction });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[solana/sponsor] Unexpected error:', err);
    return NextResponse.json({ error: `Internal server error: ${errorMsg}` }, { status: 500 });
  }
}
