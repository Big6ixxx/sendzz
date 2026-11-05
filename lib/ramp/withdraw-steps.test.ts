import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Two questions, in order: who is being paid, then how much.
 *
 * Destination and recipient are one question, so they share a screen — and the bank list waits
 * for the destination, because it is per country and loading it first meant fetching Nigeria
 * by default for someone who had chosen nothing.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const form = read('components/deposit-withdraw/WithdrawForm.tsx');
const hook = read('components/deposit-withdraw/useDepositWithdraw.ts');

describe('the transfer form has two steps', () => {
  it('declares exactly recipient then amount', () => {
    expect(form).toMatch(/type Phase = "recipient" \| "amount";/);
    expect(form).toMatch(/const PHASE_LABELS = \["Who you're paying", "How much"\];/);
  });

  it('shows the bank selector only once a destination is chosen', () => {
    expect(form).toMatch(/\{hook\.payoutCountry && \(\s*<BankSelector/);
  });

  it('cannot leave step one without a verified account', () => {
    expect(form).toMatch(/!hook\.payoutCountry \|\| !hook\.bankDetails\.accountName \|\| hook\.verifyingBank/);
  });

  it('asks for the quote from the amount step, the last question', () => {
    const amount = form.slice(form.indexOf('<FlowSteps steps={PHASE_LABELS} current={1} />'));
    expect(amount).toMatch(/onClick=\{hook\.handleWithdrawQuote\}/);
  });
});

describe('nothing country-specific is fetched before a destination exists', () => {
  it('gates the bank list and rate on a chosen country, for withdrawals only', () => {
    expect(hook).toMatch(/const awaitingDestination = type === "withdraw" && !payoutCountry;/);
    expect(hook).toMatch(/if \(awaitingDestination\) \{\s*setInstitutions\(\[\]\);\s*setInstitutionsLoading\(false\);\s*\} else \{\s*init\(\);/);
    expect(hook).toMatch(/if \(awaitingDestination\) \{\s*setRateLoading\(false\);/);
  });
});

describe('the amount step', () => {
  it('cannot ask for a quote below 1 USDC, zero included', () => {
    expect(form).toMatch(/if \(usdcBase < 1\) return "Minimum transfer is 1 USDC equivalent\.";/);
    const amount = form.slice(form.indexOf('<FlowSteps steps={PHASE_LABELS} current={1} />'));
    // FlowButton disables itself while `loading`, so loading, a missing rate and a sub-1 amount all block it.
    expect(amount).toMatch(/loading=\{hook\.loading\}\s*disabled=\{hook\.rateLoading \|\| usdcBase < 1 \|\|/);
  });
});

describe('every earlier step can be gone back to', () => {
  it('the recipient step goes back to the country list', () => {
    // Both the country card's "Change" and the step's back arrow return to the list.
    expect(form).toMatch(/onClick=\{clearDestination\}[\s\S]*?>\s*Change\s*</);
    expect(form).toMatch(/\{hook\.payoutCountry && backButton\(clearDestination\)\}/);
  });

  it('offers only contacts whose bank pays out in the chosen country', () => {
    expect(form).toMatch(/contacts=\{hook\.countryContacts\}/);
  });
});

describe('the summary', () => {
  it('reads the destination back instead of offering a fixed currency list', () => {
    expect(form).not.toMatch(/Select Destination Country/);
    expect(form).not.toMatch(/\{ code: "BRL", flag:/);
  });
});
