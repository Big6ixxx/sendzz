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
  XOF: 'CFA',
  XAF: 'FCFA',
  RWF: 'FRw',
  GMD: 'D',
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
    XOF: '🇨🇮',
    XAF: '🇨🇲',
    RWF: '🇷🇼',
    GMD: '🇬🇲',
    MWK: '🇲🇼',
    BRL: '🇧🇷',
  };
  return flags[code] || '🏳️';
}

/**
 * Payout country for a currency code — kept beside the flag map above so the two can't drift.
 *
 * XOF and XAF are shared across a monetary union rather than belonging to one country, so they
 * name the zone instead of guessing a member state. Anything unmapped returns null rather than
 * a made-up country: in an admin log a wrong country is worse than an absent one.
 */
export function getCurrencyCountry(code: string): string | null {
  const countries: Record<string, string> = {
    NGN: 'Nigeria',
    KES: 'Kenya',
    GHS: 'Ghana',
    UGX: 'Uganda',
    TZS: 'Tanzania',
    XOF: 'West African CFA zone',
    XAF: 'Central African CFA zone',
    RWF: 'Rwanda',
    GMD: 'The Gambia',
    MWK: 'Malawi',
    BRL: 'Brazil',
  };
  return countries[code?.toUpperCase()] ?? null;
}
