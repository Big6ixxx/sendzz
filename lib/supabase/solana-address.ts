/**
 * Making sure every user's Solana wallet is on their user row.
 *
 * `users.solana_address` is what the deposit sweep scans, what Alchemy is told to watch, and
 * where refunds go, so a user without it has Solana deposits nobody records. Every user gets a
 * Solana wallet at login, but the address used to reach the row only through one call from the
 * dashboard, which dropped it silently whenever Privy could not yet confirm a just-created
 * wallet, and was never retried. A third of users ended up without it.
 *
 * Now three independent paths fill it, and any one of them is enough:
 *   1. the dashboard, which retries when the server says the wallet was not confirmed yet;
 *   2. a Solana send, which has just confirmed the wallet with Privy anyway;
 *   3. `backfillSolanaAddresses` in the reconcile cron, which asks Privy for users still
 *      missing one, so a user who never returns is covered too.
 *
 * All of them only ever write an address Privy confirms is the user's own embedded wallet, and
 * only into an empty column: a saved address is never overwritten from here.
 */
import { privySolanaWalletsByEmail } from '@/lib/auth/session';
import { claimAlertSlot } from '@/lib/ops/alert-cooldown';
import { supabaseAdmin } from './adminClient';

/** Users repaired per cron run. Each costs one Privy lookup. */
const BACKFILL_PER_RUN = 10;

/**
 * How long before a user Privy had no Solana wallet for is asked about again. Long enough not to
 * spend a lookup per run on the same handful, short enough that a late wallet is still found.
 */
const RECHECK_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Save `address` as this user's Solana wallet if they have none yet, and have Alchemy watch it.
 * The caller must already have confirmed with Privy that the wallet is theirs.
 * Returns true when the address was saved by this call.
 */
export async function saveSolanaAddressIfMissing(userId: string, address: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .update({ solana_address: address })
    .eq('id', userId)
    .is('solana_address', null)
    .select('id');
  if (error) {
    console.error(`[SolanaAddress] save failed for ${userId}:`, error.message);
    return false;
  }
  if (!data?.length) return false;

  try {
    const { watchRailAddresses } = await import('@/lib/web3/alchemy-registry');
    await watchRailAddresses('solana', [address]);
  } catch (e) {
    // The daily watch-list sync registers it later; saving the address was what mattered.
    console.error('[SolanaAddress] Alchemy registration failed (non-fatal):', e);
  }
  return true;
}

/** Fill in missing Solana addresses from Privy. Returns how many were saved. */
export async function backfillSolanaAddresses(): Promise<number> {
  const { data: candidates, error } = await supabaseAdmin
    .from('users')
    .select('id, email')
    .is('solana_address', null)
    .not('email', 'is', null)
    // All of them, newest first: a user who just signed up is the one most likely to be
    // mid-deposit, and reading only the top few would let users with no wallet at all fill
    // that window for good. The list is small, and only claimed users cost a Privy call.
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[SolanaAddress] backfill query failed:', error.message);
    return 0;
  }

  let looked = 0;
  let saved = 0;
  for (const u of candidates ?? []) {
    if (looked >= BACKFILL_PER_RUN) break;
    // One lookup per user per window, so the same users without a wallet do not use up every
    // run, and the rest of the list gets its turn.
    if (!(await claimAlertSlot(`solana-backfill:${u.id}`, RECHECK_AFTER_MS))) continue;
    looked++;

    let wallets: string[];
    try {
      wallets = await privySolanaWalletsByEmail(u.email!);
    } catch (e) {
      console.error('[SolanaAddress] Privy lookup failed, stopping this run:', e instanceof Error ? e.message : e);
      // Not an answer about this user, so they are not made to wait out the window.
      await supabaseAdmin.from('ops_alert_log').delete().eq('key', `solana-backfill:${u.id}`);
      break;
    }
    // Primary first (see privySolanaWallets); none means they have not logged in since Solana
    // wallets were added, and the rotation asks again later.
    if (wallets.length === 0) continue;
    if (await saveSolanaAddressIfMissing(u.id, wallets[0])) saved++;
  }
  if (saved > 0) console.log(`[SolanaAddress] backfilled ${saved} Solana address(es)`);
  return saved;
}
