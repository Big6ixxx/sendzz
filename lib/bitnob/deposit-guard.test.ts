import { describe, expect, it } from 'vitest';
import { BitnobClient, hasSharedDepositAddress, type BitnobLedgerTx } from './client';

/**
 * Guards `findSettledDeposit`, the check that stops a payout going out before its deposit
 * arrives. Fixtures are real rows from `GET /api/transactions`, so the shapes are the ones the
 * live API returns — an assumed field name is what let payouts race ahead of deposits before.
 */

const DEPOSIT_ADDRESS = 'GDZDVVL45WOOQKCZAPKGSZUHXFSN64WDRPYQYZCKACW5FK4SMT2WPIHW';
const TX_HASH = '1402eec2e72e802d0bc0d1d463b1b5270af645f6dd45a211c16d40ae345c687c';

const settledDeposit: BitnobLedgerTx = {
  currency: 'USDC',
  type: 'DEPOSIT_CONFIRMED',
  state: 'SETTLED',
  amount: '1050000', // 1.05 USDC in minor units
  reference: 'RCV_USDC_dfa90399b7b9',
  metadata: { address: DEPOSIT_ADDRESS, chain: 'stellar', tx_hash: TX_HASH },
};

const payoutRow: BitnobLedgerTx = {
  currency: 'USDC',
  type: 'PAYOUT',
  state: 'SETTLED',
  amount: '-1050000',
  reference: 'offramp_1786973675470',
  metadata: { channel: 'offchain', quote_id: 'QT2_21784851' },
};

/** A client whose ledger is a fixture rather than the network. */
function clientWith(rows: BitnobLedgerTx[]): BitnobClient {
  const client = new BitnobClient();
  client.listTransactions = async () => rows;
  return client;
}

describe('findSettledDeposit', () => {
  it('matches a settled deposit by its receive address', async () => {
    const found = await clientWith([payoutRow, settledDeposit]).findSettledDeposit({
      address: DEPOSIT_ADDRESS,
    });
    expect(found?.reference).toBe('RCV_USDC_dfa90399b7b9');
    expect(found?.amountUsdc).toBeCloseTo(1.05);
  });

  it('matches by on-chain tx hash when the address is unknown', async () => {
    const found = await clientWith([settledDeposit]).findSettledDeposit({ txHash: TX_HASH });
    expect(found?.reference).toBe('RCV_USDC_dfa90399b7b9');
  });

  it('is case-insensitive (EVM addresses arrive checksummed, Stellar upper-case)', async () => {
    const found = await clientWith([settledDeposit]).findSettledDeposit({
      address: DEPOSIT_ADDRESS.toLowerCase(),
    });
    expect(found).not.toBeNull();
  });

  it('holds the payout while the deposit is only detected, not settled', async () => {
    const pending = { ...settledDeposit, state: 'PENDING' };
    const found = await clientWith([pending]).findSettledDeposit({ address: DEPOSIT_ADDRESS });
    expect(found).toBeNull();
  });

  it('does not fall back to the shared address when a tx hash is supplied', async () => {
    // Stellar hands every payout the same static company address, so an address match must
    // not rescue a hash that does not match — that would settle one user's payout against
    // another's deposit.
    const otherDeposit = {
      ...settledDeposit,
      reference: 'RCV_USDC_someoneelse',
      metadata: { ...settledDeposit.metadata, tx_hash: 'deadbeef' },
    };
    const found = await clientWith([otherDeposit]).findSettledDeposit({
      address: DEPOSIT_ADDRESS,
      txHash: TX_HASH,
    });
    expect(found).toBeNull();
  });

  it('never matches a payout row against itself', async () => {
    const found = await clientWith([payoutRow]).findSettledDeposit({
      address: DEPOSIT_ADDRESS,
      txHash: TX_HASH,
    });
    expect(found).toBeNull();
  });

  it('ignores a deposit to some other order', async () => {
    const found = await clientWith([settledDeposit]).findSettledDeposit({
      address: 'GB000000000000000000000000000000000000000000000000000000',
    });
    expect(found).toBeNull();
  });

  it('rejects a deposit smaller than the payout will debit', async () => {
    // Deposit is 1.05; the payout needs base + corridor fee = 1.35.
    const found = await clientWith([settledDeposit]).findSettledDeposit({
      address: DEPOSIT_ADDRESS,
      minAmountUsdc: 1.35,
    });
    expect(found).toBeNull();
  });

  it('accepts a deposit that exactly covers the payout', async () => {
    const found = await clientWith([settledDeposit]).findSettledDeposit({
      address: DEPOSIT_ADDRESS,
      minAmountUsdc: 1.05,
    });
    expect(found).not.toBeNull();
  });

  it('refuses a deposit that arrived on a different chain than the withdrawal settles on', async () => {
    const found = await clientWith([settledDeposit]).findSettledDeposit({
      txHash: TX_HASH,
      chain: 'base',
    });
    expect(found).toBeNull();
  });

  it('accepts the deposit when the chain matches, and reports what it matched', async () => {
    const found = await clientWith([settledDeposit]).findSettledDeposit({
      txHash: TX_HASH,
      chain: 'Stellar',
    });
    expect(found?.chain).toBe('stellar');
    expect(found?.txHash).toBe(TX_HASH);
  });

  it('refuses to guess when given nothing to match on', async () => {
    const found = await clientWith([settledDeposit]).findSettledDeposit({});
    expect(found).toBeNull();
  });
});

/**
 * Which chains hand back one company-wide deposit address. Getting this wrong is not cosmetic:
 * on a shared address, verifying a payout by address alone can settle it against a different
 * user's deposit, and treating a unique address as shared holds good payouts hostage to a hash.
 */
describe('hasSharedDepositAddress', () => {
  it('flags Stellar, whose deposit address is one static company account', () => {
    expect(hasSharedDepositAddress('stellar')).toBe(true);
    expect(hasSharedDepositAddress('Stellar')).toBe(true);
  });

  it('does not flag chains that mint an address per payout', () => {
    for (const chain of ['base', 'polygon', 'ethereum', 'arbitrum', 'optimism', 'solana']) {
      expect(hasSharedDepositAddress(chain)).toBe(false);
    }
  });

  it('treats a missing network as unshared rather than throwing', () => {
    expect(hasSharedDepositAddress(undefined)).toBe(false);
    expect(hasSharedDepositAddress(null)).toBe(false);
    expect(hasSharedDepositAddress('')).toBe(false);
  });
});
