import { describe, expect, it } from 'vitest';
import { refundDestination } from './refund';

/**
 * Sending a refund to the wrong chain is a second, irreversible loss on top of the first.
 * The deposit came from one wallet on one chain; that is the only place it can go back to.
 */
const wallets = {
  smart_account_address: '0xEVM',
  solana_address: 'SOL111',
  stellar_address: 'GSTELLAR',
};

describe('refundDestination', () => {
  it('returns the wallet the deposit came from', () => {
    expect(refundDestination('stellar', wallets)).toBe('GSTELLAR');
    expect(refundDestination('solana', wallets)).toBe('SOL111');
  });

  it('sends every EVM chain to the smart account', () => {
    for (const chain of ['base', 'polygon', 'ethereum', 'arbitrum', 'optimism', 'avalanche']) {
      expect(refundDestination(chain, wallets), chain).toBe('0xEVM');
    }
  });

  it('is case-insensitive, since chain names arrive from several sources', () => {
    expect(refundDestination('Stellar', wallets)).toBe('GSTELLAR');
    expect(refundDestination('SOLANA', wallets)).toBe('SOL111');
  });

  it('returns null when we hold no wallet for that chain', () => {
    // An operator must ask the user rather than be shown a blank or a wrong address.
    expect(refundDestination('stellar', { smart_account_address: '0xEVM' })).toBeNull();
    expect(refundDestination('solana', { stellar_address: 'GSTELLAR' })).toBeNull();
  });

  it('never falls back to a different chain’s wallet', () => {
    // The dangerous failure: a Stellar refund resolving to the EVM address.
    expect(refundDestination('stellar', { smart_account_address: '0xEVM' })).not.toBe('0xEVM');
  });

  it('handles a missing chain or missing profile without throwing', () => {
    expect(refundDestination(null, wallets)).toBe('0xEVM');
    expect(refundDestination('stellar', null)).toBeNull();
    expect(refundDestination('stellar', undefined)).toBeNull();
  });
});
