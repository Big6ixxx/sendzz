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
import { brailsNeedsSender, brailsPhone, parseBrailsInstitution } from '@/lib/ramp/providers/brails';
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

/** Drop a claim this handler took, so the event can run again. */
function without(brails: BrailsMeta, key: 'payoutId' | 'settledAs', value: string): BrailsMeta | null {
  if (brails[key] !== value) return null;
  const rest = { ...brails };
  delete rest[key];
  return rest;
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

  const meta = (w.provider_metadata ?? {}) as { brails?: { payoutId?: string } };
  if (meta.brails?.payoutId) return { ok: true, note: `payout ${meta.brails.payoutId} already started` };
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
  // Never pay out more than this withdrawal was for.
  const payUsd = Math.min(received, expected);

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
  const claimed = await updateBrailsMeta(w.id, (b) => (b.payoutId ? null : { ...b, ...depositFacts, payoutId: 'starting' }));
  if (!claimed) return { ok: true, note: 'payout already being started' };
  const release = () => updateBrailsMeta(w.id, (b) => without(b, 'payoutId', 'starting'));

  let payout: BrailsTransaction;
  let quote: BrailsQuote;
  // Until sendPayout is called nothing can have been paid, so any failure before it is safe to
  // retry. After it, only a clear refusal is; anything else may have paid.
  let sending = false;
  try {
    // Saved first: the payout API takes a beneficiary by id. Our order reference ties the
    // beneficiary and the payout to this withdrawal on Brails' side.
    const beneficiary = await getBrailsClient().createBeneficiary({
      reference: orderId,
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
              ...(sender ? { sender } : {}),
            },
    });
    quote = await quoteToFit(payUsd, received, w.fiat_currency, inst.country);
    sending = true;
    payout = await getBrailsClient().sendPayout({
      reference: orderId,
      targetMinor: quote.targetAmount,
      beneficiaryId: beneficiary.id,
      customerEmail,
      description: `Sendzz withdrawal ${orderId}`,
      quoteId: quote.quoteId,
    });
  } catch (err) {
    const httpStatus = (err as { status?: number }).status ?? 0;
    const message = (err as Error).message;
    const refused = httpStatus >= 400 && httpStatus < 500 && ![401, 403, 429].includes(httpStatus);

    if (!refused && !sending) {
      // Nothing was sent: our side (bad key, IP not whitelisted, rate limit) or Brails had no
      // answer before the payout call. Release the claim and let the event run again.
      console.error(`[Brails] Payout for ${orderId} not started (${httpStatus || 'no response'}): ${message}. Will retry.`);
      await release();
      return { ok: false, note: `not started (${httpStatus || 'no response'}) — will retry`, retry: true };
    }
    if (refused && sending) {
      // Refused at the payout call itself. Usually nothing was paid — but a refusal of a repeated
      // call (a duplicate reference) can mean the payout already exists, and failing the
      // withdrawal then would refund money the beneficiary was also paid. So ask first.
      const existing = await getBrailsClient().findPayoutByReference(orderId).catch(() => undefined);
      if (existing === undefined) {
        console.error(`[Brails] NEEDS REVIEW ${orderId}: payout refused (${message}) and Brails could not be asked whether it exists.`);
        return { ok: false, note: 'payout refusal unconfirmed', retry: false };
      }
      if (existing) {
        await updateBrailsMeta(w.id, (b) => ({ ...b, payoutId: existing.id, payoutReference: existing.reference, payoutStatus: existing.status }));
        console.log(`[Brails] ${orderId}: payout ${existing.id} already exists — recorded instead of failing.`);
        return { ok: true, note: `payout ${existing.id} already exists` };
      }
    }
    if (refused) {
      // Brails refused it outright (below the corridor minimum, bad number, unsupported
      // network…): nothing was paid, so the withdrawal fails and the amount is owed back.
      return failUnpaid(w.id, orderId, `Brails rejected the payout: ${message}`);
    }
    // The payout call had no clear answer: Brails may or may not have sent it. Retrying could
    // pay twice, so the claim stays and the row is left for a person to check.
    console.error(
      `[Brails] NEEDS REVIEW ${orderId}: payout of ${payUsd} USD had no clear answer ` +
        `(${message}). Check Brails before retrying.`,
    );
    return { ok: false, note: 'payout unconfirmed', retry: false };
  }

  await updateBrailsMeta(w.id, (b) => ({
    ...b,
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
 * The backstop for a deposit whose webhook found no withdrawal.
 *
 * The browser saves the transaction hash after the transfer confirms, so the deposit webhook can
 * arrive first, and Brails' three retries come within minutes. Any Brails withdrawal still
 * waiting with a hash but no payout is looked up on Brails by that hash and, if the deposit is
 * there, run through `onBrailsDeposit` exactly as the webhook would have.
 */
export async function reconcileBrailsDeposits(): Promise<{ checked: number; started: number }> {
  const now = Date.now();
  const { data: waiting } = await supabaseAdmin
    .from('withdrawals')
    .select('id, tx_hash, provider_order_id')
    .eq('provider', 'brails')
    .eq('status', 'processing')
    .not('tx_hash', 'is', null)
    .is('provider_metadata->brails->>payoutId', null)
    .lt('created_at', new Date(now - 5 * 60_000).toISOString())
    .gt('created_at', new Date(now - 24 * 60 * 60_000).toISOString())
    .limit(20);

  let started = 0;
  for (const w of waiting ?? []) {
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
