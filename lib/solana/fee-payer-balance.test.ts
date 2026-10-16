import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALERT_THRESHOLD_LAMPORTS,
  TOKEN_ACCOUNT_RENT_LAMPORTS,
  alertThresholdLamports,
  feePayerVerdict,
  lamportsNeeded,
} from './fee-payer-balance';

describe('fee payer preflight', () => {
  it('needs rent on top of the fee for each account opened', () => {
    expect(lamportsNeeded(2) - lamportsNeeded(0)).toBe(2 * TOKEN_ACCOUNT_RENT_LAMPORTS);
  });

  it('refuses when it cannot pay, warns when low, passes otherwise', () => {
    const t = 500_000_000;
    expect(feePayerVerdict(lamportsNeeded(1) - 1, lamportsNeeded(1), t)).toBe('insufficient');
    expect(feePayerVerdict(t - 1, lamportsNeeded(1), t)).toBe('low');
    expect(feePayerVerdict(t, lamportsNeeded(1), t)).toBe('ok');
  });

  it('reads the alert threshold in SOL, falling back on junk', () => {
    expect(alertThresholdLamports('2')).toBe(2_000_000_000);
    expect(alertThresholdLamports('nope')).toBe(DEFAULT_ALERT_THRESHOLD_LAMPORTS);
    expect(alertThresholdLamports(undefined)).toBe(DEFAULT_ALERT_THRESHOLD_LAMPORTS);
  });
});
