import 'server-only';

import { supabaseAdmin } from './adminClient';

/**
 * Remove the scanner's deposit copy of a transfer, now that the transfer itself is on the ledger.
 *
 * A Sendzz-to-Sendzz send arrives on chain like any outside payment, so the deposit scanner can
 * record it as an `onchain` deposit before the transfer row exists or is linked to the recipient
 * — and the recipient then sees one payment twice. Whichever path writes or links the transfer
 * calls this: the browser recording it, the reconciler recovering it, and a claim or accept
 * attaching it to the recipient's account.
 *
 * Scoped to this user, this hash and `onchain` deposits only, so a fiat on-ramp deposit or
 * somebody else's row can never be touched. Never throws: the transfer is the record that
 * matters, and a surviving duplicate is only cosmetic.
 *
 * Server-only rather than in transactions.ts, which is a "use server" module: anything exported
 * there can be called from the browser.
 */
export async function clearDuplicateDeposit(userId: string, txHash: string): Promise<void> {
  try {
    const { data: removed, error } = await supabaseAdmin
      .from('deposits')
      .delete()
      .eq('user_id', userId)
      .eq('tx_hash', txHash.toLowerCase())
      .eq('provider', 'onchain')
      .select('id');
    if (error) throw error;
    if (removed?.length) {
      console.log(
        `[deposit-dedup] ${txHash.slice(0, 14)} was credited as a deposit before its transfer ` +
          `was recorded — removed ${removed.length} duplicate(s).`,
      );
    }
  } catch (err) {
    console.error(`[deposit-dedup] could not clear duplicate deposit for ${txHash.slice(0, 14)}:`, err);
  }
}
