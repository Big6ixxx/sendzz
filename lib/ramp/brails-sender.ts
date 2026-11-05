import 'server-only';

/**
 * The sender a payout partner asks for on some corridors: a first and last name, a country and,
 * for some (Rwanda on Brails, every mobile money payout on Bitnob), an address.
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
  /**
   * The address on the ID document, or the sender's country name when it shows none (passports
   * and NIN slips do not). Bitnob asked for an address that locates the sender; the country is
   * what we can stand behind until we ask the user for one.
   */
  address: string;
}

/** "NG" → "Nigeria". The code itself if the runtime has no name for it. */
export function countryName(alpha2: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(alpha2.toUpperCase()) ?? alpha2;
  } catch {
    return alpha2;
  }
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
  return {
    accountName: `${identity.firstName} ${identity.lastName}`.replace(/\s+/g, ' '),
    country,
    address: identity.address ?? countryName(country),
  };
}
