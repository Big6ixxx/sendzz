import 'server-only';

/**
 * Brails payouts, driven by its webhooks.
 *
 * A Brails withdrawal has no payout until the user's USDC reaches Brails (see
 * lib/ramp/providers/brails.ts). These are the two steps the webhook route runs:
 *
 *   onDeposit — USDC landed: match it to its withdrawal and start the payout.
 *   onPayout  — the payout succeeded or failed: finalise the withdrawal.
 *
 * Neither trusts the webhook's body on its own. Each re-reads the transaction from Brails before
 * acting, so a forged or replayed event cannot start or settle a payout — the signature check in
 * the route is the first gate, this is the second.
 *
 * Server-only rather than in lib/actions: an export there is a public endpoint, and these move
 * money without a user session.
 */
import { getBrailsClient, type BrailsQuote, type BrailsTransaction } from '@/lib/brails/client';
import { openBeneficiary } from '@/lib/ramp/beneficiary-vault';
import {
  brailsNeedsPhoneField,
  brailsNeedsSender,
  brailsNeedsSenderAddress,
  brailsPhone,
  parseBrailsInstitution,
} from '@/lib/ramp/providers/brails';
import { brailsSenderFor } from '@/lib/ramp/brails-sender';
import { ledgerTransaction } from '@/lib/stellar/privy-wallet';
import { supabaseAdmin } from '@/lib/supabase/adminClient';
import { triggerWithdrawalNotifications } from '@/lib/supabase/transactions';
import { accrueReferralEarning, voidReferralEarning } from '@/lib/referrals/accrue';
import { releaseBenefitsForOrder } from '@/lib/referrals/benefits';
import { redactEmail } from '@/lib/log';
import type { Json } from '@/types/database';

export interface BrailsEventData {
  id?: string;
  hash?: string;
  status?: string;
  reference?: string;
}

type Outcome = { ok: true; note: string } | { ok: false; note: string; retry: boolean };

/** USD actually received, in major units. Prefers the minor-unit field when Brails sends it. */
function usdOf(tx: BrailsTransaction): number | null {
  const cents = Number(tx.centAmount);
  if (Number.isFinite(cents) && cents > 0) return cents / 100;
  const amount = Number(tx.amount);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** Our Brails state on the withdrawal row (`provider_metadata.brails`). */
type BrailsMeta = Record<string, unknown> & { payoutId?: string; settledAs?: string };

/**
 * Change `provider_metadata.brails` without losing a concurrent write.
 *
 * The deposit and payout webhooks both write this object, and a payout can be confirmed while
 * the deposit handler is still recording it. Writing back a copy read earlier erased whatever
 * the other had written in between — a settlement claim, or the payout id. So each write is
 * guarded on the two fields the handlers claim (`payoutId`, `settledAs`) being what was read,
 * and a lost race re-reads and tries again.
 *
 * `change` returns the new object, or null when its precondition no longer holds (the claim
 * was taken) — then nothing is written and this returns false.
 */
async function updateBrailsMeta(rowId: string, change: (brails: BrailsMeta) => BrailsMeta | null): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data } = await supabaseAdmin.from('withdrawals').select('provider_metadata').eq('id', rowId).maybeSingle();
    const meta = (data?.provider_metadata ?? {}) as Record<string, unknown>;
    const current = (meta.brails ?? {}) as BrailsMeta;
    const next = change(current);
    if (!next) return false;

    let update = supabaseAdmin
      .from('withdrawals')
      .update({ provider_metadata: { ...meta, brails: next } as Json })
      .eq('id', rowId);
    update = current.payoutId == null
      ? update.is('provider_metadata->brails->>payoutId', null)
      : update.eq('provider_metadata->brails->>payoutId', current.payoutId);
    update = current.settledAs == null
      ? update.is('provider_metadata->brails->>settledAs', null)
      : update.eq('provider_metadata->brails->>settledAs', current.settledAs);
    const { data: written } = await update.select('id');
    if (written?.length) return true;
  }
  console.error(`[Brails] Could not update withdrawal ${rowId}: its record kept changing underneath.`);
  return false;
}

function brailsOf(row: { provider_metadata: unknown }): BrailsMeta {
  return (((row.provider_metadata ?? {}) as { brails?: BrailsMeta }).brails ?? {}) as BrailsMeta;
}

function omit(brails: BrailsMeta, ...keys: string[]): BrailsMeta {
  const rest = { ...brails };
  for (const k of keys) delete rest[k];
  return rest;
}

/** Drop a claim this handler took, so the event can run again. */
function without(brails: BrailsMeta, key: 'payoutId' | 'settledAs', value: string): BrailsMeta | null {
  return brails[key] === value ? omit(brails, key) : null;
}

/**
 * Fail a withdrawal whose payout will not be made, with the payout claim already held: the
 * withdrawal is marked failed and the amount recorded as owed to the user. If that cannot be
 * recorded, the claim is given back so a retry can, rather than leaving the debt unwritten.
 */
async function failUnpaid(rowId: string, orderId: string, reason: string): Promise<Outcome> {
  const { error } = await supabaseAdmin.rpc('finalize_withdrawal_failed', {
    p_paycrest_order_id: orderId,
    p_reason: reason,
  });
  if (error) {
    console.error(`[Brails] ${orderId} could not be failed (${reason}): ${error.message}. Will retry.`);
    await updateBrailsMeta(rowId, (b) => without(b, 'payoutId', 'starting'));
    return { ok: false, note: `failure not recorded (${error.message})`, retry: true };
  }
  await updateBrailsMeta(rowId, (b) => ({ ...b, payoutId: 'rejected' }));
  await triggerWithdrawalNotifications(orderId, 'failed');
  await releaseBenefitsForOrder(orderId);
  return { ok: true, note: `withdrawal failed: ${reason}` };
}

/** USDC arrived at a Brails deposit address: start the payout it was sent for. */
export async function onBrailsDeposit(data: BrailsEventData): Promise<Outcome> {
  if (!data.id) return { ok: false, note: 'deposit event without a transaction id', retry: false };

  const tx = await getBrailsClient().getTransaction(data.id);
  if (tx.status?.toLowerCase() !== 'success') {
    return { ok: false, note: `deposit ${data.id} is ${tx.status}, not success`, retry: true };
  }
  const hash = (tx.hash ?? data.hash ?? '').toLowerCase();
  const received = usdOf(tx);
  if (!hash || received === null) {
    return { ok: false, note: `deposit ${data.id} has no hash or amount`, retry: false };
  }

  const { data: candidates } = await supabaseAdmin
    .from('withdrawals')
    .select('id, user_id, status, provider_order_id, amount_usdc, fiat_currency, institution_code, pending_beneficiary, provider_metadata')
    .eq('provider', 'brails')
    .ilike('tx_hash', hash);

  if (!candidates?.length) {
    // The browser saves the hash after its transfer confirms, and this can arrive first.
    // Brails retries a failed delivery; reconcileBrailsDeposits is the backstop after that.
    console.error(
      `[Brails] UNMATCHED DEPOSIT ${hash}: ${received} USD (tx ${data.id}) — no Brails withdrawal ` +
        `carries this hash yet.`,
    );
    return { ok: false, note: `no withdrawal for ${hash}`, retry: true };
  }

  // The hash finds the withdrawal; it does not prove the money was sent for it — a hash is
  // public on-chain. So the deposit must also have arrived where that withdrawal's money was
  // to go: its own deposit address and, on Stellar, where one address serves every customer,
  // its memo, read from the ledger rather than from any request.
  const arrivedAt = (tx.address ?? '').trim().toLowerCase();
  let memo: string | undefined;
  if ((tx.chain ?? '').toLowerCase() === 'stellar') {
    const onLedger = await ledgerTransaction(hash);
    if (onLedger.state === 'unknown') return { ok: false, note: 'Stellar memo unreadable — will retry', retry: true };
    memo = 'memo' in onLedger ? onLedger.memo : undefined;
  }
  const matching = candidates.filter((c) => {
    const meta = (c.provider_metadata ?? {}) as { deposit_address?: string; deposit_memo?: string };
    if (!arrivedAt || (meta.deposit_address ?? '').trim().toLowerCase() !== arrivedAt) return false;
    return memo === undefined || (meta.deposit_memo ?? '') === memo;
  });
  if (matching.length !== 1) {
    console.error(
      `[Brails] NEEDS REVIEW deposit ${hash} (tx ${data.id}, ${received} USD at ${arrivedAt || '?'}): ` +
        `${matching.length === 0 ? 'no withdrawal with this hash expects it there' : 'several withdrawals claim it'}. ` +
        `Orders: ${candidates.map((c) => c.provider_order_id).join(', ')}.`,
    );
    return { ok: false, note: 'deposit does not belong to a single withdrawal', retry: false };
  }
  const w = matching[0];

  if (!w.provider_order_id) return { ok: false, note: `withdrawal ${w.id} has no order reference`, retry: false };
  const orderId = w.provider_order_id;

  const { payoutId } = brailsOf(w);
  if (payoutId) return { ok: true, note: `payout ${payoutId} already started` };
  if (w.status !== 'processing') return { ok: true, note: `withdrawal is ${w.status}` };

  const depositFacts = { depositId: data.id, depositHash: hash, receivedUsd: received };
  const inst = parseBrailsInstitution(w.institution_code);
  const bank = openBeneficiary(w.pending_beneficiary);
  const expected = Number(w.amount_usdc);
  // Not payable as it stands: no corridor or beneficiary to pay, or far less arrived than the
  // withdrawal was for. The money is at Brails either way, so the withdrawal fails and the
  // amount is recorded as owed.
  if (!inst || !bank || received < expected * 0.99) {
    const unpayable = !inst || !bank ? 'missing corridor or beneficiary' : `received ${received} USD, expected ${expected}`;
    console.error(`[Brails] NEEDS REVIEW ${orderId} cannot be paid: ${unpayable}.`);
    const claimed = await updateBrailsMeta(w.id, (b) => (b.payoutId ? null : { ...b, ...depositFacts, payoutId: 'starting' }));
    if (!claimed) return { ok: true, note: 'payout already being started' };
    return failUnpaid(w.id, orderId, `Brails deposit not payable: ${unpayable}`);
  }
  return attemptPayout(w, orderId, received, null, depositFacts);
}

/** The withdrawal columns a payout attempt reads. */
interface PayoutRow {
  id: string;
  user_id: string;
  amount_usdc: number | string | null;
  fiat_currency: string;
  institution_code: string | null;
  pending_beneficiary: string | null;
  provider_metadata: unknown;
}

/**
 * When to try again after a payout call with no clear answer, in minutes: Brails' own advice.
 * They confirmed (2026-11-04) that a 5xx or a timeout on the payout call sends nothing, and that
 * a payout reference is unique, so a second call with the same reference continues the first
 * instead of paying twice. That is what makes retrying safe at all.
 */
const PAYOUT_RETRY_MINUTES = [1, 5, 15];

/** A claim with no answer after this long belongs to a process that stopped mid-call. */
const STALE_START_MS = 10 * 60_000;

/**
 * Make the payout for a funded withdrawal: claim it, save the beneficiary, quote and send.
 *
 * `claimFrom` is the `payoutId` the row must hold for this attempt to take it: none for the
 * first attempt, `retrying` for one the reconcile job is trying again.
 */
async function attemptPayout(
  w: PayoutRow,
  orderId: string,
  received: number,
  claimFrom: 'retrying' | null,
  facts: Record<string, unknown> = {},
): Promise<Outcome> {
  const inst = parseBrailsInstitution(w.institution_code ?? '');
  const bank = openBeneficiary(w.pending_beneficiary);
  if (!inst || !bank) {
    // onBrailsDeposit checks this before a first attempt, so here it is a retry that can no
    // longer read where the money goes (a rotated key). The money is at Brails: refund it.
    console.error(`[Brails] NEEDS REVIEW ${orderId} cannot be retried: missing corridor or beneficiary.`);
    const claimed = await updateBrailsMeta(w.id, (b) => ((b.payoutId ?? null) === claimFrom ? { ...b, payoutId: 'starting' } : null));
    if (!claimed) return { ok: true, note: 'payout already being started' };
    return failUnpaid(w.id, orderId, 'Brails payout not payable: missing corridor or beneficiary');
  }
  // Never pay out more than this withdrawal was for.
  const payUsd = Math.min(received, Number(w.amount_usdc));

  const { data: user } = await supabaseAdmin.from('users').select('email').eq('id', w.user_id).maybeSingle();
  const customerEmail = user?.email ?? '';

  // Checked when the order was made, so a miss here is Didit or the network, not the user.
  // Looked up before the claim: nothing has been sent, so the event can simply be retried.
  const sender = brailsNeedsSender(inst.country) ? await brailsSenderFor({ id: w.user_id }).catch(() => null) : undefined;
  if (sender === null) {
    console.error(`[Brails] Payout for ${orderId} waits: the sender's verified name could not be read. Will retry.`);
    return { ok: false, note: 'sender unavailable — will retry', retry: true };
  }

  // Claim the payout before making it, so two deliveries of the same event cannot both pass —
  // a read-then-write check here is how a payout gets made twice.
  const claimed = await updateBrailsMeta(w.id, (b) =>
    (b.payoutId ?? null) === claimFrom
      ? { ...b, ...facts, payoutId: 'starting', payoutStartedAt: new Date().toISOString() }
      : null,
  );
  if (!claimed) return { ok: true, note: 'payout already being started' };
  const release = () => updateBrailsMeta(w.id, (b) => without(b, 'payoutId', 'starting'));

  let payout: BrailsTransaction;
  let quote: BrailsQuote;
  // Until sendPayout is called nothing can have been paid, so any failure before it is safe to
  // retry. After it, only a clear refusal is a final answer.
  let sending = false;
  try {
    // Saved first: the payout API takes a beneficiary by id. Our order reference ties the
    // beneficiary and the payout to this withdrawal on Brails' side. A retry reuses the one
    // already saved rather than making a second.
    let beneficiaryId = brailsOf(w).beneficiaryId as string | undefined;
    if (!beneficiaryId) {
      // A call that timed out may still have saved one, and a second under the same reference
      // could be refused as a duplicate, failing a withdrawal that can be paid. So each try
      // after the first gets its own reference; an orphaned beneficiary costs nothing.
      const tries = Number(brailsOf(w).beneficiaryTries ?? 0);
      await updateBrailsMeta(w.id, (b) => (b.payoutId === 'starting' ? { ...b, beneficiaryTries: tries + 1 } : null));
      const beneficiary = await getBrailsClient().createBeneficiary({
        reference: tries ? `${orderId}-${tries}` : orderId,
        customerEmail,
        country: inst.country,
        currency: w.fiat_currency.toUpperCase(),
        destination:
          inst.rail === 'bank'
            ? {
                type: 'BANK',
                bankCode: inst.network,
                bankName: bank.bankName,
                accountNumber: bank.accountNumber.replace(/\D/g, ''),
                accountName: bank.accountName,
              }
            : {
                type: 'MOBILEMONEY',
                network: inst.network,
                accountNumber: brailsPhone(bank.accountNumber, inst.country),
                accountName: bank.accountName,
                ...(brailsNeedsPhoneField(inst.country) ? { phoneNumber: brailsPhone(bank.accountNumber, inst.country) } : {}),
                ...(sender
                  ? {
                      sender: brailsNeedsSenderAddress(inst.country)
                        ? sender
                        : { accountName: sender.accountName, country: sender.country },
                    }
                  : {}),
              },
      });
      beneficiaryId = beneficiary.id;
      await updateBrailsMeta(w.id, (b) => (b.payoutId === 'starting' ? { ...b, beneficiaryId } : null));
    }
    quote = await quoteToFit(payUsd, received, w.fiat_currency, inst.country);
    sending = true;
    payout = await getBrailsClient().sendPayout({
      reference: orderId,
      targetMinor: quote.targetAmount,
      beneficiaryId,
      customerEmail,
      description: `Sendzz withdrawal ${orderId}`,
      quoteId: quote.quoteId,
    });
  } catch (err) {
    const httpStatus = (err as { status?: number }).status ?? 0;
    const message = (err as Error).message;
    const ours = [401, 403, 429].includes(httpStatus);
    const refused = httpStatus >= 400 && httpStatus < 500 && !ours;
    // Only Brails answering 5xx, or not answering in time, says the corridor is down; any other
    // error with no status is ours.
    const corridorDown = httpStatus >= 500 || (err as Error).name === 'TimeoutError';

    if (ours && claimFrom === 'retrying') return holdRetry(w.id, orderId, message, httpStatus);

    if (!refused && !sending) {
      // Nothing was sent: our side (bad key, IP not whitelisted, rate limit) or Brails had no
      // answer before the payout call. Release the claim and let the event run again; past
      // Brails' own retries, reconcileBrailsDeposits picks it up.
      // A reconcile retry stays on the backoff instead: released, it would leave this job and
      // depend on the deposit backstop, which only looks a week back.
      if (claimFrom === 'retrying') {
        return scheduleRetry(w.id, orderId, payUsd, `not started: ${message}`, httpStatus, corridorDown);
      }
      console.error(`[Brails] Payout for ${orderId} not started (${httpStatus || 'no response'}): ${message}. Will retry.`);
      await release();
      return { ok: false, note: `not started (${httpStatus || 'no response'}) — will retry`, retry: true };
    }
    if (refused && sending) {
      // Refused at the payout call itself. Usually nothing was paid — but a refusal of a repeated
      // call (a duplicate reference) can mean the payout already exists, and failing the
      // withdrawal then would refund money the beneficiary was also paid. So ask first.
      const existing = await getBrailsClient().findPayoutByReference(orderId).catch(() => undefined);
      if (existing === undefined) return scheduleRetry(w.id, orderId, payUsd, `refused (${message}) and could not be checked`, httpStatus, false);
      if (existing) {
        await recordExisting(w.id, existing);
        console.log(`[Brails] ${orderId}: payout ${existing.id} already exists — recorded instead of failing.`);
        return { ok: true, note: `payout ${existing.id} already exists` };
      }
    }
    if (refused) {
      // Brails refused it outright (below the corridor minimum, bad number, unsupported
      // network…): nothing was paid, so the withdrawal fails and the amount is owed back.
      return failUnpaid(w.id, orderId, `Brails rejected the payout: ${message}`);
    }
    // The payout call had no clear answer — on KES in November 2026, a 503 while the corridor
    // was down. Nothing was sent, and the same reference cannot pay twice, so try again later.
    return scheduleRetry(w.id, orderId, payUsd, message, httpStatus, corridorDown);
  }

  await updateBrailsMeta(w.id, (b) => ({
    ...omit(b, 'retryAt', 'corridorDownAt', 'lastPayoutError', 'checkOnly', 'needsReview'),
    payoutSentAt: new Date().toISOString(),
    payoutId: payout.id,
    payoutReference: payout.reference,
    payoutStatus: payout.status,
    quoteId: quote.quoteId,
    rate: quote.rate,
    targetMinor: quote.targetAmount,
  }));

  console.log(
    `[Brails] Payout ${payout.id} sent for ${orderId}: ${quote.sourceAmount / 100} USD → ` +
      `${quote.targetAmount / 100} ${w.fiat_currency} at ${quote.rate} to ${inst.country} ${inst.network} ` +
      `(${redactEmail(customerEmail)}), status ${payout.status}`,
  );
  return { ok: true, note: `payout ${payout.id} ${payout.status}` };
}

/**
 * Record a payout Brails already has under our reference, so it is followed to the end. One
 * it is actually making also says the corridor is up; one only `initiated` says nothing yet.
 */
function recordExisting(rowId: string, existing: BrailsTransaction) {
  const moving = existing.status?.toLowerCase() !== 'initiated';
  return updateBrailsMeta(rowId, (b) => ({
    ...omit(b, 'retryAt', 'checkOnly', 'needsReview', ...(moving ? ['corridorDownAt'] : [])),
    ...(moving ? { payoutSentAt: new Date().toISOString() } : {}),
    payoutId: existing.id,
    payoutReference: existing.reference,
    payoutStatus: existing.status,
  }));
}

/**
 * A payout call with no clear answer, with the claim still held: schedule the next attempt, or,
 * out of attempts, settle it on what Brails says it has.
 *
 * A 5xx or a timeout also marks the corridor down (`corridorDownAt`), which routes new
 * withdrawals in that currency to another provider for a while (lib/ramp/brails-corridor.ts).
 */
async function scheduleRetry(
  rowId: string,
  orderId: string,
  payUsd: number,
  reason: string,
  httpStatus: number,
  corridorDown: boolean,
): Promise<Outcome> {
  const now = Date.now();
  let attempt = 0;
  let outOfAttempts = false;
  const scheduled = await updateBrailsMeta(rowId, (b) => {
    if (b.payoutId !== 'starting') return null;
    attempt = Number(b.payoutAttempts ?? 0) + 1;
    outOfAttempts = attempt > PAYOUT_RETRY_MINUTES.length;
    if (outOfAttempts) return null;
    return {
      ...b,
      payoutId: 'retrying',
      payoutAttempts: attempt,
      retryAt: new Date(now + PAYOUT_RETRY_MINUTES[attempt - 1] * 60_000).toISOString(),
      lastPayoutError: `${httpStatus || 'no response'}: ${reason}`,
      ...(corridorDown ? { corridorDownAt: new Date(now).toISOString() } : {}),
    };
  });
  if (scheduled) {
    console.error(
      `[Brails] Payout of ${payUsd} USD for ${orderId} had no clear answer (${httpStatus || 'no response'}: ${reason}). ` +
        `Retry ${attempt} of ${PAYOUT_RETRY_MINUTES.length} in ${PAYOUT_RETRY_MINUTES[attempt - 1]} min.`,
    );
    return { ok: false, note: `payout unconfirmed — retry ${attempt} scheduled`, retry: false };
  }
  if (!outOfAttempts) return { ok: true, note: 'payout claim moved on' };
  return settleOnLookup(rowId, orderId, reason);
}

/**
 * Our own side failed during a retry (bad key, IP not whitelisted, rate limited): nothing about
 * the corridor or the payout, so it uses up no attempt — counting it would end in refunding a
 * withdrawal that could be paid. Tried again in five minutes; a key or IP problem is flagged,
 * since it will not clear on its own.
 */
async function holdRetry(rowId: string, orderId: string, reason: string, httpStatus: number): Promise<Outcome> {
  await updateBrailsMeta(rowId, (b) =>
    b.payoutId === 'starting'
      ? {
          ...b,
          payoutId: 'retrying',
          retryAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          lastPayoutError: `${httpStatus}: ${reason}`,
          ...(httpStatus === 429 ? {} : { needsReview: true }),
        }
      : null,
  );
  console.error(`[Brails] Payout for ${orderId} held by our own side (${httpStatus}: ${reason}). Trying again in 5 min.`);
  return { ok: false, note: `held (${httpStatus}) — will retry`, retry: false };
}

/**
 * Out of attempts, with the claim held: settle on what Brails has. Any payout under our
 * reference, even one only `initiated`, is followed to the end, since Brails can still move it
 * on and refunding it then would pay twice. Only none at all is refunded.
 *
 * If Brails cannot be asked, the row is left to be asked again in 15 minutes (`checkOnly`), with
 * no further payout attempt, and flagged for review.
 */
async function settleOnLookup(rowId: string, orderId: string, reason: string): Promise<Outcome> {
  const existing = await getBrailsClient().findPayoutByReference(orderId).catch(() => undefined);
  if (existing === undefined) {
    await updateBrailsMeta(rowId, (b) =>
      b.payoutId === 'starting'
        ? { ...b, payoutId: 'retrying', retryAt: new Date(Date.now() + 15 * 60_000).toISOString(), checkOnly: true, needsReview: true }
        : null,
    );
    console.error(`[Brails] ${orderId}: out of payout attempts and Brails could not be asked about it. Asking again in 15 min.`);
    return { ok: false, note: 'out of attempts, payout unknown', retry: false };
  }
  if (existing) {
    await recordExisting(rowId, existing);
    console.log(`[Brails] ${orderId}: payout ${existing.id} found after retries (${existing.status}) — following it.`);
    return { ok: true, note: `payout ${existing.id} found` };
  }
  console.error(`[Brails] ${orderId}: payout never went through after ${PAYOUT_RETRY_MINUTES.length + 1} attempts — refund owed.`);
  return failUnpaid(rowId, orderId, `Brails could not make the payout: ${reason}`);
}

/**
 * The backstop for payouts with no final answer, run by the reconcile cron.
 *
 * - `retrying`, and due: try the payout again, or only ask Brails about it once attempts are
 *   used up (`checkOnly`).
 * - `starting` for over 10 minutes: the process stopped mid-call, so try again. Only a claim
 *   with a start time, which this code writes; one without predates retries, and may have been
 *   paid by hand since, so it is listed for review instead of paid.
 * - a payout Brails has, with no final webhook after 15 minutes: ask Brails for its status and
 *   settle it. Still in flight after a day is listed for review.
 *
 * `stopAt` is checked between rows. One row can still run past it, by as many Brails calls as a
 * payout takes; a row cut off mid-call comes back as a stale claim.
 */
export async function reconcileBrailsPayouts(
  stopAt = Date.now() + 60_000,
): Promise<{ retried: number; settled: number; review: string[] }> {
  const now = Date.now();
  const base = () =>
    supabaseAdmin
      .from('withdrawals')
      .select('id, user_id, status, provider_order_id, amount_usdc, fiat_currency, institution_code, pending_beneficiary, provider_metadata, created_at')
      .eq('provider', 'brails')
      .eq('status', 'processing');
  // Each kind in a query of its own, only rows that have work due, oldest first and with no age
  // limit: a payout still owed an answer must never age out of the only job that gives one, or
  // be crowded out by rows that have nothing to do yet.
  const [{ data: due }, { data: stale }, { data: legacy }, { data: inFlight }] = await Promise.all([
    base()
      .eq('provider_metadata->brails->>payoutId', 'retrying')
      .lte('provider_metadata->brails->>retryAt', new Date(now).toISOString())
      .order('created_at')
      .limit(50),
    base()
      .eq('provider_metadata->brails->>payoutId', 'starting')
      .lt('provider_metadata->brails->>payoutStartedAt', new Date(now - STALE_START_MS).toISOString())
      .order('created_at')
      .limit(50),
    // Claims from before retries existed: listed for review, never paid.
    base().eq('provider_metadata->brails->>payoutId', 'starting').is('provider_metadata->brails->>payoutStartedAt', null).limit(50),
    base()
      .not('provider_metadata->brails->>payoutId', 'is', null)
      .not('provider_metadata->brails->>payoutId', 'in', '(retrying,starting,rejected,manual)')
      .is('provider_metadata->brails->>settledAs', null)
      .lt('created_at', new Date(now - 15 * 60_000).toISOString())
      .order('created_at')
      .limit(50),
  ]);
  const seen = new Set<string>();
  const rows = [...(due ?? []), ...(stale ?? []), ...(legacy ?? []), ...(inFlight ?? [])].filter(
    (r) => !seen.has(r.id) && seen.add(r.id),
  );

  let retried = 0;
  let settled = 0;
  const review: string[] = [];
  for (const w of rows) {
    const orderId = w.provider_order_id;
    if (!orderId) continue;
    const b = brailsOf(w);
    // Listed whether or not there is time to work on them, so the review list is complete.
    if (b.payoutId === 'starting' && !b.payoutStartedAt) {
      review.push(orderId);
      continue;
    }
    if (b.needsReview) review.push(orderId);
    if (Date.now() > stopAt) continue;
    const received = Number(b.receivedUsd);
    try {
      if (b.payoutId === 'retrying' || b.payoutId === 'starting') {
        // A stale claim is reopened as a retry due now, so that if this attempt goes nowhere
        // the row is still due next run rather than lost between the queries.
        if (b.payoutId === 'starting') {
          const reopened = await updateBrailsMeta(w.id, (cur) =>
            cur.payoutId === 'starting' && cur.payoutStartedAt === b.payoutStartedAt
              ? { ...cur, payoutId: 'retrying', retryAt: new Date(now).toISOString() }
              : null,
          );
          if (!reopened) continue;
        }
        let outcome: Outcome;
        if (b.checkOnly) {
          const claimed = await updateBrailsMeta(w.id, (cur) => (cur.payoutId === 'retrying' ? { ...cur, payoutId: 'starting' } : null));
          if (!claimed) continue;
          outcome = await settleOnLookup(w.id, orderId, String(b.lastPayoutError ?? 'no answer'));
        } else {
          outcome = await attemptPayout(w, orderId, received, 'retrying');
        }
        retried++;
        console.log(`[Reconcile Brails] ${orderId}: ${outcome.note}`);
      } else if (b.payoutId) {
        const tx = await getBrailsClient().getTransaction(b.payoutId);
        const status = tx.status?.toLowerCase() ?? '';
        if (!status || ['initiated', 'pending', 'processing'].includes(status)) {
          if (now - Date.parse(w.created_at) > 24 * 60 * 60_000) review.push(orderId);
          continue;
        }
        const outcome = await onBrailsPayout({ id: b.payoutId, reference: orderId }, status === 'success');
        if (outcome.ok) settled++;
        console.log(`[Reconcile Brails] ${orderId}: ${outcome.note}`);
      }
    } catch (e) {
      console.error(`[Reconcile Brails] ${orderId}:`, e instanceof Error ? e.message : e);
    }
  }
  if (Date.now() > stopAt) console.warn(`[Reconcile Brails] Out of time with payouts left to check; the next run picks them up.`);
  if (review.length) {
    console.error(`[Reconcile Brails] ⚠ ${review.length} PAYOUT(S) NEED REVIEW — no answer from Brails: ${review.join(', ')}`);
  }
  return { retried, settled, review };
}

/**
 * Withdrawals with no transaction hash a day and more after the order: listed, not failed.
 *
 * No hash is not proof the user sent nothing. Saving it can fail after the transfer went
 * through, and then the deposit reaches Brails with nothing to match it to. Failing the
 * withdrawal would record nothing owed and hide money we hold; left processing, it stays where
 * an admin can see it, check the deposit address, and close it by hand.
 */
export async function listUnfundedBrailsWithdrawals(): Promise<string[]> {
  const { data: rows } = await supabaseAdmin
    .from('withdrawals')
    .select('provider_order_id')
    .eq('provider', 'brails')
    .eq('status', 'processing')
    .is('tx_hash', null)
    .is('provider_metadata->brails->>payoutId', null)
    // A day and two hours: an EVM UserOperation can be held for up to a day (pendingSends.ts).
    .lt('created_at', new Date(Date.now() - 26 * 60 * 60_000).toISOString())
    .limit(50);
  const orders = (rows ?? []).map((r) => r.provider_order_id).filter((o): o is string => !!o);
  if (orders.length) {
    console.warn(
      `[Reconcile Brails] ${orders.length} withdrawal(s) with no transaction a day on — check their deposit ` +
        `addresses at Brails before closing: ${orders.join(', ')}`,
    );
  }
  return orders;
}

/**
 * The backstop for a deposit whose webhook found no withdrawal.
 *
 * The browser saves the transaction hash after the transfer confirms, so the deposit webhook can
 * arrive first, and Brails' three retries come within minutes. Any Brails withdrawal still
 * waiting with a hash but no payout is looked up on Brails by that hash and, if the deposit is
 * there, run through `onBrailsDeposit` exactly as the webhook would have.
 */
export async function reconcileBrailsDeposits(stopAt = Date.now() + 60_000): Promise<{ checked: number; started: number }> {
  const now = Date.now();
  const { data: waiting } = await supabaseAdmin
    .from('withdrawals')
    .select('id, tx_hash, provider_order_id')
    .eq('provider', 'brails')
    .eq('status', 'processing')
    .not('tx_hash', 'is', null)
    .is('provider_metadata->brails->>payoutId', null)
    .lt('created_at', new Date(now - 5 * 60_000).toISOString())
    // A week, not a day: a deposit matched late is still a payout, where unmatched it sits at
    // Brails with nothing to tell anyone it is there. Newest first, so hashes that will never
    // match (sent to the wrong place) cannot hold back a fresh deposit whose webhook was missed.
    .gt('created_at', new Date(now - 7 * 24 * 60 * 60_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(20);

  let started = 0;
  for (const w of waiting ?? []) {
    if (Date.now() > stopAt) break;
    try {
      const deposit = await getBrailsClient().findDepositByHash(w.tx_hash!);
      if (!deposit) continue;
      // Brails' transaction record carries no hash; the one it was found by is the one to match.
      const outcome = await onBrailsDeposit({ id: deposit.id, hash: w.tx_hash! });
      if (outcome.ok) started++;
      console.log(`[Reconcile Brails] ${w.provider_order_id}: ${outcome.note}`);
    } catch (e) {
      console.error(`[Reconcile Brails] ${w.provider_order_id}:`, e instanceof Error ? e.message : e);
    }
  }
  return { checked: waiting?.length ?? 0, started };
}

/**
 * The biggest payout `usd` can fund, as a locked quote.
 *
 * Brails quotes by what the RECIPIENT gets (in minor units of the payout currency) and answers
 * with what it costs in US cents, plus its own flat `fee` where the corridor has one (Tanzania,
 * Zambia: 200¢ on top). So guess the target from the live rate, and if the quote's cost is over
 * `usd`, or its cost plus fee is over what actually arrived, scale it down once and re-quote. The
 * fee is covered by the corridor fee the user sent on top (`providerFee`), never by the
 * recipient's amount or our wallet. A quote is good for 90 seconds, which is why it is taken
 * here, at payout time.
 */
async function quoteToFit(usd: number, receivedUsd: number, currency: string, country: string): Promise<BrailsQuote> {
  const cents = (v: number) => Math.floor(v * 100 + 1e-9);
  const budgetFor = (q: BrailsQuote) => Math.min(cents(usd), cents(receivedUsd) - (Number(q.fee) || 0));
  const { sellRate } = await getBrailsClient().getPayoutRate(currency);
  let target = Math.floor(usd * Number(sellRate) * 100);
  let quote = await getBrailsClient().createPayoutQuote({ targetCurrency: currency, targetMinor: target, country });
  if (quote.sourceAmount > budgetFor(quote)) {
    target = Math.floor((target * budgetFor(quote)) / quote.sourceAmount);
    quote = await getBrailsClient().createPayoutQuote({ targetCurrency: currency, targetMinor: target, country });
    if (quote.sourceAmount > budgetFor(quote)) {
      throw Object.assign(
        new Error(`quote needs ${quote.sourceAmount}¢ + ${quote.fee}¢ fee, only ${cents(receivedUsd)}¢ received`),
        { status: 422 },
      );
    }
  }
  return quote;
}

/** A payout finished: settle the withdrawal it belongs to. */
export async function onBrailsPayout(data: BrailsEventData, succeeded: boolean): Promise<Outcome> {
  if (!data.id) return { ok: false, note: 'payout event without a transaction id', retry: false };

  const tx = await getBrailsClient().getTransaction(data.id);
  const status = tx.status?.toLowerCase() ?? '';
  // A failure is any final state but success — FAILED, EXPIRED, or a reversal — so a refund is
  // never missed over the word Brails used. Still in flight means ask again later.
  const inFlight = ['initiated', 'pending', 'processing'].includes(status);
  if (succeeded ? status !== 'success' : inFlight || status === 'success' || !status) {
    return { ok: false, note: `payout ${data.id} is ${tx.status}, event said ${succeeded ? 'success' : 'failed'}`, retry: true };
  }

  // By the payout id we stored, or by our order reference, which Brails echoes back — the
  // second catches a payout that was not started by onBrailsDeposit (e.g. sent by hand).
  const select = 'id, status, provider_order_id, provider_metadata';
  const byId = await supabaseAdmin
    .from('withdrawals')
    .select(select)
    .eq('provider', 'brails')
    .eq('provider_metadata->brails->>payoutId', data.id)
    .maybeSingle();
  const w =
    byId.data ??
    (data.reference
      ? (await supabaseAdmin.from('withdrawals').select(select).eq('provider', 'brails').eq('provider_order_id', data.reference).maybeSingle()).data
      : null);
  if (!w?.provider_order_id) return { ok: false, note: `no withdrawal for payout ${data.id}`, retry: true };
  if (w.status !== 'processing') return { ok: true, note: `withdrawal already ${w.status}` };

  // Claim the settlement, so a second delivery of this event cannot send a second receipt.
  const settledAs = succeeded ? 'success' : 'failed';
  const claimed = await updateBrailsMeta(w.id, (b) =>
    b.settledAs ? null : { ...b, settledAs, payoutStatus: succeeded ? 'SUCCESS' : 'FAILED' },
  );
  if (!claimed) return { ok: true, note: 'payout already being settled' };
  // An unrecorded outcome must stay retryable, so a failed finalise gives the claim back.
  const unsettle = () => updateBrailsMeta(w.id, (b) => without(b, 'settledAs', settledAs));

  const orderId = w.provider_order_id;
  if (succeeded) {
    const { error } = await supabaseAdmin.rpc('finalize_withdrawal_success', { p_paycrest_order_id: orderId });
    if (error) {
      await unsettle();
      return { ok: false, note: error.message, retry: true };
    }
    await triggerWithdrawalNotifications(orderId, 'completed');
    await accrueReferralEarning({ providerOrderId: orderId });
    return { ok: true, note: `withdrawal ${orderId} completed` };
  }

  // The USD is back in our Brails wallet; the debt is recorded so it is refunded, not lost.
  const { error } = await supabaseAdmin.rpc('finalize_withdrawal_failed', {
    p_paycrest_order_id: orderId,
    p_reason: 'Brails could not complete the payout',
  });
  if (error) {
    await unsettle();
    return { ok: false, note: error.message, retry: true };
  }
  await triggerWithdrawalNotifications(orderId, 'failed');
  await voidReferralEarning({ providerOrderId: orderId });
  await releaseBenefitsForOrder(orderId);
  return { ok: true, note: `withdrawal ${orderId} failed` };
}
