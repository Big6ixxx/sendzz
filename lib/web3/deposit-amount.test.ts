import { describe, it, expect } from 'vitest';
import { transferAmountUsdc, type AlchemyTransfer } from './deposit-amount';

/**
 * Regression cover for the Arc precompile decimals bug.
 *
 * Alchemy scales `value` only when it can look the token's decimals up. On Arc it cannot —
 * USDC there is a precompile, not a deployed ERC-20 — so `asset` and `rawContract.decimal`
 * come back null and `value` carries the raw integer. Reading `value` straight through wrote
 * a 10^6 error into the ledger and the deposit email.
 *
 * The values below are real responses captured from `alchemy_getAssetTransfers`.
 */
const transfer = (over: Partial<AlchemyTransfer>): AlchemyTransfer => ({
  hash: '0xabc',
  value: null,
  from: '0x1111111111111111111111111111111111111111',
  blockNum: '0x1',
  ...over,
});

describe('transferAmountUsdc', () => {
  it('scales the raw integer when Alchemy has no token metadata (Arc)', () => {
    const t = transfer({
      value: 938136.0,
      rawContract: { value: '0xe5098', decimal: null },
    });
    expect(transferAmountUsdc(t)).toBeCloseTo(0.938136, 9);
  });

  it('does not read Alchemy\'s unscaled `value` as the amount', () => {
    const t = transfer({
      value: 938136.0,
      rawContract: { value: '0xe5098', decimal: null },
    });
    expect(transferAmountUsdc(t)).not.toBe(938136.0);
  });

  it('agrees with Alchemy on a chain that does report decimals (Base)', () => {
    // 22286.370698 USDC = 22286370698 base units = 0x5305f078a
    const t = transfer({
      value: 22286.370698,
      rawContract: { value: '0x5305f078a', decimal: '0x6' },
    });
    expect(transferAmountUsdc(t)).toBeCloseTo(22286.370698, 6);
  });

  it('handles a small Polygon amount', () => {
    // 0.01 USDC = 10000 base units = 0x2710
    const t = transfer({
      value: 0.01,
      rawContract: { value: '0x2710', decimal: '0x6' },
    });
    expect(transferAmountUsdc(t)).toBeCloseTo(0.01, 9);
  });

  it('falls back to the decoded value when there is no raw amount', () => {
    const t = transfer({ value: 5.5, rawContract: { decimal: '0x6' } });
    expect(transferAmountUsdc(t)).toBe(5.5);
  });

  it('refuses rather than guessing when neither is usable', () => {
    // Crediting an amount we cannot establish is worse than recording nothing.
    expect(transferAmountUsdc(transfer({ value: 938136.0 }))).toBeNull();
    expect(transferAmountUsdc(transfer({ value: null }))).toBeNull();
    expect(transferAmountUsdc(transfer({ value: 1, rawContract: {} }))).toBeNull();
  });

  it('survives an unparseable raw value', () => {
    const t = transfer({ value: 3, rawContract: { value: 'not-hex', decimal: '0x6' } });
    expect(transferAmountUsdc(t)).toBe(3);
  });

  it('reads zero as zero, not as null', () => {
    // The caller skips non-positive amounts; it must not confuse them with "unknown".
    expect(transferAmountUsdc(transfer({ rawContract: { value: '0x0' } }))).toBe(0);
  });

  /**
   * On Arc, USDC is the gas token, so an ordinary send is a NATIVE transfer denominated in
   * 18 decimals — the same asset the precompile reports at 6. Assuming 6 turned a real 0.5 USDC
   * deposit into 500,000,000,000.
   */
  it('honours 18 decimals on a native Arc transfer', () => {
    const t = transfer({
      category: 'external',
      value: 0.5,
      rawContract: { value: '0x6f05b59d3b20000', decimal: '0x12' },
    });
    expect(transferAmountUsdc(t)).toBeCloseTo(0.5, 9);
    expect(transferAmountUsdc(t)).not.toBe(500_000_000_000);
  });

  it('still reads the 6-decimal precompile correctly in the same scan', () => {
    // Both shapes arrive together on Arc: native sends and CCTP mints.
    const mint = transfer({
      category: 'erc20',
      value: 2_000_000,
      rawContract: { value: '0x1e8480', decimal: null },
    });
    expect(transferAmountUsdc(mint)).toBeCloseTo(2, 9);
  });

  it('ignores a nonsensical decimal rather than trusting it', () => {
    const t = transfer({ value: 1, rawContract: { value: '0xf4240', decimal: '0xff' } });
    expect(transferAmountUsdc(t)).toBeCloseTo(1, 9);
  });
});
