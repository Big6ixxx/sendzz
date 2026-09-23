'use server';

/**
 * The account actions a signed-in user may take on their OWN record.
 *
 * Every export here is a POST endpoint that anyone can invoke once they know its action id.
 * That is the whole reason this file looks the way it does.
 *
 * --- What was wrong -----------------------------------------------------------
 *
 * These used to take an email as their first argument and trust it:
 *
 *     registerUserAddress(email, address)   // upsert on email, no authentication
 *
 * Anyone could POST somebody else's email with an address of their own, and the victim's
 * `smart_account_address` was rewritten. The next payment sent to that person — looked up by
 * exactly this email, in useTransfer and batch-send — would be delivered to the attacker, and
 * the victim's balance and deposit scanning would go quiet because both read the same column.
 * No session, no ownership check, no trace.
 *
 * --- The rule now -------------------------------------------------------------
 *
 * Identity comes from the session; arguments say what to do, never who is doing it. There is
 * no email parameter on a self-write, so there is nothing to forge.
 *
 * Work that is legitimately ABOUT somebody else — creating a wallet for a recipient who has
 * never signed in — lives in lib/supabase/user-records.ts, which is not a server action and is
 * reachable only from server code that has already decided the caller may act.
 */

import { requireUser } from '@/lib/auth/session';
import {
  readSmartAccountAddress,
  writeUserAddresses,
  type UserAddresses,
} from './user-records';
import { attributeReferral } from '@/lib/referrals/attribution';

/**
 * Record the addresses of the signed-in user's own wallets.
 *
 * Called on every dashboard load once the smart account address has been derived. Idempotent:
 * the same addresses written twice is a no-op upsert.
 */
export async function registerMyAddresses(input: {
  address: string;
  solanaAddress?: string;
  stellarAddress?: string;
  stellarWalletId?: string;
  stellarSignerGranted?: boolean;
  /**
   * The referral code this browser was carrying, if any. Honoured only for an account with no
   * referrer yet — see lib/referrals/attribution.ts, and migration 053 where the database
   * enforces the same rule again.
   */
  referralCode?: string | null;
  accessToken?: string;
}): Promise<void> {
  const { email } = await requireUser(input.accessToken);

  const userId = await writeUserAddresses(email, {
    smartAccountAddress: input.address,
    solanaAddress: input.solanaAddress,
    stellarAddress: input.stellarAddress,
    stellarWalletId: input.stellarWalletId,
    stellarSignerGranted: input.stellarSignerGranted,
  });

  // After the row exists, never before. Attribution never throws — a referral that fails to
  // land costs one commission, where an exception here would break sign-in itself.
  if (input.referralCode && userId) {
    await attributeReferral({ userId, code: input.referralCode });
  }
}

/** Record the signed-in user's own Stellar wallet. */
export async function registerMyStellarAddress(input: {
  stellarAddress: string;
  stellarWalletId: string;
  stellarSignerGranted?: boolean;
  accessToken?: string;
}): Promise<void> {
  const { email } = await requireUser(input.accessToken);

  await writeUserAddresses(email, {
    stellarAddress: input.stellarAddress,
    stellarWalletId: input.stellarWalletId,
    stellarSignerGranted: input.stellarSignerGranted,
  });
}

/**
 * Where to send money for a given email — the recipient of a transfer.
 *
 * An email argument is correct here and cannot be removed: the whole point is to look up
 * somebody OTHER than the caller. What it gains is a session requirement, which turns an open
 * email-to-wallet oracle into one that costs an account.
 *
 * That is a real but partial mitigation, and worth being precise about: a signed-in attacker
 * can still probe addresses one email at a time. Closing that properly needs rate limiting,
 * which is a separate piece of work — this removes the anonymous bulk case, not the patient
 * authenticated one.
 *
 * Returns null for an unknown email, which is inherent to the feature: the sender has to know
 * whether to pre-generate a wallet for somebody who has never signed in.
 */
export async function lookupRecipientAddress(
  email: string,
  accessToken?: string,
): Promise<string | null> {
  await requireUser(accessToken);
  return readSmartAccountAddress(email);
}

/** Every address the signed-in user holds. */
export async function getMyAddresses(accessToken?: string): Promise<UserAddresses | null> {
  const { email } = await requireUser(accessToken);
  const { readUserAddresses } = await import('./user-records');
  return readUserAddresses(email);
}
