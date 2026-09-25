/**
 * Stopping a standing condition from becoming an hourly email.
 *
 * An alert about something that stays wrong — a treasury running low, a queue backing up —
 * fires on every run of the job that notices it. Sent every time, admins learn within a day
 * that the alert can be ignored, and then it is worse than nothing: it looks like coverage
 * while being filtered into a folder nobody opens.
 *
 * `claimAlertSlot` is the gate. It returns true at most once per cooldown per key, and the
 * decision is made in the database so it survives across serverless invocations — a
 * module-level timestamp would reset on every cold start and gate nothing at all.
 */

import { supabaseAdmin } from '@/lib/supabase/adminClient';

/**
 * May this alert be sent right now?
 *
 * Claims the slot as a side effect, so two concurrent runs cannot both be told yes. Returns
 * false on any error: failing to send one alert about a condition that is still true — and
 * will therefore be noticed again next run — beats sending a burst of them.
 */
export async function claimAlertSlot(key: string, cooldownMs: number): Promise<boolean> {
  const cutoff = new Date(Date.now() - cooldownMs).toISOString();
  const now = new Date().toISOString();

  try {
    // Take the slot only if the last send is older than the cooldown. Conditional inside the
    // UPDATE, not checked first and written after, so simultaneous runs produce one winner.
    const { data: refreshed, error: updateError } = await supabaseAdmin
      .from('ops_alert_log')
      .update({ last_sent_at: now })
      .eq('key', key)
      .lt('last_sent_at', cutoff)
      .select('key');

    if (updateError) {
      console.error('[OpsAlert] cooldown check failed:', updateError.message);
      return false;
    }
    if (refreshed && refreshed.length > 0) return true;

    // No row updated: either the key is new, or it was sent recently. Inserting tells the two
    // apart without a read — a unique violation means a row already exists, which given the
    // UPDATE above did not match can only mean it is still inside its cooldown.
    const { error: insertError } = await supabaseAdmin
      .from('ops_alert_log')
      .insert({ key, last_sent_at: now });

    if (!insertError) return true;
    if (insertError.code === '23505') return false;

    console.error('[OpsAlert] cooldown claim failed:', insertError.message);
    return false;
  } catch (err) {
    console.error('[OpsAlert] cooldown claim threw:', (err as Error).message);
    return false;
  }
}
