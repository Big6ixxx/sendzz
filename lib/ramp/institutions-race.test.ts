import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Every corridor showed Nigeria's banks.
 *
 * The hook starts on NGN, whose bank list (367 banks) is the slowest call there is. Pick Kenya
 * within a second and Kenya's operators land first — then Nigeria's banks land last and
 * overwrite them. With no guard on the effect, the same race could also overwrite the rate, the
 * fees and the quote with Nigeria's figures while the user was looking at Kenya.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const hook = read('components/deposit-withdraw/useDepositWithdraw.ts');
const bitnob = read('lib/ramp/providers/bitnob.ts');

/** Just the destination effect, so assertions cannot drift into a neighbouring one. */
function destinationEffect(): string {
  const from = hook.indexOf('// Fetch institutions & rates when the destination changes.');
  return hook.slice(from, hook.indexOf('}, [type, fiatCurrency, payoutCountry, userEmail]);', from));
}

describe('only the latest destination may land', () => {
  it('cancels the previous run on cleanup', () => {
    const effect = destinationEffect();
    expect(effect).toMatch(/let cancelled = false;/);
    expect(effect).toMatch(/return \(\) => \{\s*cancelled = true;\s*\};/);
  });

  it('guards the bank list', () => {
    expect(destinationEffect()).toMatch(/if \(cancelled\) return;\s*setOffRampProvider/);
  });

  it('guards the pricing, not just the list', () => {
    // The part that would cost money: a stale rate or fee quoted for the wrong corridor.
    const effect = destinationEffect();
    expect(effect).toMatch(/if \(!cancelled\) setRate\(r\)/);
    expect(effect).toMatch(/if \(!cancelled\) setFeePercent\(v\)/);
    expect(effect).toMatch(/if \(!cancelled\) setCorridorFee\(v\)/);
    expect(effect).toMatch(/if \(!cancelled\) setQuote\(q\)/);
  });

  it('refetches when only the country changes', () => {
    // Ivory Coast -> Senegal is XOF -> XOF; keyed on currency alone, nothing refetched.
    expect(hook).toMatch(/\}, \[type, fiatCurrency, payoutCountry, userEmail\]\);/);
  });
});

describe('a chosen country is only honoured for its own currency', () => {
  it('rejects a country that does not pay out in this currency', () => {
    // Accepting any listed country made getInstitutions("KES", "NG") return Nigeria's banks.
    expect(bitnob).toMatch(/const servesCurrency = \(c: BitnobCountry\) =>/);
    expect(bitnob).toMatch(/if \(wanted && countries\.some\(servesCurrency\)\) return wanted;/);
  });
});

describe('Senegal is excluded everywhere a payout could be routed', () => {
  it('is on the exclusion list', () => {
    expect(bitnob).toMatch(/EXCLUDED_PAYOUT_COUNTRIES = new Set\(\["SN"\]\)/);
  });

  it('is kept out of the picker, the fallback, and the payout corridor', () => {
    // Excluded from the list alone, XOF could still fall back to it when no country is chosen.
    expect(bitnob).toMatch(/EXCLUDED_PAYOUT_COUNTRIES\.has\(c\.code\.toUpperCase\(\)\)\) return \[\]/);
    expect(bitnob).toMatch(/!EXCLUDED_PAYOUT_COUNTRIES\.has\(c\.code\?\.toUpperCase\(\) \?\? ""\) &&/);
    expect(bitnob).toMatch(/if \(EXCLUDED_PAYOUT_COUNTRIES\.has\(c\.code\?\.toUpperCase\(\) \?\? ""\)\) continue;/);
  });
});
