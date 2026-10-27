import { getVerifiedIdentity } from '@/lib/auth/session';
import { readUserAddresses } from '@/lib/supabase/user-records';

/**
 * The signed-in caller, provided the Stellar wallet they named is their own.
 *
 * The routes that move Stellar funds sign with Privy's TEE using the server's own key, which
 * can sign for ANY wallet that granted it. So the wallet must be checked against the session
 * before anything is signed: without this, a caller who knew someone's wallet id and address
 * could move that person's USDC. Null when signed out or the wallet is not theirs.
 */
export async function verifyOwnStellarWallet(
  walletId: string,
  address: string,
): Promise<{ email: string; smartAccountAddress: string | null } | null> {
  const identity = await getVerifiedIdentity();
  if (!identity) return null;
  const own = await readUserAddresses(identity.email);
  if (own?.stellar_wallet_id !== walletId || own?.stellar_address !== address) return null;
  return { email: identity.email, smartAccountAddress: own.smart_account_address ?? null };
}
