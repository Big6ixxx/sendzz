/**
 * Fiat Currency Configuration
 *
 * Central config for all Paycrest-supported fiat currencies.
 * Used across TransferModule, DepositForm, WithdrawForm, etc.
 */

export type FiatCurrencyCode = 'NGN' | 'KES' | 'GHS';

export interface FiatCurrency {
  code: FiatCurrencyCode;
  name: string;
  symbol: string;
  flag: string;
}

export const SUPPORTED_FIAT_CURRENCIES: FiatCurrency[] = [
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', flag: '🇳🇬' },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', flag: '🇰🇪' },
  { code: 'GHS', name: 'Ghanaian Cedi', symbol: 'GH₵', flag: '🇬🇭' },
];

export const FIAT_CURRENCY_MAP: Record<FiatCurrencyCode, FiatCurrency> = {
  NGN: SUPPORTED_FIAT_CURRENCIES[0],
  KES: SUPPORTED_FIAT_CURRENCIES[1],
  GHS: SUPPORTED_FIAT_CURRENCIES[2],
};

/**
 * Get the currency symbol for a given fiat code
 */
export function getCurrencySymbol(code: string): string {
  const currency = FIAT_CURRENCY_MAP[code as FiatCurrencyCode];
  return currency?.symbol || code;
}
