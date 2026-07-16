import { NextRequest, NextResponse } from 'next/server';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { Transaction, PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';

export async function POST(req: NextRequest) {
  try {
    const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY;
    const CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET;
    const FEEPAYER_WALLET_ID = process.env.CIRCLE_SOLANA_FEEPAYER_WALLET_ID;

    if (!CIRCLE_API_KEY || !CIRCLE_ENTITY_SECRET || !FEEPAYER_WALLET_ID) {
      return NextResponse.json(
        { error: 'Circle DCW environment variables are missing (API Key, Entity Secret, or Wallet ID).' },
        { status: 500 }
      );
    }

    const body = await req.json();
    const { transaction } = body as { transaction?: string };

    if (!transaction || typeof transaction !== 'string') {
      return NextResponse.json({ error: 'transaction (base64 string) is required' }, { status: 400 });
    }

    const circleWalletAddress = process.env.CIRCLE_SOLANA_FEEPAYER_ADDRESS;

    if (!circleWalletAddress) {
      return NextResponse.json(
        { error: 'CIRCLE_SOLANA_FEEPAYER_ADDRESS is missing in environment variables.' },
        { status: 500 }
      );
    }

    // Decode the transaction, replace the feePayer with the Circle DCW address
    const txBytes = Buffer.from(transaction, 'base64');
    const tx = Transaction.from(txBytes);
    tx.feePayer = new PublicKey(circleWalletAddress);

    // Also replace the eventRentPayer in the depositForBurn instruction (index 1 in the keys array)
    // only if the instruction targets the TokenMessengerMinterV2 program (burn transaction).
    if (tx.instructions.length > 0) {
      const firstIx = tx.instructions[0];
      const TOKEN_MESSENGER_MINTER_V2_PID = 'CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe';
      if (firstIx.programId.toBase58() === TOKEN_MESSENGER_MINTER_V2_PID && firstIx.keys.length > 1) {
        firstIx.keys[1].pubkey = new PublicKey(circleWalletAddress);
      }
    }

    const updatedTransactionBase64 = tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString('base64');

    // Initialize the Circle DCW Client
    const circleClient = initiateDeveloperControlledWalletsClient({
      apiKey: CIRCLE_API_KEY,
      entitySecret: CIRCLE_ENTITY_SECRET,
    });

    // Ask Circle's SDK to sign the transaction.
    // Circle will deserialize the transaction, find its wallet address as the feePayer,
    // apply our Gas Policy, and sign it.
    const response = await circleClient.signTransaction({
      walletId: FEEPAYER_WALLET_ID,
      rawTransaction: updatedTransactionBase64,
    });

    const sponsoredTransaction = response.data?.signedTransaction;

    if (!sponsoredTransaction) {
      console.error('[solana-sponsor] No signedTransaction returned from Circle DCW:', response);
      return NextResponse.json(
        { error: 'Circle did not return a sponsored transaction' },
        { status: 502 }
      );
    }

    return NextResponse.json({ sponsoredTransaction });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[solana-sponsor] Unexpected error:', err);
    return NextResponse.json({ error: `Internal server error: ${errorMsg}` }, { status: 500 });
  }
}
