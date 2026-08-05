

/**
 * POST /api/bridge/solana-claim
 *
 * Claims a CCTP V2 transfer whose destination is Solana. The Circle fee-payer wallet
 * signs and submits, so the user spends no SOL and signs nothing.
 *
 * That is possible because CCTP only restricts who may deliver a message when the
 * burn set a `destinationCaller`; ours don't. The mint lands in the token account
 * named inside the attested message, so the deliverer's identity has no bearing on
 * where the funds go — which makes a wallet signature pure friction. Delivering
 * server-side also removes the browser round-trip where the sponsor's signature and
 * the user's had to survive one serialize/deserialize cycle each.
 *
 * Body: { burnTxHash, sourceChain, solanaAddress, messageBytes?, attestation? }
 * Returns: { txHash } — the Solana signature of the mint.
 */

import { NextResponse } from 'next/server';
import { Buffer } from 'buffer';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { Connection, PublicKey } from '@solana/web3.js';
import { buildReceiveMessageOnSolanaTx } from '@/lib/circle/solana-gateway';
import { fetchAttestation } from '@/lib/circle/gateway';

const SOLANA_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

/** How long to wait for the mint to confirm before handing the retry back to the caller. */
const CONFIRM_TIMEOUT_MS = 60_000;

/**
 * A replayed claim is the expected outcome of a double-click or a retry after a
 * dropped response, not a failure — the funds are already delivered.
 */
function isAlreadyClaimed(raw: string): boolean {
  const lower = raw.toLowerCase();
  return (
    lower.includes('nonce already used') ||
    lower.includes('already received') ||
    lower.includes('already processed') ||
    lower.includes('alreadyprocessed')
  );
}

export async function POST(req: Request) {
  try {
    const {
      burnTxHash,
      sourceChain,
      solanaAddress,
      messageBytes: suppliedMessage,
      attestation: suppliedAttestation,
    } = (await req.json()) as {
      burnTxHash?: string;
      sourceChain?: string;
      solanaAddress?: string;
      messageBytes?: string;
      attestation?: string;
    };

    if (!solanaAddress) {
      return NextResponse.json({ error: 'solanaAddress is required' }, { status: 400 });
    }

    const apiKey = process.env.CIRCLE_API_KEY;
    const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
    const feePayerWalletId = process.env.CIRCLE_SOLANA_FEEPAYER_WALLET_ID;
    const feePayerAddress = process.env.CIRCLE_SOLANA_FEEPAYER_ADDRESS;

    if (!apiKey || !entitySecret || !feePayerWalletId || !feePayerAddress) {
      console.error('[solana-claim] Circle fee-payer environment is incomplete.');
      return NextResponse.json(
        { error: 'Claims are temporarily unavailable. Your funds are safe — please try again shortly.' },
        { status: 500 },
      );
    }

    // Prefer a fresh attestation: the one the client holds may predate Circle
    // finalising the message, and a stale attestation fails verification on-chain.
    let messageBytes = suppliedMessage;
    let attestation = suppliedAttestation;
    if (burnTxHash && sourceChain) {
      const fresh = await fetchAttestation(sourceChain, burnTxHash);
      if (fresh.status === 'complete' && fresh.attestation && fresh.messageBytes) {
        messageBytes = fresh.messageBytes;
        attestation = fresh.attestation;
      }
    }

    if (!messageBytes || !attestation) {
      return NextResponse.json(
        { error: 'Circle is still verifying this transfer. Please try again in 1–2 minutes.' },
        { status: 409 },
      );
    }

    const connection = new Connection(SOLANA_RPC, 'confirmed');
    const payer = new PublicKey(feePayerAddress);

    const { transaction, alreadyClaimed } = await buildReceiveMessageOnSolanaTx(
      connection,
      payer,
      messageBytes,
      attestation,
      new PublicKey(solanaAddress),
    );

    if (alreadyClaimed) {
      return NextResponse.json({ alreadyClaimed: true }, { status: 200 });
    }

    const circleClient = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

    const unsigned = transaction
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString('base64');

    const signed = await circleClient.signTransaction({
      walletId: feePayerWalletId,
      rawTransaction: unsigned,
    });

    const signedTransaction = signed.data?.signedTransaction;
    if (!signedTransaction) {
      console.error('[solana-claim] Circle returned no signedTransaction:', signed);
      return NextResponse.json(
        { error: 'Claims are temporarily unavailable. Your funds are safe — please try again shortly.' },
        { status: 502 },
      );
    }

    const signedBytes = Buffer.from(signedTransaction, 'base64');

    // Preflight is left on: the burn already happened, so a transaction that would
    // fail on-chain is worth catching here — where the reason is still legible —
    // rather than after it lands and we have to reconstruct it from a status object.
    let signature: string;
    try {
      signature = await connection.sendRawTransaction(signedBytes, {
        preflightCommitment: 'confirmed',
        maxRetries: 5,
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      if (isAlreadyClaimed(raw)) {
        return NextResponse.json({ alreadyClaimed: true }, { status: 200 });
      }
      throw err;
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < CONFIRM_TIMEOUT_MS) {
      const { value: status } = await connection.getSignatureStatus(signature, {
        searchTransactionHistory: true,
      });

      if (status?.err) {
        const raw = JSON.stringify(status.err);
        if (isAlreadyClaimed(raw)) {
          return NextResponse.json({ alreadyClaimed: true }, { status: 200 });
        }
        console.error(`[solana-claim] Mint ${signature} failed on-chain:`, raw);
        return NextResponse.json(
          { error: "We couldn't complete the claim right now. Your funds are safe — please try again shortly." },
          { status: 502 },
        );
      }

      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
        console.log(`[solana-claim] ✓ Minted on Solana: ${signature}`);
        return NextResponse.json({ txHash: signature });
      }

      // Public RPCs drop packets; rebroadcasting the same signed bytes is idempotent.
      await connection
        .sendRawTransaction(signedBytes, { skipPreflight: true, maxRetries: 3 })
        .catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    // The transaction is signed and broadcast — it may still land. Return the
    // signature so the caller can record it rather than treating this as a loss.
    return NextResponse.json({ txHash: signature, pending: true });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    if (isAlreadyClaimed(raw)) {
      return NextResponse.json({ alreadyClaimed: true }, { status: 200 });
    }
    // A malformed message or a non-token-account recipient is permanent: the burn
    // encoded something unusable, so retrying can't help. Say which it is instead of
    // hiding it behind "try again shortly" and sending the user back into a loop.
    if (raw.startsWith('This transfer ')) {
      console.error('[solana-claim] Unclaimable message:', raw);
      return NextResponse.json({ error: raw, code: 'unclaimable' }, { status: 422 });
    }
    console.error('[solana-claim] Unexpected error:', err);
    return NextResponse.json(
      { error: "We couldn't complete the claim right now. Your funds are safe — please try again shortly." },
      { status: 500 },
    );
  }
}
