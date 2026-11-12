/**
 * Shape rules for bank account numbers, shared by the withdraw form and the server.
 *
 * Nigeria: every bank account number is a 10 digit NUBAN, no more, no less. The trap is the
 * phone-number banks (OPay, PalmPay, Moniepoint and others), whose account number is the
 * customer's phone number without its leading 0. People type the phone number as they know it,
 * 11 digits with the 0, and some name enquiries still resolve that to the right holder, so the
 * form showed a verified name for a number the payout itself then refused, after the user had
 * already deposited. Hence this check runs before any lookup and again before any order.
 *
 * Pure: imported by client components as well as server actions.
 */

/** Digits this currency's bank account numbers always have, where that is fixed. */
export function bankAccountLength(currency: string | undefined): number | undefined {
  return currency?.toUpperCase() === 'NGN' ? 10 : undefined;
}

/** Why this number cannot be a bank account in this currency, or null when its shape is fine. */
export function bankAccountProblem(currency: string | undefined, accountNumber: string): string | null {
  const length = bankAccountLength(currency);
  if (!length) return null;
  const digits = (accountNumber || '').replace(/\D/g, '');
  if (digits.length === length) return null;
  if (digits.length === 11 && digits.startsWith('0')) {
    return 'Nigerian account numbers have 10 digits. If your bank uses your phone number as your account number, leave out the first 0.';
  }
  return 'Nigerian account numbers have 10 digits.';
}

/**
 * What to tell someone about the number they are typing, or null.
 *
 * Too long is said at once. Too short only once `settled`, meaning they have stopped typing:
 * every number is too short on its way to ten digits, and nagging each keystroke helps nobody.
 * Without it, a finished nine digit number got no lookup and no word about why.
 */
export function bankAccountHint(
  currency: string | undefined,
  accountNumber: string,
  settled = false,
): string | null {
  const length = bankAccountLength(currency);
  const digits = (accountNumber || '').replace(/\D/g, '').length;
  if (!length || digits === 0 || digits === length) return null;
  if (digits < length && !settled) return null;
  return bankAccountProblem(currency, accountNumber);
}
