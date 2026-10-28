import 'server-only';

/**
 * The sender Brails asks for on some corridors (the CFA franc countries, DR Congo, Ethiopia,
 * The Gambia, Guinea, Morocco): a first and last name and a country.
 *
 * The sender is our user, and the only name we can stand behind is the one Didit verified from
 * their ID document — so the sender exists only for users who passed KYC. Everyone else gets
 * null, and those corridors go to the next provider before any order is made.
 */
import { verifiedIdentityOf } from '@/lib/kyc/verified-identity';
import { alpha2FromAlpha3 } from './iso-country';

export interface BrailsSender {
  /** "First Last", the space-separated form Brails requires for individuals. */
  accountName: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
}

/**
 * The verified sender for this user, or null when they have none Brails can use. Not cached
 * here: verifiedIdentityOf keeps the identity by session, so a re-verification is used by Brails
 * the moment it is on the record, as it is by every other provider.
 */
export async function brailsSenderFor(user: { email?: string; id?: string }): Promise<BrailsSender | null> {
  const identity = await verifiedIdentityOf(user);
  if (!identity) return null;
  const country = alpha2FromAlpha3(identity.issuingState);
  if (!country) return null;
  return { accountName: `${identity.firstName} ${identity.lastName}`.replace(/\s+/g, ' '), country };
}
