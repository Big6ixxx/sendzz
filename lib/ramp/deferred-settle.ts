/**
 * Completing a deferred payout — the verification gates, then initialize + finalize.
 *
 * A deferred payout (shared-address chains, see `hasSharedDepositAddress`) exists as a quote only
 * until its deposit is proven. This is the step that turns it into a real payout.
 *
 * It lives OUTSIDE `lib/actions/*` deliberately. Those files are `"use server"`, where every
 * export is a client-callable server action — an auth-free helper there would be a hole straight
 * past the ownership check. Callers supply their own authorisation: the server action checks the
 * session owns the withdrawal, the reconcile cron runs as a trusted job.
 */
import { getBitnobClient } from "@/lib/bitnob/client";
import { supabaseAdmin } from "@/lib/supabase/adminClient";
import { toUserSafeMessage } from "@/lib/errors/sanitize";
import { Ramp } from "@/lib/ramp";
import type { DeferredBeneficiary } from "./beneficiary-vault";

export interface CompleteDeferredPayoutInput {
  /** Withdrawal row id — what the hash is claimed against. */
  rowId: string;
  /** The Bitnob quote awaiting a beneficiary. */
  quoteId: string;
  /** Our order reference (`offramp_…`). */
  orderId: string;
  /** The user's transfer hash — the only thing tying their deposit to this payout. */
  txHash: string;
  /** What the payout debits: base + corridor fee. */
  requiredUsdc: number;
  network: string;
  fiatCurrency: string;
  bank: DeferredBeneficiary;
  userEmail?: string;
  /** Hash already on the row, if any — lets a retry re-claim its own deposit. */
  currentTxHash?: string | null;
  /** How long to wait for the deposit to settle. The cron wants a shorter wait than a browser. */
  maxAttempts?: number;
}

export interface CompleteDeferredPayoutResult {
  ok: boolean;
  reason?: string;
  /** True when the deposit simply has not settled yet — worth retrying, not a failure. */
  retryable?: boolean;
}

export async function completeDeferredPayout(
  input: CompleteDeferredPayoutInput,
  tag = "[DeferredSettle]",
): Promise<CompleteDeferredPayoutResult> {
  const client = getBitnobClient();
  const attempts = input.maxAttempts ?? 15;

  // ── Gate 1: a settled deposit on this chain, for this hash, big enough ────
  let settled = null as Awaited<ReturnType<typeof client.findSettledDeposit>>;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    settled = await client
      .findSettledDeposit({
        txHash: input.txHash,
        minAmountUsdc: input.requiredUsdc,
        chain: input.network,
      })
      .catch((e) => {
        console.warn(`${tag} deposit lookup failed:`, e);
        return null;
      });
    if (settled) break;
    console.log(
      `${tag} ${input.orderId} deposit ${input.txHash} not settled yet ` +
        `(attempt ${attempt}/${attempts}) — no payout created.`,
    );
    if (attempt < attempts) await new Promise((r) => setTimeout(r, 4000));
  }

  if (!settled) {
    return { ok: false, reason: "deposit not confirmed yet", retryable: true };
  }

  // ── Gate 3 (read first, it is the one that used to 422) ──────────────────
  const available = await client.getAvailableUsdc().catch(() => null);
  console.log(
    `${tag} ${input.orderId} — deposit ${settled.reference} (${settled.amountUsdc} USDC on ` +
      `${settled.chain}) settled, available balance ${available ?? "unknown"} USDC, ` +
      `payout needs ${input.requiredUsdc}.`,
  );
  if (available != null && available + 1e-9 < input.requiredUsdc) {
    return { ok: false, reason: "balance not yet credited", retryable: true };
  }

  // ── Gate 2: claim the deposit so it can fund only this payout ────────────
  // Plain filters only: PostgREST rejects an `or=` filter naming a column that is also in the
  // SET list (42703), which once masqueraded as a reuse and blocked a good payout.
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from("withdrawals")
    .update({ tx_hash: input.txHash })
    .eq("id", input.rowId)
    .is("tx_hash", null)
    .select("id");

  const alreadyOurs =
    !claimError && claimed?.length === 0 && input.currentTxHash === input.txHash;

  if (!alreadyOurs && (claimError || !claimed || claimed.length === 0)) {
    const { data: holder } = await supabaseAdmin
      .from("withdrawals")
      .select("provider_order_id")
      .eq("tx_hash", input.txHash)
      .neq("id", input.rowId)
      .limit(1);
    console.error(
      `${tag} refusing ${input.orderId} — could not claim transfer ${input.txHash}` +
        `${holder?.[0] ? `; already spent by ${holder[0].provider_order_id}` : ""}` +
        `${claimError ? ` (${claimError.message})` : ""}. No payout created.`,
    );
    return { ok: false, reason: "that transfer has already funded a withdrawal" };
  }

  // ── Attach the beneficiary, now that the money is provably here ──────────
  //
  // Use the code the ORDER was created with, recorded on the row as `institution_code`. It was
  // resolved once, from the bank the user actually picked, and is the identifier this payout has
  // been associated with all along.
  //
  // Re-deriving it here from a name was a second, independent resolution that could disagree
  // with the first — and it ran against a name the client passes as
  // `bankDetails.bankName || bankDetails.bankCode`, so a blank name silently sent the CODE in as
  // the name to match. Matching is fuzzy (`matchBank` falls back to a substring hit), so that
  // resolves to *some* bank rather than none: a valid-looking code for the wrong institution,
  // which the provider rejects as an invalid beneficiary — after the user's money has arrived.
  //
  // A deferred payout attaches no beneficiary at order time, so nothing validated the code
  // earlier; this is the first moment the provider sees it, and it must be the right one.
  const { data: rowBank } = await supabaseAdmin
    .from("withdrawals")
    .select("institution_code")
    .eq("id", input.rowId)
    .maybeSingle();

  let bankCode = rowBank?.institution_code ?? null;

  if (!bankCode) {
    // Only for rows that predate this, or a sealed beneficiary replayed without a row code.
    const resolved = await Ramp.resolveBankCode(
      "bitnob",
      input.bank.bankName,
      input.fiatCurrency,
    );
    if (!resolved) {
      return { ok: false, reason: `no bank matching "${input.bank.bankName}"` };
    }
    console.warn(
      `${tag} ${input.orderId} had no institution_code on the row — fell back to resolving ` +
        `"${input.bank.bankName}" to ${resolved.code}.`,
    );
    bankCode = resolved.code;
  }

  const { BitnobProvider } = await import("./providers/bitnob");
  try {
    await new BitnobProvider().initializeDeferredPayout({
      quoteId: input.quoteId,
      reference: input.orderId,
      fiatCurrency: input.fiatCurrency,
      bank: {
        accountNumber: input.bank.accountNumber,
        bankCode,
        accountName: input.bank.accountName,
        memo: input.bank.memo,
      },
      userEmail: input.userEmail,
    });
    console.log(`${tag} ${input.quoteId} initialized against ${settled.reference}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      `${tag} initialize failed for ${input.quoteId} — bank_code=${bankCode}, ` +
        `bankName="${input.bank.bankName}", currency=${input.fiatCurrency}:`,
      msg,
    );
    return { ok: false, reason: toUserSafeMessage(msg) ?? "could not create the payout" };
  } finally {
    // The payout either exists or the quote is spent; either way the sealed copy is done.
    await supabaseAdmin
      .from("withdrawals")
      .update({ pending_beneficiary: null })
      .eq("id", input.rowId);
  }

  // ── Release it. The deposit is verified, so finalize needs no re-check ───
  for (let attempt = 1; attempt <= 15; attempt++) {
    try {
      await client.finalizePayout(input.quoteId);
      console.log(`${tag} payout finalized for ${input.quoteId}`);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/pending_address_deposit|cannot transition/i.test(msg)) {
        console.log(`${tag} ${input.quoteId} not transitionable yet (attempt ${attempt}/15)...`);
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }
      console.error(`${tag} finalize failed for ${input.quoteId}:`, msg);
      return { ok: false, reason: "payout created but not yet released", retryable: true };
    }
  }
  return { ok: false, reason: "payout created but not yet released", retryable: true };
}
