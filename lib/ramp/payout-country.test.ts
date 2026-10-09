import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A currency is not a country, and payouts were routed as though it were.
 *
 * `getCurrencies` dedupes by currency, so XOF — eight West African countries — arrived as one
 * row. The picker could not offer Senegal, and `resolveCorridor` then scanned for the FIRST
 * country quoting XOF, so a payout meant for Senegal was built against another country's banks
 * and another country's beneficiary.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const bitnob = read('lib/ramp/providers/bitnob.ts');
const router = read('lib/ramp/index.ts');
const hook = read('components/deposit-withdraw/useDepositWithdraw.ts');
const action = read('lib/actions/ramp.ts');
const picker = read('components/deposit-withdraw/DestinationPicker.tsx');
const paycrest = read('lib/ramp/providers/paycrest.ts');

describe('destinations are listed per country', () => {
  it('the provider exposes one row per serviceable country', () => {
    expect(bitnob).toMatch(/async getPayoutCountries\(\)/);
    // Keyed by country, unlike getCurrencies which dedupes on the currency code.
    expect(bitnob).toMatch(/buildPayoutCountries[\s\S]{0,1200}code: c\.code\.toUpperCase\(\)/);
  });

  it('does not require banks, which only Nigeria has', () => {
    // Verifying each country with getBanks removed nearly everything: every corridor except
    // Nigeria pays by mobile money, so "has banks" tests for being Nigeria, not for coverage.
    const build = bitnob.slice(bitnob.indexOf('private async buildPayoutCountries'));
    const body = build.slice(0, build.indexOf('\n  async '));
    const code = body
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/getBanks/);
  });

  it('merges both providers rather than taking the first to answer', () => {
    // Bitnob and Paycrest cover overlapping but different sets; first-wins hid whole corridors
    // the other could serve.
    expect(router).toMatch(/const merged = new Map<string, RampCountry>\(\)/);
    expect(paycrest).toMatch(/async getPayoutCountries\(\)/);
  });

  it('maps a Paycrest currency to a country only where that is unambiguous', () => {
    // Every Paycrest currency is single-country. A shared one like XOF has no single right
    // answer, and guessing is how a Senegal payout gets built for Cote d'Ivoire.
    expect(paycrest).toMatch(/PAYCREST_CURRENCY_COUNTRY/);
    expect(paycrest).not.toMatch(/XOF: \{ code:/);
    expect(paycrest).not.toMatch(/XAF: \{ code:/);
  });

  it('caches the check, which costs a request per country', () => {
    expect(bitnob).toMatch(/payoutCountriesCache/);
  });

  it('the router falls back to currencies rather than returning nothing', () => {
    // A provider that cannot answer at country level must degrade, not empty the picker.
    expect(router).toMatch(/getPayoutCountries[\s\S]{0,1400}await this\.getCurrencies\(\)/);
  });

  it('the picker reads countries, not currencies', () => {
    expect(picker).toMatch(/import \{ usePayoutCountries \}/);
    // The import, not any mention — the module comment names the old hook to explain why it
    // was replaced, and a blunt match on the word flagged that as a regression.
    expect(picker).not.toMatch(/import \{[^}]*useCurrencies/);
    expect(picker).not.toMatch(/useCurrencies\(/);
  });
});

describe('the chosen country reaches the places that need it', () => {
  it('overrides the first-match scan when resolving a corridor', () => {
    // Without this the thread is decorative: the UI offers Senegal and the payout still goes
    // wherever the provider listed first.
    expect(bitnob).toMatch(/preferCountry\?: string/);
    expect(bitnob).toMatch(/const wanted = preferCountry\?\.toUpperCase\(\)/);
  });

  it('reaches the banks lookup', () => {
    // Banks are per country; two XOF countries do not share a list.
    expect(bitnob).toMatch(/async getInstitutions\([\s\S]{0,200}country_\?: string/);
    expect(hook).toMatch(/getInstitutions\([\s\S]{0,80}payoutCountry/);
  });

  it('reaches the order, and therefore the beneficiary', () => {
    expect(hook).toMatch(/payoutCountry: payoutCountry \?\? undefined/);
    expect(action).toMatch(/payoutCountry: params\.payoutCountry/);
  });

  it('is cleared when the form resets', () => {
    // Left behind, it would silently route the NEXT withdrawal to the previous country.
    expect(hook).toMatch(/setPayoutCountry\(null\)/);
  });
});
