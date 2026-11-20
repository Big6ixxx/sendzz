import { describe, expect, it } from 'vitest';
import { primaryPrivySolanaAccount, privySolanaAddress } from './privy-address';

/**
 * 32 users have two embedded Solana wallets, and Privy lists them in no fixed order. Every one
 * that has moved money is HD index 0, so that is the wallet the app must show every time.
 */
const sol = (address: string, walletIndex: number | null) => ({
  type: 'wallet',
  walletClientType: 'privy',
  chainType: 'solana',
  address,
  walletIndex,
});

describe('primaryPrivySolanaAccount', () => {
  it('picks index 0 whatever order Privy lists them in', () => {
    expect(privySolanaAddress({ linkedAccounts: [sol('SECOND', 1), sol('FIRST', 0)] })).toBe('FIRST');
    expect(privySolanaAddress({ linkedAccounts: [sol('FIRST', 0), sol('SECOND', 1)] })).toBe('FIRST');
  });

  it('ignores EVM, external and non-wallet accounts', () => {
    const accounts = [
      { type: 'email', address: 'a@b.c' },
      { type: 'wallet', walletClientType: 'privy', chainType: 'ethereum', address: '0xabc', walletIndex: 0 },
      { type: 'wallet', walletClientType: 'phantom', chainType: 'solana', address: 'EXTERNAL', walletIndex: 0 },
      sol('MINE', 0),
    ];
    expect(privySolanaAddress({ linkedAccounts: accounts })).toBe('MINE');
  });

  it('prefers an indexed wallet over one with no index', () => {
    expect(privySolanaAddress({ linkedAccounts: [sol('UNKNOWN', null), sol('INDEXED', 1)] })).toBe('INDEXED');
  });

  it('is undefined when there is no Solana wallet', () => {
    expect(privySolanaAddress({ linkedAccounts: [] })).toBeUndefined();
    expect(privySolanaAddress(null)).toBeUndefined();
    expect(primaryPrivySolanaAccount(undefined)).toBeUndefined();
  });
});
