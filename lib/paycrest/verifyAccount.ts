/**
 * Paycrest Account Verification API
 *
 * Endpoint for verifying bank account details and retrieving account name.
 */

import { getPaycrestClient } from './client';
import type { VerifyAccountRequest } from './types';

/**
 * Verify a bank account and get the account holder's name.
 * POST /verify-account
 *
 * @param institutionCode - Bank institution code (SWIFT or PayCrest code)
 * @param accountIdentifier - Bank account number or mobile number
 * @returns Account holder name or null if verification fails
 */
export async function verifyAccount(
  institutionCode: string,
  accountIdentifier: string,
): Promise<string | null> {
  try {
    const client = getPaycrestClient();
    const request: VerifyAccountRequest = {
      institution: institutionCode,
      accountIdentifier,
    };

    // PayCrest returns the account name directly in the data field
    const accountName = await client.post<string>('/verify-account', request);

    return accountName || null;
  } catch (error) {
    console.error('[PayCrest] Account verification failed:', error);
    return null;
  }
}
