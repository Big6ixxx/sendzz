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
 * An amount with its currency, formatted the one way.
 *
 * Every place that prints a payout was inlining the same three pieces — symbol, amount, code —
 * and so every place carried the same flaw: a letter abbreviation printed as a prefix reads as
 * noise next to the code it duplicates ("FRw14,222.21 RWF"). Four call sites had their own copy
 * of it, which is why fixing the receipt did not fix the app.
 *
 * The prefix appears only when there is a real symbol; otherwise the code alone carries it.
 */
export function formatFiat(
  amount: number,
  code: string,
  options: Intl.NumberFormatOptions = {},
): string {
  const prefix = hasCurrencySymbol(code) ? getCurrencySymbol(code) : '';
  const formatted = amount.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    ...options,
  });
  return `${prefix}${formatted} ${code}`;
}

/**
 * Is there a real SYMBOL for this currency, as opposed to a letter abbreviation?
 *
 * Two things make a prefix not worth printing next to an amount that already carries its code.
 * `getCurrencySymbol` falls back to the code itself, so an unknown currency renders
 * "ZAR14,222.21 ZAR". And several entries here are not symbols at all but letter shorthand —
 * FRw, KSh, USh, TSh, CFA, FCFA — which read as noise in "FRw14,222.21 RWF" rather than as
 * currency marks.
 *
 * So a symbol counts only if it contains a character that is not a letter: ₦, GH₵, R$, $, €, £
 * all qualify; FRw and CFA do not. Callers printing the code alongside should ask this first
 * and leave the prefix blank when it comes back false.
 */
export function hasCurrencySymbol(code: string): boolean {
  const symbol = CURRENCY_SYMBOL_CACHE[code];
  return !!symbol && /[^A-Za-z]/.test(symbol);
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
