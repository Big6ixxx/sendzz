import 'server-only';

/**
 * Is Brails' payout corridor for a currency down right now?
 *
 * Brails has no status page or corridor webhook. Their advice is that a 503 on a payout means
 * the corridor is temporarily down, so that is the signal: a payout in this currency that
 * failed that way in the last 30 minutes, with no payout in the currency sent since.
 * scheduleRetry in brails-payout.ts writes `corridorDownAt`; a sent payout writes `payoutSentAt`.
 *
 * Read from the withdrawals themselves rather than kept in memory, so it holds across
 * restarts. Cached briefly, since routing asks on every quote refresh.
 */
import { supabaseAdmin } from '@/lib/supabase/adminClient';

const DOWN_FOR_MS = 30 * 60_000;
const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; down: Promise<boolean> }>();

export function brailsCorridorDown(currency: string): Promise<boolean> {
  const key = currency.toUpperCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.down;

  const down = (async () => {
    const brailsIn = () =>
      supabaseAdmin
        .from('withdrawals')
        .select('provider_metadata')
        .eq('provider', 'brails')
        .ilike('fiat_currency', key)
        // Bounded by age so the created_at index does the work on this hot path. A payout
        // failing or going through now belongs to a withdrawal from the last few days.
        .gt('created_at', new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString());
    const { data: failed, error } = await brailsIn()
      .gt('provider_metadata->brails->>corridorDownAt', new Date(Date.now() - DOWN_FOR_MS).toISOString())
      .order('provider_metadata->brails->>corridorDownAt', { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const downAt = (failed?.[0]?.provider_metadata as { brails?: { corridorDownAt?: string } } | null)?.brails?.corridorDownAt;
    if (!downAt) return false;
    // Any payout in this currency that went through since the last failure means it is back.
    const { data: sent, error: sentError } = await brailsIn().gt('provider_metadata->brails->>payoutSentAt', downAt).limit(1);
    if (sentError) throw new Error(sentError.message);
    const isDown = !sent?.length;
    if (isDown) console.warn(`[Ramp] Brails ${key} payouts failed recently — routing ${key} withdrawals elsewhere for now.`);
    return isDown;
  })();
  cache.set(key, { at: Date.now(), down });
  down.catch(() => {
    if (cache.get(key)?.down === down) cache.delete(key);
  });
  return down;
}
