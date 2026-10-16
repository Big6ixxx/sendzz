/**
 * The shared body of the Solana fee-payer routes.
 *
 * Two shapes:
 *
 *   * CCTP burns (/api/bridge/solana-sponsor): we sign first and hand the transaction back; the
 *     client adds its signatures and broadcasts. The fee payer risks only the fee and the event
 *     account's rent, both bounded by the policy.
 *
 *   * USDC payments — sends and off-ramp settlement — in two steps. /api/solana/sponsor
 *     *prepares*: checks the client's transaction, moves any new token account's rent onto the
 *     fee payer, and returns it UNSIGNED. The user signs that. /api/solana/submit then checks it
 *     again, adds our signature, broadcasts, and waits. Our signature never leaves the server
 *     before we have broadcast it ourselves, which is what makes the rent quota enforceable:
 *     it is spent only when we see the transaction land, and nobody can land it without us.
 *
 * Which transactions are acceptable lives in lib/solana/sponsor-policy; everything else is here,
 * so a fix to one route cannot miss another.
 */
import 'server-only';

import { NextResponse, after } from 'next/server';
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { privySolanaWallets, type SessionUser } from '@/lib/auth/session';
import {
  RATE_LIMITS,
  checkRateLimit,
  peekRateLimit,
  rateLimitResponse,
} from '@/lib/security/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/adminClient';
import {
  BURN_EVENT_RENT_PAYER_INDEX,
  checkSponsoredBurn,
  checkSponsoredTransfer,
  decodeLegacyTransaction,
  newAccountMinimumMet,
  sponsorAtaRent,
  type PolicyResult,
} from './sponsor-policy';
import { TOKEN_MESSENGER_MINTER_V2 } from '@/lib/circle/solana-gateway';
import { solanaRpcUrl } from './rpc';
import { getFeeTreasury } from '@/lib/fees/platform-fees';
import { preflightFeePayer } from './fee-payer';
import { reserveRent } from './rent-quota';
import { parseSendRecord } from './send-record';
import { classifySolanaSendError, SOLANA_SEND_MESSAGES } from './send-errors';

/** FEE_TREASURY_SOLANA as a key, or null when unset or malformed. */
function solanaFeeTreasury(): PublicKey | null {
  const address = getFeeTreasury('solana');
  if (!address) return null;
  try {
    return new PublicKey(address);
  } catch {
    console.error('[solana-sponsor] FEE_TREASURY_SOLANA is not a valid Solana address.');
    return null;
  }
}

export type SponsorKind = 'transfer' | 'burn';

const UNAVAILABLE = 'Gas sponsorship is temporarily unavailable. Please try again shortly.';

/** How long submit waits for the send to confirm before answering "still confirming". */
const CONFIRM_TIMEOUT_MS = 45_000;

/**
 * How much longer the server keeps watching a "still confirming" send, after answering, to write
 * its history row. Past a blockhash's ~90s life the send has either landed or never will.
 */
const LATE_CONFIRM_TIMEOUT_MS = 120_000;


interface FeePayerEnv {
  apiKey: string;
  entitySecret: string;
  walletId: string;
  feePayer: PublicKey;
}

function feePayerEnv(tag: string): FeePayerEnv | null {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  const walletId = process.env.CIRCLE_SOLANA_FEEPAYER_WALLET_ID;
  const address = process.env.CIRCLE_SOLANA_FEEPAYER_ADDRESS;
  if (!apiKey || !entitySecret || !walletId || !address) {
    console.error(`${tag} Circle fee-payer environment is incomplete.`);
    return null;
  }
  return { apiKey, entitySecret, walletId, feePayer: new PublicKey(address) };
}

const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status });

const refused = () =>
  json({ error: 'This transaction cannot be sponsored.', code: 'sponsor_refused' }, 403);

const rentLimited = () =>
  json(
    {
      error:
        "You've opened the most new Solana accounts we can cover this month. Ask the recipient to " +
        'set up their USDC account first, or send on another network.',
      code: 'ata_rent_limited',
    },
    429,
  );

const sponsorUnfunded = () =>
  json({ error: SOLANA_SEND_MESSAGES.sponsor_unfunded, code: 'sponsor_unfunded' }, 503);

/** Which of `accounts` do not exist yet — the ones whose rent we would actually pay. */
async function missingAccounts(connection: Connection, accounts: PublicKey[]): Promise<PublicKey[]> {
  if (accounts.length === 0) return [];
  const infos = await connection.getMultipleAccountsInfo(accounts, 'confirmed');
  return accounts.filter((_, i) => !infos[i]);
}

/**
 * Whether this caller may open `count` more token accounts on us. Peeks only, for the prepare
 * step, which signs nothing — submit reserves the quota for real (`reserveRent`).
 */
async function rentAllowed(subject: string, count: number): Promise<boolean> {
  if (count === 0) return true;
  const peek = await peekRateLimit(RATE_LIMITS.solanaSendAtaRent, subject);
  return peek.allowed && peek.used + count <= RATE_LIMITS.solanaSendAtaRent.limit;
}


/** The first of the caller's Privy wallets the transfer policy accepts as owner, or null. */
function transferOwner(tx: Transaction, feePayer: PublicKey, wallets: string[]) {
  for (const wallet of wallets) {
    const owner = new PublicKey(wallet);
    const verdict = checkSponsoredTransfer(tx, { feePayer, owner });
    if (verdict.ok) return { owner, verdict };
  }
  return null;
}

/**
 * Handle a sponsor request from an already-authenticated caller.
 *
 * Authentication stays in each route file, where the route-gate test can see it; this takes the
 * caller it produced.
 */
export async function handleSponsorRequest(
  req: Request,
  kind: SponsorKind,
  caller: SessionUser,
): Promise<Response> {
  const tag = kind === 'burn' ? '[solana-sponsor]' : '[solana/sponsor]';
  const subject = caller.userId ?? caller.privyUserId;
  try {
    // Keyed on the account, not the IP — an account is the thing that costs an attacker
    // something to replace. Preparing a payment signs nothing, so it is a read; the sponsor
    // allowance is spent at submit, where our SOL is.
    {
      const limit = await checkRateLimit(
        kind === 'burn' ? RATE_LIMITS.sponsor : RATE_LIMITS.read,
        subject,
      );
      if (!limit.allowed) return rateLimitResponse(limit);
    }

    const env = feePayerEnv(tag);
    if (!env) return json({ error: UNAVAILABLE }, 500);
    const { feePayer } = env;

    const { transaction } = (await req.json().catch(() => ({}))) as { transaction?: unknown };
    if (!transaction || typeof transaction !== 'string') {
      return json({ error: 'transaction (base64 string) is required' }, 400);
    }

    const tx = decodeLegacyTransaction(transaction);
    if (!tx) return json({ error: 'Unsupported transaction format' }, 400);

    // Whose USDC this moves is decided by Privy, not by the transaction: the authority in it must
    // be one of the embedded wallets Privy holds for this caller.
    let wallets: string[];
    try {
      wallets = await privySolanaWallets(caller.privyUserId);
    } catch (err) {
      console.error(`${tag} Could not resolve the caller's Solana wallet:`, (err as Error).message);
      return json({ error: UNAVAILABLE }, 503);
    }

    const connection = new Connection(solanaRpcUrl(), 'confirmed');

    if (kind === 'transfer') {
      const accepted = transferOwner(tx, feePayer, wallets);
      if (!accepted) {
        console.warn(`${tag} REFUSED to prepare for ${subject}: no wallet passes the policy`);
        return refused();
      }

      // Only now, with the transaction approved as sent, do we put ourselves into it — and check
      // the result as submit will.
      sponsorAtaRent(tx, accepted.owner, feePayer);
      const verdict = checkSponsoredTransfer(tx, { feePayer, owner: accepted.owner });
      if (!verdict.ok) {
        console.error(`${tag} rewritten transaction failed its own policy: ${verdict.reason}`);
        return refused();
      }

      const created = await missingAccounts(connection, verdict.rentPaidAccounts);
      if (!newAccountMinimumMet(verdict.totalSubunits, created.length)) {
        return json(
          { error: 'Sends to a new Solana address must be at least 1 USDC.', code: 'below_new_account_minimum' },
          400,
        );
      }
      if (!(await rentAllowed(subject, created.length))) return rentLimited();
      if ((await preflightFeePayer(connection, feePayer, created.length)) === 'insufficient') {
        return sponsorUnfunded();
      }

      return json({
        transaction: tx
          .serialize({ requireAllSignatures: false, verifySignatures: false })
          .toString('base64'),
        newAccounts: created.length,
      });
    }

    // Where a bridge's platform fee may go — the only token transfer a burn may carry.
    const feeTreasury = solanaFeeTreasury();
    let verdict: PolicyResult = { ok: false, reason: 'no Solana wallet on this account' };
    for (const wallet of wallets) {
      verdict = checkSponsoredBurn(tx, { feePayer, owner: new PublicKey(wallet), feeTreasury });
      if (verdict.ok) break;
    }
    if (!verdict.ok) {
      console.warn(`${tag} REFUSED to sponsor for ${subject}: ${verdict.reason}`);
      return refused();
    }

    if ((await preflightFeePayer(connection, feePayer, 0)) === 'insufficient') {
      return sponsorUnfunded();
    }

    tx.feePayer = feePayer;
    const burn = tx.instructions.find((ix) => ix.programId.equals(TOKEN_MESSENGER_MINTER_V2))!;
    burn.keys[BURN_EVENT_RENT_PAYER_INDEX].pubkey = feePayer;

    const circleClient = initiateDeveloperControlledWalletsClient({
      apiKey: env.apiKey,
      entitySecret: env.entitySecret,
    });
    const response = await circleClient.signTransaction({
      walletId: env.walletId,
      rawTransaction: tx
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString('base64'),
    });

    const sponsoredTransaction = response.data?.signedTransaction;
    if (!sponsoredTransaction) {
      console.error(`${tag} No signedTransaction returned from Circle DCW:`, response);
      return json({ error: 'Circle did not return a sponsored transaction' }, 502);
    }

    return json({ sponsoredTransaction });
  } catch (err) {
    console.error(`${tag} Unexpected error:`, err);
    return json({ error: 'Gas sponsorship failed. Please try again shortly.' }, 500);
  }
}

/**
 * Submit a prepared, user-signed USDC payment: re-check it, sign as fee payer, broadcast, and
 * wait for it.
 *
 * Answers `{ txHash }` once confirmed, `{ txHash, pending: true }` when it was broadcast but has
 * not confirmed in time (it may well still land — the client must not offer a retry), and an
 * error with a `code` otherwise. `blockhash_expired` is the one failure that guarantees nothing
 * was sent.
 *
 * `withdrawalOrderId` attaches the signature to the caller's withdrawal the moment it is
 * broadcast, before confirmation — so a closed tab cannot strand the payout. The Stellar route
 * does the same.
 */
export async function handleSubmitRequest(req: Request, caller: SessionUser): Promise<Response> {
  const tag = '[solana/submit]';
  const subject = caller.userId ?? caller.privyUserId;
  try {
    {
      const limit = await checkRateLimit(RATE_LIMITS.sponsor, subject);
      if (!limit.allowed) return rateLimitResponse(limit);
    }

    const env = feePayerEnv(tag);
    if (!env) return json({ error: UNAVAILABLE }, 500);
    const { feePayer } = env;

    const { transaction, withdrawalOrderId, record } = (await req.json().catch(() => ({}))) as {
      transaction?: unknown;
      withdrawalOrderId?: unknown;
      record?: unknown;
    };
    if (!transaction || typeof transaction !== 'string') {
      return json({ error: 'transaction (base64 string) is required' }, 400);
    }
    if (withdrawalOrderId !== undefined && typeof withdrawalOrderId !== 'string') {
      return json({ error: 'withdrawalOrderId must be a string' }, 400);
    }
    const sendRecord = parseSendRecord(record);
    if (record !== undefined && !sendRecord) {
      return json({ error: 'record must be { recipient, amount, note? }' }, 400);
    }

    const tx = decodeLegacyTransaction(transaction);
    if (!tx) return json({ error: 'Unsupported transaction format' }, 400);
    if (!tx.feePayer?.equals(feePayer)) {
      return json({ error: 'Prepare this transaction with /api/solana/sponsor first.' }, 400);
    }

    let wallets: string[];
    try {
      wallets = await privySolanaWallets(caller.privyUserId);
    } catch (err) {
      console.error(`${tag} Could not resolve the caller's Solana wallet:`, (err as Error).message);
      return json({ error: UNAVAILABLE }, 503);
    }

    const accepted = transferOwner(tx, feePayer, wallets);
    if (!accepted) {
      console.warn(`${tag} REFUSED for ${subject}: no wallet passes the policy`);
      return refused();
    }
    const { owner, verdict } = accepted;
    if (!verdict.ok) return refused();

    // The user's signature must be there and good BEFORE we add ours: a transaction we sign is
    // one anybody holding it can land.
    const ownerSig = tx.signatures.find((s) => s.publicKey.equals(owner))?.signature;
    if (!ownerSig || !tx.verifySignatures(false)) {
      return json({ error: 'The transaction is not signed by your wallet.' }, 400);
    }

    // A withdrawal hash is only ever attached to the caller's own withdrawal.
    if (withdrawalOrderId) {
      const { data: row } = caller.userId
        ? await supabaseAdmin
            .from('withdrawals')
            .select('id')
            .eq('provider_order_id', withdrawalOrderId)
            .eq('user_id', caller.userId)
            .maybeSingle()
        : { data: null };
      if (!row) return json({ error: 'Withdrawal not found.' }, 404);
    }

    const connection = new Connection(solanaRpcUrl(), 'confirmed');
    const created = await missingAccounts(connection, verdict.rentPaidAccounts);
    if (!newAccountMinimumMet(verdict.totalSubunits, created.length)) {
      return json(
        { error: 'Sends to a new Solana address must be at least 1 USDC.', code: 'below_new_account_minimum' },
        400,
      );
    }
    if ((await preflightFeePayer(connection, feePayer, created.length)) === 'insufficient') {
      return sponsorUnfunded();
    }
    // Last check before our signature goes on, so the quota is held by the time anything can land.
    const reserved = await reserveRent(created.length, () =>
      checkRateLimit(RATE_LIMITS.solanaSendAtaRent, subject),
    );
    if (!reserved) return rentLimited();

    const circleClient = initiateDeveloperControlledWalletsClient({
      apiKey: env.apiKey,
      entitySecret: env.entitySecret,
    });
    const response = await circleClient.signTransaction({
      walletId: env.walletId,
      rawTransaction: tx
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString('base64'),
    });
    const signedB64 = response.data?.signedTransaction;
    if (!signedB64) {
      console.error(`${tag} No signedTransaction returned from Circle DCW:`, response);
      return json({ error: UNAVAILABLE }, 502);
    }

    // Whatever Circle hands back, what we broadcast is the message the user signed with both
    // signatures on it: re-attach theirs if Circle dropped it, then verify the lot.
    const signed = Transaction.from(Buffer.from(signedB64, 'base64'));
    if (!signed.serializeMessage().equals(tx.serializeMessage())) {
      console.error(`${tag} Circle returned a different message than it was given.`);
      return json({ error: UNAVAILABLE }, 502);
    }
    if (!signed.signatures.find((s) => s.publicKey.equals(owner))?.signature) {
      signed.addSignature(owner, ownerSig);
    }
    if (!signed.verifySignatures(true)) {
      console.error(`${tag} Signed transaction does not verify.`);
      return json({ error: UNAVAILABLE }, 502);
    }

    const bytes = signed.serialize();
    const signature = bs58.encode(signed.signature!);

    try {
      await connection.sendRawTransaction(bytes, { preflightCommitment: 'confirmed', maxRetries: 3 });
    } catch (err) {
      const raw = errorText(err);
      const known = classifySolanaSendError(raw);
      // Already landed is not a failure: fall through and confirm it.
      if (known?.code !== 'already_landed') {
        console.warn(`${tag} preflight refused ${signature}: ${raw.slice(0, 400)}`);
        if (known) return json({ error: known.message, code: known.code }, 422);
        return json({ error: 'This transfer could not be sent. Nothing was sent — please try again.' }, 422);
      }
    }

    // Broadcast. From here the money may move whether or not we hear back, so the withdrawal
    // learns its hash now.
    if (withdrawalOrderId) {
      const { error } = await supabaseAdmin
        .from('withdrawals')
        .update({ tx_hash: signature })
        .eq('provider_order_id', withdrawalOrderId)
        .eq('user_id', caller.userId!);
      if (error) console.error(`${tag} Could not record tx hash for ${withdrawalOrderId}:`, error.message);
    }

    const outcome = await awaitConfirmation(connection, signature, bytes, tx.recentBlockhash!);

    if (outcome.state === 'failed') {
      const known = classifySolanaSendError(outcome.raw);
      console.warn(`${tag} ${signature} failed on-chain: ${outcome.raw}`);
      return json(
        {
          error: known?.message ?? 'This transfer failed on the network. Nothing was sent — please try again.',
          code: known?.code ?? 'failed',
          txHash: signature,
        },
        422,
      );
    }
    if (outcome.state === 'expired') {
      return json({ error: SOLANA_SEND_MESSAGES.blockhash_expired, code: 'blockhash_expired' }, 409);
    }

    if (outcome.state === 'pending') {
      console.warn(`${tag} ${signature} broadcast but not confirmed within ${CONFIRM_TIMEOUT_MS}ms`);
      // The page is told "still confirming" and may well close. The history row used to be
      // written from the page once the chain showed the send, so a closed tab meant a payment
      // with no row. The server keeps watching instead, and writes it here. recordTransfer
      // checks the send against the chain like any other, so `record` gains the caller nothing.
      if (sendRecord) {
        after(async () => {
          const late = await awaitConfirmation(
            connection,
            signature,
            bytes,
            tx.recentBlockhash!,
            LATE_CONFIRM_TIMEOUT_MS,
          );
          if (late.state !== 'confirmed') {
            console.warn(`${tag} ${signature} still not confirmed (${late.state}); no history row written.`);
            return;
          }
          const { recordTransfer } = await import('@/lib/supabase/transactions');
          await recordTransfer({
            recipientEmail: sendRecord.recipient,
            amount: sendRecord.amount,
            status: 'completed',
            note: sendRecord.note,
            txHash: signature,
            chain: 'solana',
          });
        });
      }
      return json({ txHash: signature, pending: true, recordedByServer: !!sendRecord });
    }
    return json({ txHash: signature });
  } catch (err) {
    console.error(`${tag} Unexpected error:`, err);
    return json({ error: 'Gas sponsorship failed. Please try again shortly.' }, 500);
  }
}

function errorText(err: unknown): string {
  const base = err instanceof Error ? err.message : String(err);
  const logs = (err as { logs?: unknown })?.logs;
  return Array.isArray(logs) ? `${base}\n${logs.join('\n')}` : base;
}

type Confirmation =
  | { state: 'confirmed' }
  | { state: 'failed'; raw: string }
  | { state: 'expired' }
  | { state: 'pending' };

/**
 * Wait on THIS transaction's own blockhash, not a fresh one: a transaction can only land while
 * its blockhash is valid, so once that lapses with no status, it never will — the one moment it
 * is safe to tell the user nothing was sent.
 */
async function awaitConfirmation(
  connection: Connection,
  signature: string,
  bytes: Buffer,
  blockhash: string,
  timeoutMs: number = CONFIRM_TIMEOUT_MS,
): Promise<Confirmation> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const { value: status } = await connection
      .getSignatureStatus(signature, { searchTransactionHistory: true })
      .catch(() => ({ value: null }));

    if (status?.err) return { state: 'failed', raw: JSON.stringify(status.err) };
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      return { state: 'confirmed' };
    }

    if (!status) {
      const valid = await connection
        .isBlockhashValid(blockhash, { commitment: 'confirmed' })
        .then((r) => r.value)
        .catch(() => true);
      if (!valid) {
        // One last look: it may have landed in the final slot before the hash lapsed.
        const { value: last } = await connection
          .getSignatureStatus(signature, { searchTransactionHistory: true })
          .catch(() => ({ value: null }));
        if (last?.err) return { state: 'failed', raw: JSON.stringify(last.err) };
        if (last) return { state: last.confirmationStatus === 'processed' ? 'pending' : 'confirmed' };
        return { state: 'expired' };
      }
    }

    // Public RPCs drop packets; rebroadcasting the same signed bytes is idempotent.
    await connection.sendRawTransaction(bytes, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return { state: 'pending' };
}
