/**
 * Formatting USDC amounts so a fee summary adds up on screen.
 *
 * Two decimals is right for headline amounts but quietly breaks small fees. A 0.01% fee on
 * 0.03 USDC gives "Bridging 0.03 / Fee 0.00 / Total 0.03" — three numbers insisting the
 * transfer fits, printed next to an error saying it doesn't. Nothing there is wrong except the
 * rounding, and the user has no way to tell.
 *
 * The fix isn't per-value: 0.030003 formatted alone is honestly "0.03". It only misleads
 * *beside* 0.03. So precision is chosen for the whole set, at the coarsest level where the
 * values are still distinguishable.
 */

const MAX_DECIMALS = 6; // USDC's own precision

/**
 * The fewest decimals (>= min) at which every value is distinguishable and no non-zero value
 * rounds away. Returns MAX_DECIMALS when even that can't separate them.
 */
export function usdcDecimalsFor(values: number[], min = 2): number {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return min;

  for (let dp = min; dp <= MAX_DECIMALS; dp++) {
    const rendered = finite.map((v) => v.toFixed(dp));
    const anyLostValue = finite.some((v, i) => v !== 0 && Number(rendered[i]) === 0);
    const collapsed = new Set(rendered).size !== new Set(finite).size;
    if (!anyLostValue && !collapsed) return dp;
  }
  return MAX_DECIMALS;
}

/** Format one amount. Use `usdcDecimalsFor` to pick `decimals` when showing a related set. */
export function formatUsdc(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return (0).toFixed(decimals);
  if (value !== 0 && Number(value.toFixed(decimals)) === 0) return '< 0.000001';
  return value.toFixed(decimals);
}

/**
 * Format an amount / fee / total triple at one shared precision, so the arithmetic is legible.
 */
export function formatFeeSummary(amount: number, fee: number, total: number) {
  const dp = usdcDecimalsFor([amount, fee, total]);
  return {
    amount: formatUsdc(amount, dp),
    fee: formatUsdc(fee, dp),
    total: formatUsdc(total, dp),
  };
}
