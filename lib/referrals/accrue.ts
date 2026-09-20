/**
 * Crediting a referrer when the person they brought makes a deposit.
 *
 * What is shared is OUR REVENUE on the deposit, not the deposit. The reasoning is in the
 * header of migration 053 and it is worth not re-litigating in a hurry: paying a percentage of
 * deposit principal would mean paying real money to anyone willing to cycle the same balance
 * in and out, because an on-chain deposit costs the depositor nothing and earns us nothing.
 *
 * So only FIAT on-ramps accrue. They are the deposits a provider skims a partner fee for us
 * on, which is the only thing here that is genuinely ours to share.
 */

import { feeFromBase, getProviderFee } from '@/lib/ramp/fees';
import type { RampProviderName } from '@/lib/ramp/types';
import { supabaseAdmin } from '@/lib/supabase/adminClient';

/** Providers that earn us a fee on a deposit. On-chain arrivals are not one of them. */
const REVENUE_PROVIDERS: RampProviderName[] = ['paycrest', 'bitnob'];

/**
 * The referrer's cut of our revenue, as a percentage.
 *
 * From the environment, with no compiled-in default, matching every other rate in this
 * codebase (see lib/ramp/fees.ts on why). A missing value here is NOT a hard failure though —
 * it disables accrual rather than throwing, because this runs inside a provider webhook whose
 * actual job is to confirm the user's deposit. Failing that webhook over a referral
 * misconfiguration would hold up somebody's money for a feature they are not using.
 */
function sharePercent(): number | null {
  const raw = process.env.REFERRAL_SHARE_PERCENT;
  const percent = Number(raw);

  if (raw == null || raw === '' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
    console.warn(
      `[Referrals] REFERRAL_SHARE_PERCENT is not configured (got ${JSON.stringify(raw)}). ` +
        'No referral earnings will accrue until it is set.',
    );
    return null;
  }
  return percent;
}

/**
 * Credit the referrer for a deposit that has just confirmed.
 *
 * Idempotent, and that property is load-bearing rather than defensive. Provider webhooks fire
 * more than once for the same order — retries, redeliveries, and our own reconcile cron
 * re-driving a settlement — so "called exactly once per deposit" is not a thing this can
 * assume. The unique index on `deposit_id` is what makes the second call a no-op.
 *
 * Never throws. It runs inside the webhook that confirms the user's deposit, and nothing about
 * a commission should be able to fail that.
 */
export async function accrueReferralEarning(depositId: string): Promise<void> {
  try {
    const percent = sharePercent();
    if (percent == null || percent === 0) return;

    const { data: deposit } = await supabaseAdmin
      .from('deposits')
      .select('id, user_id, amount_usdc, status, provider')
      .eq('id', depositId)
      .maybeSingle();

    if (!deposit) return;

    // Only a deposit that actually landed. Pending and failed ones pay nothing, and a
    // reversal is handled by voidReferralEarning below.
    if (deposit.status !== 'confirmed') return;

    const provider = (deposit.provider ?? '').toLowerCase() as RampProviderName;
    if (!REVENUE_PROVIDERS.includes(provider)) return;

    const amountUsdc = Number(deposit.amount_usdc);
    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) return;

    const { data: referee } = await supabaseAdmin
      .from('users')
      .select('id, referred_by')
      .eq('id', deposit.user_id)
      .maybeSingle();

    if (!referee?.referred_by) return;

    // Our revenue on this deposit. `amount_usdc` is what the user received, net of the fee the
    // provider skimmed for us, so the fee is that figure's share — the same arithmetic the
    // on-ramp priced the order with, through the same helper, so the two cannot drift.
    let basisUsdc: number;
    try {
      basisUsdc = feeFromBase(amountUsdc, getProviderFee(provider).percent);
    } catch (err) {
      // getProviderFee throws when the provider's rate is unset. Loud, but not fatal here.
      console.error('[Referrals] cannot price the deposit fee:', (err as Error).message);
      return;
    }

    if (!(basisUsdc > 0)) return;

    const amount = basisUsdc * (percent / 100);
    // Below a hundredth of a cent there is nothing worth recording, and a row here costs more
    // to carry forever than it is worth.
    if (amount < 0.0001) return;

    const { error } = await supabaseAdmin.from('referral_earnings').upsert(
      {
        referrer_id: referee.referred_by,
        referee_id: referee.id,
        deposit_id: deposit.id,
        // Stored, not derived later. These figures are what the row means; recomputing them
        // from the environment would restate history the first time a rate changes.
        basis_usdc: Number(basisUsdc.toFixed(6)),
        percent,
        amount_usdc: Number(amount.toFixed(6)),
        status: 'accrued',
      },
      { onConflict: 'deposit_id', ignoreDuplicates: true },
    );

    if (error) {
      console.error('[Referrals] could not record earning:', error.message);
      return;
    }

    console.log(
      `[Referrals] accrued ${amount.toFixed(4)} USDC for ${referee.referred_by} on deposit ${deposit.id}`,
    );
  } catch (err) {
    console.error('[Referrals] accrual failed:', (err as Error).message);
  }
}

/**
 * Reverse an accrual when the deposit behind it is reversed or refunded.
 *
 * Only touches rows that are still `accrued`. Once a commission has been paid out on-chain it
 * cannot be taken back, and rewriting a `paid` row to `void` would make the ledger disagree
 * with what actually left the treasury — the balance would look right while the money was
 * gone. A commission paid on a reversed deposit is a small loss; a ledger that cannot be
 * reconciled is a much larger one.
 */
export async function voidReferralEarning(depositId: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from('referral_earnings')
      .update({ status: 'void', updated_at: new Date().toISOString() })
      .eq('deposit_id', depositId)
      .eq('status', 'accrued');

    if (error) console.error('[Referrals] could not void earning:', error.message);
  } catch (err) {
    console.error('[Referrals] void failed:', (err as Error).message);
  }
}
