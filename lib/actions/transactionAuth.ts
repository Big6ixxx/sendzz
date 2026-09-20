'use server';

/**
 * Spending a PIN authorisation for an operation the browser performs itself.
 *
 * EVM sends and bridges are signed in the page, against Circle's bundler — no server sits
 * between the user and the chain, so there is nothing here that could refuse the transaction.
 * What this does is record that the PIN was entered for these exact parameters, immediately
 * before signing.
 *
 * That is worth doing even though it cannot enforce anything. "Was a PIN entered for this
 * payment, and from which device session?" is the first question asked when someone disputes a
 * transfer, and without a record the honest answer is that we have no idea. It also spends the
 * token, so one PIN entry cannot quietly cover a second transaction the user never saw.
 *
 * It is deliberately NOT called from `recordSendIntent`. That runs after the broadcast, and its
 * whole purpose is to make sure a send that happened is never lost from the ledger — adding a
 * condition under which it declines to write would recreate the exact bug migration 049 exists
 * to fix, and would do it on the path where the money has already moved.
 */

import {
  noteClientAuthorization,
  type AuthorizationPayload,
  type AuthorizationPurpose,
} from '@/lib/security/transaction-auth';

/**
 * Returns whether the authorisation was valid. Callers use it for logging, never as a gate —
 * by the time this answers, the decision to sign has already been taken in the browser.
 */
export async function noteTransactionAuthorization(params: {
  token: string | null | undefined;
  purpose: AuthorizationPurpose;
  payload: AuthorizationPayload;
  accessToken?: string;
}): Promise<boolean> {
  return noteClientAuthorization(params);
}
