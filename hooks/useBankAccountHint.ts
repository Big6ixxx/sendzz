import { bankAccountHint } from '@/lib/ramp/bank-account';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

/** How long a typed number must sit unchanged before a too-short one is pointed out. */
const HINT_AFTER_MS = 1500;

/**
 * The message to show under an account number field, or null. A too-long number is pointed out
 * at once, a too-short one only after the person stops typing. See bankAccountHint.
 */
export function useBankAccountHint(currency: string | undefined, accountNumber: string): string | null {
  const settled = useDebouncedValue(accountNumber, HINT_AFTER_MS) === accountNumber;
  return bankAccountHint(currency, accountNumber, settled);
}
