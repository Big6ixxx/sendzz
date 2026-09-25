/**
 * Reading and writing the `users` row for a given email. SERVER ONLY, and NOT a server action.
 *
 * The distinction from users.ts matters more than it looks. Every export in a `'use server'`
 * module is a POST endpoint that anyone can invoke once they know its action id — so a
 * function shaped like `registerUserAddress(email, address)` sitting in one is an open API for
 * rewriting where somebody else's money is delivered. That is precisely what it was, and the
 * whole reason this file exists.
 *
 * So the rule is split by shape:
 *
 *   users.ts        the action surface. Identity comes from the session; there is no email
 *                   parameter to forge.
 *   user-records.ts this file. Takes an email, because some legitimate server work IS about
 *                   another person — paying someone who has never signed in means creating
 *                   their wallet before they exist. Reachable only from server code that has
 *                   already decided the caller may act.
 *
 * Nothing here checks authorisation. That is the caller's job, and the reason this module must
 * never grow a `'use server'` directive: the moment it does, every function below becomes
 * callable by anyone with the action id, and the check the caller was doing is bypassed.
 */

import { attributeReferral } from '@/lib/referrals/attribution';
import type { TablesInsert } from '@/types/database';
import { supabaseAdmin } from './adminClient';

export interface UserAddresses {
  smart_account_address: string | null;
  solana_address: string | null;
  stellar_address: string | null;
  stellar_wallet_id: string | null;
  stellar_signer_granted: boolean;
}

/** Emails are stored lowercase; every lookup and write goes through this. */
function normalize(email: string): string {
  return email.toLowerCase().trim();
}

/** The account row for this email, creating one if it does not exist yet. */
export async function ensureUserRecord(
  email: string,
  referralCode?: string | null,
): Promise<string> {
  const normalizedEmail = normalize(email);

  const { data: existing } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (existing?.id) {
    // Attribution still runs for an existing row, because a user can be created by somebody
    // ELSE sending them money — pre-generate makes the row before they have ever signed in —
    // and this may be the first moment a code they clicked can be honoured.
    if (referralCode) await attributeReferral({ userId: existing.id, code: referralCode });
    return existing.id;
  }

  const { data: inserted, error } = await supabaseAdmin
    .from('users')
    .insert({ email: normalizedEmail, smart_account_address: '' })
    .select('id')
    .single();

  if (error || !inserted) {
    // A concurrent request won the race and created the row first. Reading it back is the
    // intended outcome, not a failure.
    const { data: retry } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', normalizedEmail)
      .single();
    if (retry?.id) {
      if (referralCode) await attributeReferral({ userId: retry.id, code: referralCode });
      return retry.id;
    }
    throw new Error(`Failed to ensure user in DB: ${error?.message}`);
  }

  if (referralCode) await attributeReferral({ userId: inserted.id, code: referralCode });
  return inserted.id;
}

/** Where to deliver USDC for this email, or null when we hold no address for them. */
export async function readSmartAccountAddress(email: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('smart_account_address')
    .eq('email', normalize(email))
    .maybeSingle();

  if (error || !data) return null;
  return data.smart_account_address;
}

/** Every address we hold for this email. */
export async function readUserAddresses(email: string): Promise<UserAddresses | null> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select(
      'smart_account_address, solana_address, stellar_address, stellar_wallet_id, stellar_signer_granted',
    )
    .eq('email', normalize(email))
    .maybeSingle();

  if (error || !data) return null;

  return {
    smart_account_address: data.smart_account_address,
    solana_address: data.solana_address,
    stellar_address: data.stellar_address,
    stellar_wallet_id: data.stellar_wallet_id,
    stellar_signer_granted: !!data.stellar_signer_granted,
  };
}

/**
 * Record the wallet addresses for an email.
 *
 * Only the fields supplied are written, so a Stellar-only update cannot blank a Solana address
 * by omitting it.
 */
export async function writeUserAddresses(
  email: string,
  addresses: {
    smartAccountAddress?: string;
    solanaAddress?: string;
    stellarAddress?: string;
    stellarWalletId?: string;
    stellarSignerGranted?: boolean;
  },
): Promise<string | null> {
  // Typed against the table rather than Record<string, unknown>, so a typo in a column name
  // is a compile error instead of a silently ignored field on the upsert.
  const row: TablesInsert<'users'> = { email: normalize(email) };

  if (addresses.smartAccountAddress !== undefined) {
    row.smart_account_address = addresses.smartAccountAddress;
  }
  if (addresses.solanaAddress) row.solana_address = addresses.solanaAddress;
  if (addresses.stellarAddress) row.stellar_address = addresses.stellarAddress;
  if (addresses.stellarWalletId) row.stellar_wallet_id = addresses.stellarWalletId;
  if (addresses.stellarSignerGranted !== undefined) {
    row.stellar_signer_granted = addresses.stellarSignerGranted;
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .upsert(row, { onConflict: 'email' })
    .select('id')
    .maybeSingle();

  if (error) throw new Error(`Failed to map address: ${error.message}`);

  // Ask Alchemy to watch this address, so a deposit to it arrives as a webhook rather than
  // waiting to be found by the next cron sweep.
  //
  // Not awaited into the caller's failure path: registration is best-effort, and a user with no
  // wallet is a far worse outcome than a user whose first deposit is found by the cron instead.
  // The periodic sync re-registers anything that fails here.
  if (addresses.smartAccountAddress) {
    try {
      const { watchAddress } = await import('@/lib/web3/alchemy-registry');
      await watchAddress(addresses.smartAccountAddress);
    } catch (e) {
      console.error('[Users] Alchemy address registration failed (non-fatal):', e);
    }
  }

  return data?.id ?? null;
}
