import { describe, it, expect } from 'vitest';
import {
  planTransferRoute,
  planBatchRoute,
  planWithdrawalRoute,
  planExternalSend,
} from './routing';

describe('planTransferRoute', () => {
  it('uses a single chain when one covers the full amount', () => {
    const plan = planTransferRoute('50', { base: 90, polygon: 40 });
    expect(plan.feasible).toBe(true);
    expect(plan.multiSource).toBe(false);
    expect(plan.legs).toEqual([{ chain: 'base', amount: '50' }]);
  });

  it('prefers the home chain even if another holds more', () => {
    const plan = planTransferRoute('30', { polygon: 100, base: 50 });
    expect(plan.legs[0].chain).toBe('base');
  });

  it('respects a non-default home chain', () => {
    const plan = planTransferRoute('30', { base: 50, polygon: 100 }, { homeChain: 'polygon' });
    expect(plan.legs[0].chain).toBe('polygon');
  });

  it('multi-sources when no single chain covers the amount', () => {
    const plan = planTransferRoute('90', { base: 60, polygon: 40 });
    expect(plan.feasible).toBe(true);
    expect(plan.multiSource).toBe(true);
    expect(plan.legs).toEqual([
      { chain: 'base', amount: '60' },
      { chain: 'polygon', amount: '30' },
    ]);
  });

  it('legs sum exactly to the requested amount (no float dust)', () => {
    const plan = planTransferRoute('0.3', { base: 0.1, polygon: 0.1, arbitrum: 0.1 });
    const sum = plan.legs.reduce((s, l) => s + parseFloat(l.amount), 0);
    expect(plan.feasible).toBe(true);
    expect(sum).toBeCloseTo(0.3, 9);
  });

  it('is infeasible when total balance is insufficient', () => {
    const plan = planTransferRoute('200', { base: 60, polygon: 40 });
    expect(plan.feasible).toBe(false);
    expect(plan.legs).toEqual([]);
  });

  it('is infeasible for zero / negative amounts', () => {
    expect(planTransferRoute('0', { base: 60 }).feasible).toBe(false);
  });
});

describe('planBatchRoute', () => {
  it('pays the whole batch on one chain when it has capacity', () => {
    const plan = planBatchRoute('10', 5, { base: 100, polygon: 5 });
    expect(plan.feasible).toBe(true);
    expect(plan.groups).toEqual([{ chain: 'base', count: 5 }]);
  });

  it('splits recipients across chains by whole-recipient capacity', () => {
    // base pays 6 (60/10), polygon pays the remaining 4
    const plan = planBatchRoute('10', 10, { base: 65, polygon: 50 });
    expect(plan.feasible).toBe(true);
    expect(plan.groups).toEqual([
      { chain: 'base', count: 6 },
      { chain: 'polygon', count: 4 },
    ]);
  });

  it('flags consolidation when funds are fragmented below one recipient each', () => {
    // total 12 >= 2*10? no. Use amounts where total covers but no chain fits one.
    const plan = planBatchRoute('10', 2, { base: 9, polygon: 9, arbitrum: 4 });
    expect(plan.feasible).toBe(false);
    expect(plan.needsConsolidation).toBe(true);
  });

  it('is infeasible when total is insufficient', () => {
    const plan = planBatchRoute('10', 5, { base: 20 });
    expect(plan.feasible).toBe(false);
    expect(plan.needsConsolidation).toBe(false);
  });
});

describe('planWithdrawalRoute', () => {
  it('picks a single ramp-supported chain that covers the amount', () => {
    const plan = planWithdrawalRoute('50', { base: 90, polygon: 10 });
    expect(plan.feasible).toBe(true);
    expect(plan.chain).toBe('base');
  });

  it('prefers home chain, then cheaper supported rails', () => {
    const plan = planWithdrawalRoute('50', { ethereum: 100, polygon: 80 });
    expect(plan.chain).toBe('polygon'); // base empty → polygon before ethereum
  });

  it('ignores non-ramp chains when choosing a source', () => {
    // arbitrum holds plenty but Paycrest cannot settle there → consolidation
    const plan = planWithdrawalRoute('50', { arbitrum: 100, base: 10 });
    expect(plan.feasible).toBe(false);
    expect(plan.needsConsolidation).toBe(true);
  });

  it('flags consolidation when supported funds are split below the amount', () => {
    const plan = planWithdrawalRoute('50', { base: 30, polygon: 30 });
    expect(plan.feasible).toBe(false);
    expect(plan.needsConsolidation).toBe(true);
  });

  it('is infeasible (no consolidation) when total balance is too low', () => {
    const plan = planWithdrawalRoute('50', { base: 10, polygon: 10, arbitrum: 5 });
    expect(plan.feasible).toBe(false);
    expect(plan.needsConsolidation).toBe(false);
  });
});

describe('planExternalSend', () => {
  it('sends directly when the destination chain holds enough', () => {
    const plan = planExternalSend('50', 'arbitrum', { arbitrum: 80, base: 10 });
    expect(plan.mode).toBe('direct');
    expect(plan.destChain).toBe('arbitrum');
  });

  it('bridges from another chain when the destination is underfunded', () => {
    // funds on Base, sending to an Arbitrum address
    const plan = planExternalSend('50', 'arbitrum', { base: 90, arbitrum: 0 });
    expect(plan.mode).toBe('bridge');
    expect(plan.sourceChain).toBe('base');
    expect(plan.destChain).toBe('arbitrum');
  });

  it('prefers the cheapest source chain when bridging', () => {
    const plan = planExternalSend('50', 'arbitrum', { ethereum: 100, polygon: 80 });
    expect(plan.mode).toBe('bridge');
    expect(plan.sourceChain).toBe('polygon'); // polygon before ethereum
  });

  it('flags consolidation when funds are fragmented across chains', () => {
    const plan = planExternalSend('50', 'arbitrum', { base: 30, polygon: 30 });
    expect(plan.mode).toBe('infeasible');
    expect(plan.needsConsolidation).toBe(true);
  });

  it('is infeasible (no consolidation) when total is too low', () => {
    const plan = planExternalSend('50', 'arbitrum', { base: 20, polygon: 10 });
    expect(plan.mode).toBe('infeasible');
    expect(plan.needsConsolidation).toBe(false);
  });
});

describe('source overrides', () => {
  it('transfer: single source forces the chosen chain when it has enough', () => {
    const plan = planTransferRoute('50', { base: 90, polygon: 80 }, {
      source: { mode: 'single', chain: 'polygon' },
    });
    expect(plan.feasible).toBe(true);
    expect(plan.legs).toEqual([{ chain: 'polygon', amount: '50' }]);
  });

  it('transfer: single source is infeasible if the chosen chain lacks funds', () => {
    const plan = planTransferRoute('50', { base: 90, polygon: 10 }, {
      source: { mode: 'single', chain: 'polygon' },
    });
    expect(plan.feasible).toBe(false);
  });

  it('withdraw: single source forces a supported chain that holds enough', () => {
    const plan = planWithdrawalRoute('50', { base: 90, polygon: 80 }, {
      source: { mode: 'single', chain: 'polygon' },
    });
    expect(plan.feasible).toBe(true);
    expect(plan.chain).toBe('polygon');
  });

  it('withdraw: single source rejects a non-ramp chain even with funds', () => {
    const plan = planWithdrawalRoute('50', { arbitrum: 200 }, {
      source: { mode: 'single', chain: 'arbitrum' },
    });
    expect(plan.feasible).toBe(false);
  });

  it('withdraw: consolidate override returns the chosen source chains', () => {
    const plan = planWithdrawalRoute('50', { base: 30, polygon: 40 }, {
      source: { mode: 'consolidate', from: ['polygon', 'solana'] },
    });
    expect(plan.feasible).toBe(false);
    expect(plan.needsConsolidation).toBe(true);
    expect(plan.consolidateFrom).toEqual(['polygon', 'solana']);
    expect(plan.chain).toBe('base'); // settles on the home/supported chain
  });
});
