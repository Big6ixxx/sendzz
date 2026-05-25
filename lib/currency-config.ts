/**
 * Fiat Currency Configuration
 *
 * Central config for all Paycrest-supported fiat currencies.
 * Used across TransferModule, DepositForm, WithdrawForm, etc.
 */

export type FiatCurrencyCode = string;

export interface FiatCurrency {
  code: FiatCurrencyCode;
  name: string;
  symbol: string;
  flag: string;
}

// Map for quick lookup of symbols if we have the detail objects
const CURRENCY_SYMBOL_CACHE: Record<string, string> = {
  NGN: '₦',
  KES: 'KSh',
  GHS: 'GH₵',
  UGX: 'USh',
  TZS: 'TSh',
  MWK: 'MK',
  BRL: 'R$',
};

/**
 * Get the currency symbol for a given fiat code
 */
export function getCurrencySymbol(code: string): string {
  return CURRENCY_SYMBOL_CACHE[code] || code;
}

/**
 * Helper to get flag emoji for a currency code
 */
export function getCurrencyFlag(code: string): string {
  const flags: Record<string, string> = {
    NGN: '🇳🇬',
    KES: '🇰🇪',
    GHS: '🇬🇭',
    UGX: '🇺🇬',
    TZS: '🇹🇿',
    MWK: '🇲🇼',
    BRL: '🇧🇷',
  };
  return flags[code] || '🏳️';
}
