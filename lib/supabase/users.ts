'use server';

import { supabaseAdmin } from './adminClient';
import { attributeReferral } from '@/lib/referrals/attribution';

export async function ensureUserInDatabase(
  email: string,
  /**
   * The referral code this browser was carrying, if any.
   *
   * Only ever acted on for an account that has no referrer yet, so passing it on every
   * sign-in is harmless — see lib/referrals/attribution.ts, where the rule is enforced, and
   * migration 053, where the database enforces it again.
   */
  referralCode?: string | null,
): Promise<string> {
  const normalizedEmail = email.toLowerCase();
  const { data: existing } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (existing?.id) {
    // Existing account. Attribution still runs, because a user can be created by someone
    // ELSE sending them money — `pre-generate` makes the row before they have ever signed in —
    // and this is the first moment a code they clicked can be honoured.
    if (referralCode) await attributeReferral({ userId: existing.id, code: referralCode });
    return existing.id;
  }

  const { data: inserted, error } = await supabaseAdmin
    .from("users")
    .insert({ email: normalizedEmail, smart_account_address: "" })
    .select("id")
    .single();

  if (error || !inserted) {
    const { data: retry } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
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

export async function getUserAddressByEmail(
  email: string,
): Promise<string | null> {
  const normalizedEmail = email.toLowerCase();
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('smart_account_address')
    .eq('email', normalizedEmail)
    .single();

  if (error || !data) return null;
  return data.smart_account_address;
}
export async function registerUserAddress(
  email: string,
  address: string,
  solanaAddress?: string,
  stellarAddress?: string,
  stellarWalletId?: string,
  stellarSignerGranted?: boolean,
  /**
   * The referral code this browser was carrying, if any.
   *
   * This is where referrals are actually attributed, because this — not
   * `ensureUserInDatabase` — is what runs on first sign-in: the dashboard calls it as soon as
   * the smart account address is derived. Honoured only for an account with no referrer yet.
   */
  referralCode?: string | null,
): Promise<void> {
  const normalizedEmail = email.toLowerCase();
  const row: {
    email: string;
    smart_account_address: string;
    solana_address?: string;
    stellar_address?: string;
    stellar_wallet_id?: string;
    stellar_signer_granted?: boolean;
  } = {
    email: normalizedEmail,
    smart_account_address: address,
  };
  if (solanaAddress) row.solana_address = solanaAddress;
  if (stellarAddress) row.stellar_address = stellarAddress;
  if (stellarWalletId) row.stellar_wallet_id = stellarWalletId;
  if (stellarSignerGranted !== undefined) row.stellar_signer_granted = stellarSignerGranted;

  const { data: upserted, error } = await supabaseAdmin
    .from('users')
    .upsert(row, { onConflict: 'email' })
    .select('id')
    .maybeSingle();

  if (error) throw new Error(`Failed to map address: ${error.message}`);

  // After the row exists, never before. Attribution never throws — a referral that does not
  // land costs one commission, while an exception here would break sign-in itself.
  if (referralCode && upserted?.id) {
    await attributeReferral({ userId: upserted.id, code: referralCode });
  }
}

export async function registerStellarAddress(
  email: string,
  stellarAddress: string,
  stellarWalletId: string,
  stellarSignerGranted?: boolean,
  _privyUserId?: string,
): Promise<void> {
  const normalizedEmail = email.toLowerCase();
  const row: {
    email: string;
    stellar_address: string;
    stellar_wallet_id: string;
    stellar_signer_granted?: boolean;
  } = {
    email: normalizedEmail,
    stellar_address: stellarAddress,
    stellar_wallet_id: stellarWalletId,
  };
  if (stellarSignerGranted !== undefined) {
    row.stellar_signer_granted = stellarSignerGranted;
  }

  const { error } = await supabaseAdmin
    .from('users')
    .upsert(row, { onConflict: 'email' });

  if (error) throw new Error(`Failed to map Stellar address: ${error.message}`);
}

export async function getUserAddresses(
  email: string,
  _privyUserId?: string,
): Promise<{
  smart_account_address: string | null;
  solana_address: string | null;
  stellar_address: string | null;
  stellar_wallet_id: string | null;
  stellar_signer_granted: boolean;
} | null> {
  const normalizedEmail = email.toLowerCase();
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('smart_account_address, solana_address, stellar_address, stellar_wallet_id, stellar_signer_granted')
    .eq('email', normalizedEmail)
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
