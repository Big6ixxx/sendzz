import { describe, it, expect } from 'vitest';
import { describeWithdrawal, describeCryptoSend } from './describe';
import { signatureCount, confirmationNotice, durationEstimate } from './plan';

/**
 * Gathering a split balance is OUR plumbing, not the user's business.
 *
 * It used to be listed as one step per source, each naming the two networks it moved between —
 * written when the user felt every leg as a separate confirmation. They no longer sign per leg,
 * so the network names became something a person withdrawing to their bank has to read and
 * cannot use. What the step must still do is tell the truth about confirmations and time.
 */

const withdrawal = (gatherFrom: string[]) =>
  describeWithdrawal({
    amountLabel: '50,000 NGN',
    bankLabel: 'GTBank · 0123456789',
    settlementChain: 'base',
    gatherFrom,
  });

describe('the gather step names no networks', () => {
  it('collapses several sources into one line', () => {
    const plan = withdrawal(['arbitrum', 'polygon', 'stellar']);
    const gather = plan.steps.filter((s) => s.kind === 'gather');
    expect(gather).toHaveLength(1);
    expect(gather[0].title).toBe('Bring your balance together');
  });

  it('mentions no chain anywhere in the gather step', () => {
    const plan = withdrawal(['arbitrum', 'polygon', 'stellar']);
    const gather = plan.steps.find((s) => s.kind === 'gather')!;
    const text = `${gather.title} ${gather.detail ?? ''}`;
    for (const chain of ['Arbitrum', 'Polygon', 'Stellar', 'Base', 'Optimism', 'Avalanche', 'Arc']) {
      expect(text).not.toContain(chain);
    }
  });

  it('is absent entirely when the balance is already in one place', () => {
    expect(withdrawal([]).steps.some((s) => s.kind === 'gather')).toBe(false);
  });
});

describe('one line still promises the right number of confirmations', () => {
  it('counts every source, not every step', () => {
    // The trap in collapsing: one step would have promised one confirmation for three.
    const plan = withdrawal(['arbitrum', 'polygon', 'stellar']);
    expect(signatureCount(plan)).toBe(4); // three gathers + the settle
    expect(confirmationNotice(plan)).toContain('4 times');
  });

  it('says nothing when there is only one confirmation to give', () => {
    expect(confirmationNotice(withdrawal([]))).toBeNull();
  });

  it('still grows the estimate with each source', () => {
    // A balance spread over three networks genuinely takes longer to bring together, and an
    // estimate that ignored that would read as "stuck" rather than "slow". Asserted on the raw
    // seconds, because durationEstimate buckets coarsely and both can land in one phrase.
    const seconds = (sources: string[]) =>
      withdrawal(sources)
        .steps.filter((s) => s.kind === 'gather')
        .reduce((t, s) => t + (s.estimateSeconds ?? 0), 0);

    expect(seconds(['arbitrum'])).toBe(60);
    expect(seconds(['arbitrum', 'polygon', 'stellar'])).toBe(180);
    expect(durationEstimate(withdrawal([]))).toBeTruthy();
  });
});

describe('transfers get the same treatment', () => {
  it('uses the same chain-free gather line', () => {
    const plan = describeCryptoSend({
      amount: '25',
      recipient: '0x1234567890abcdef1234567890abcdef12345678',
      destChain: 'polygon',
      sourceChain: 'base',
      gatherFrom: ['arbitrum', 'stellar'],
    });
    const gather = plan.steps.filter((s) => s.kind === 'gather');
    expect(gather).toHaveLength(1);
    expect(gather[0].title).toBe('Bring your balance together');
  });
});
