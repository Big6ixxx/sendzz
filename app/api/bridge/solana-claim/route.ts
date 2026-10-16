

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
import { solanaRpcUrl } from '@/lib/solana/rpc';
import { Buffer } from 'buffer';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  buildReceiveMessageOnSolanaTx,
  findSolanaMintSignature,
} from '@/lib/circle/solana-gateway';
import { signWithCircleFeePayer } from '@/lib/solana/circle-signer';
import {
  LOOKUP_TABLE_ENV,
  MAX_TRANSACTION_BYTES,
  claimLookupTables,
} from '@/lib/solana/lookup-table';
import { classifyClaimFailure, errorText, isAlreadyClaimed } from '@/lib/solana/claim-errors';
import { fetchAttestation } from '@/lib/circle/gateway';
import { privySolanaWallets, requireUser } from '@/lib/auth/session';
import { claimRecipientOwner } from '@/lib/solana/sponsor-policy';
import { preflightFeePayer } from '@/lib/solana/fee-payer';
import { classifySolanaSendError, SOLANA_SEND_MESSAGES } from '@/lib/solana/send-errors';
import bs58 from 'bs58';
import {
  RATE_LIMITS,
  checkRateLimit,
  peekRateLimit,
  rateLimitResponse,
} from '@/lib/security/rate-limit';

const SOLANA_RPC = solanaRpcUrl();

/** How long to wait for the mint to confirm before handing the retry back to the caller. */
const CONFIRM_TIMEOUT_MS = 60_000;

export async function POST(req: Request) {
  try {

    // Signed-in callers only.
    //
    // Signs the claim with our Circle wallet, so every call spends our SOL. Anonymous, it is a
    // faucet for arbitrary transactions.
    let caller;
    try {
      caller = await requireUser();
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const subject = caller.userId ?? caller.privyUserId;

    // Every call spends our SOL. Keyed on the account, not the IP.
    {
      const limit = await checkRateLimit(RATE_LIMITS.sponsor, subject);
      if (!limit.allowed) return rateLimitResponse(limit);
    }
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
    const feePayerAddress = process.env.CIRCLE_SOLANA_FEEPAYER_ADDRESS;

    // No wallet id: Circle's Solana signer identifies the fee payer by address and cluster.
    if (!apiKey || !entitySecret || !feePayerAddress) {
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

    // Only money arriving at the caller's OWN USDC account is delivered on our SOL. The address
    // in the body is a hint at most: the wallets come from Privy, and the destination comes from
    // the attested message itself, which nobody can edit.
    let wallets: string[];
    try {
      wallets = await privySolanaWallets(caller.privyUserId);
    } catch (err) {
      console.error('[solana-claim] Could not resolve the caller\'s Solana wallet:', (err as Error).message);
      return NextResponse.json(
        { error: 'Claims are temporarily unavailable. Your funds are safe — please try again shortly.' },
        { status: 503 },
      );
    }
    if (!wallets.includes(solanaAddress)) {
      return NextResponse.json({ error: 'That Solana wallet is not on this account.' }, { status: 403 });
    }
    const owner = claimRecipientOwner(messageBytes, [solanaAddress]);
    if (!owner) {
      console.warn(`[solana-claim] REFUSED for ${subject}: message does not mint to their wallet.`);
      return NextResponse.json(
        { error: 'This transfer is not addressed to your Solana wallet.', code: 'not_recipient' },
        { status: 403 },
      );
    }

    const connection = new Connection(SOLANA_RPC, 'confirmed');
    const payer = new PublicKey(feePayerAddress);

    const built = await buildReceiveMessageOnSolanaTx(
      connection,
      payer,
      messageBytes,
      attestation,
      new PublicKey(owner),
      await claimLookupTables(connection),
    );

    // Already delivered: hand back the mint, so the caller can record a real hash.
    const delivered = async () =>
      NextResponse.json(
        {
          alreadyClaimed: true,
          txHash: (await findSolanaMintSignature(connection, messageBytes!)) ?? null,
        },
        { status: 200 },
      );

    if (built.alreadyClaimed) return delivered();
    const { transaction, createsMintRecipient } = built;

    // Too large to send. Without a lookup table a claim is about 1264 bytes against a 1232-byte
    // limit, so this is all but certainly a missing or empty SOLANA_CCTP_LOOKUP_TABLE — say that
    // here, where it is still legible, rather than letting web3.js throw on serialize.
    const size = transaction.serialize().length;
    if (size > MAX_TRANSACTION_BYTES) {
      console.error(
        `[solana-claim] Built a ${size}-byte claim, over Solana's ${MAX_TRANSACTION_BYTES}-byte ` +
          `limit. Check ${LOOKUP_TABLE_ENV} — see scripts/create-solana-lookup-table.ts.`,
      );
      return NextResponse.json(
        { error: 'Claims are temporarily unavailable. Your funds are safe — please try again shortly.' },
        { status: 500 },
      );
    }

    // Creating the token account puts its rent on us, and closing it hands that rent to the
    // user — so it is allowed a few times a month, not once per claim. Only checked here; it is
    // spent once the mint confirms, so a claim that fails on our side — Circle
    // down, a stale attestation — does not count against the user.
    if (createsMintRecipient) {
      if (!(await peekRateLimit(RATE_LIMITS.solanaAtaRent, subject)).allowed) {
        console.warn(`[solana-claim] REFUSED token-account rent for ${subject}: monthly limit reached.`);
        return NextResponse.json(
          {
            error: 'Your Solana USDC account needs to be set up again before this can be delivered. Please contact support.',
            code: 'ata_rent_limited',
          },
          { status: 429 },
        );
      }
    }

    // An empty fee payer fails the claim with "no record of a prior credit" — say what it is,
    // and tell the admins, before signing anything.
    if ((await preflightFeePayer(connection, payer, createsMintRecipient ? 1 : 0)) === 'insufficient') {
      return NextResponse.json(
        { error: SOLANA_SEND_MESSAGES.sponsor_unfunded, code: 'sponsor_unfunded' },
        { status: 503 },
      );
    }

    let signedBytes: Buffer;
    try {
      const signed = await signWithCircleFeePayer({ apiKey, entitySecret, feePayer: payer, transaction });
      signedBytes = Buffer.from(signed.serialize());
    } catch (err) {
      console.error('[solana-claim] Circle would not sign the claim:', (err as Error).message);
      return NextResponse.json(
        { error: 'Claims are temporarily unavailable. Your funds are safe — please try again shortly.' },
        { status: 502 },
      );
    }

    // Preflight is left on: the burn already happened, so a transaction that would
    // fail on-chain is worth catching here — where the reason is still legible —
    // rather than after it lands and we have to reconstruct it from a status object.
    // The fee payer signs first, so its signature is the transaction id. Read from the signed
    // bytes so it is known before the broadcast, which may answer with nothing.
    let signature = bs58.encode(signedBytes.subarray(1, 65));
    try {
      signature = await connection.sendRawTransaction(signedBytes, {
        preflightCommitment: 'confirmed',
        maxRetries: 5,
      });
    } catch (err) {
      // Preflight failures carry the program's logs separately; read them too.
      const raw = errorText(err);
      // These bytes already went out: confirm the signature below like any other broadcast.
      if (classifySolanaSendError(raw)?.code !== 'already_landed') {
        const failure = classifyClaimFailure(raw);
        if (failure.kind === 'already_claimed') return delivered();
        console.error('[solana-claim] Preflight refused the claim:', raw);
        return claimFailureResponse(failure);
      }
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < CONFIRM_TIMEOUT_MS) {
      const { value: status } = await connection.getSignatureStatus(signature, {
        searchTransactionHistory: true,
      });

      if (status?.err) {
        // The status names only a custom error number; the program's words are in the logs.
        const landed = await connection
          .getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
          .catch(() => null);
        const raw = errorText(status.err, landed?.meta?.logMessages);
        const failure = classifyClaimFailure(raw);
        if (failure.kind === 'already_claimed') return delivered();
        console.error(`[solana-claim] Mint ${signature} failed on-chain:`, raw);
        return claimFailureResponse(failure);
      }

      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
        console.log(`[solana-claim] ✓ Minted on Solana: ${signature}`);
        if (createsMintRecipient) await checkRateLimit(RATE_LIMITS.solanaAtaRent, subject);
        return NextResponse.json({ txHash: signature });
      }

      // Public RPCs drop packets; rebroadcasting the same signed bytes is idempotent.
      await connection
        .sendRawTransaction(signedBytes, { skipPreflight: true, maxRetries: 3 })
        .catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    // The transaction is signed and broadcast — it may still land. Return the signature so the
    // caller can follow it, but `pending` means NOT delivered: callers must not record it as a
    // mint (see claimOnSolana in lib/web3/bridge-claim).
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

/** The response for a claim that failed for a reason other than already being delivered. */
function claimFailureResponse(failure: Exclude<ReturnType<typeof classifyClaimFailure>, { kind: 'already_claimed' }>) {
  if (failure.kind === 'attestation_expired') {
    return NextResponse.json({ error: failure.error, code: failure.code }, { status: 409 });
  }
  return NextResponse.json(
    { error: failure.error, code: failure.code, detail: failure.detail },
    { status: 502 },
  );
}
