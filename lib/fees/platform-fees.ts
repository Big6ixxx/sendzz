/**
 * Platform fees for bridging and external-wallet transfers.
 *
 * These are collected the same way Bitnob's off-ramp fee is: the fee rides along in the SAME
 * user operation as the main transfer, so it either both happens or neither does — there is no
 * state where the user's money moves and ours doesn't.
 *
 * Rates and addresses come from the environment, with no compiled-in default. A rate we can't
 * determine throws rather than silently defaulting, matching how the ramp fees behave.
 *
 *   BRIDGE_FEE_PERCENT     — explicit, user-initiated bridges
 *   TRANSFER_FEE_PERCENT   — sends to an external wallet address
 *   BITNOB_FEE_TREASURY_<CHAIN> — where the fee is collected, per settlement chain
 *
 * **Which bridges are charged matters.** Only a bridge the user came to perform is billable.
 * Bridging that happens *as a side effect* — consolidating chains to fund a withdrawal, or
 * routing an email/address transfer across networks — is our plumbing, not a service the user
 * asked for, and charging for it would bill them twice for one action. That separation is
 * enforced structurally: `executeSmartBridge` takes the fee as an optional argument, and only
 * the two bridge-page modules pass one. The automatic paths cannot charge because they never
 * supply a fee.
 */

/**
 * Fee-collection addresses per chain — the same treasury as the Bitnob off-ramp fee.
 *
 * Server-only (no NEXT_PUBLIC prefix), so the browser can't read them. The fee is collected in
 * a client-built user operation, so the address is handed over by the `quotePlatformFee`
 * server action — exactly how executeOffRamp embeds the treasury in the order it returns.
 */
const FEE_TREASURY: Record<string, string | undefined> = {
  base: process.env.BITNOB_FEE_TREASURY_BASE,
  arbitrum: process.env.BITNOB_FEE_TREASURY_ARBITRUM,
  avalanche: process.env.BITNOB_FEE_TREASURY_AVALANCHE,
  ethereum: process.env.BITNOB_FEE_TREASURY_ETHEREUM,
  optimism: process.env.BITNOB_FEE_TREASURY_OPTIMISM,
  polygon: process.env.BITNOB_FEE_TREASURY_POLYGON,
  solana: process.env.BITNOB_FEE_TREASURY_SOLANA,
  stellar: process.env.BITNOB_FEE_TREASURY_STELLAR,
};

export type PlatformFeeKind = 'bridge' | 'transfer';

const FEE_ENV_VAR: Record<PlatformFeeKind, string> = {
  bridge: 'BRIDGE_FEE_PERCENT',
  transfer: 'TRANSFER_FEE_PERCENT',
};

/** What actually leaves the wallet, and where the fee portion goes. */
export interface PlatformFeeQuote {
  /** The amount the user asked to move. */
  amount: number;
  /** Our fee, on top of the amount. */
  fee: number;
  /** amount + fee — what's deducted. */
  total: number;
  percent: number;
  /** Where the fee is sent. Null when this chain has no treasury configured. */
  treasury: string | null;
}

function readPercent(kind: PlatformFeeKind, raw: string | undefined): number {
  const percent = Number(raw);
  if (raw == null || raw === '' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error(
      `${FEE_ENV_VAR[kind]} is not configured (got ${JSON.stringify(raw)}). ` +
        `Set it to the ${kind} fee percentage, e.g. ${FEE_ENV_VAR[kind]}=0.5`,
    );
  }
  return percent;
}

/**
 * The fee percentage for a kind of movement. Server-side only — `process.env` is empty in the
 * browser, so the client reads this through the `getPlatformFeePercent` action.
 */
export function getPlatformFeePercent(kind: PlatformFeeKind): number {
  return readPercent(
    kind,
    kind === 'bridge' ? process.env.BRIDGE_FEE_PERCENT : process.env.TRANSFER_FEE_PERCENT,
  );
}

/**
 * The platform fee to charge for a payment, in USDC.
 *
 * A caller-supplied amount always wins: withdrawals price their fee once at order creation
 * from the ramp provider's rate, and re-deriving it per settlement chain is how Stellar came
 * to bill withdrawals at the transfer rate. Everything else falls back to `kind`'s percentage.
 */
export function resolvePlatformFee(
  amount: number,
  kind: PlatformFeeKind,
  suppliedUsdc?: string | number | null,
): number {
  if (suppliedUsdc != null && suppliedUsdc !== '') {
    const supplied = Number(suppliedUsdc);
    if (Number.isFinite(supplied) && supplied >= 0) return supplied;
  }
  return amount * (getPlatformFeePercent(kind) / 100);
}

/** The fee-collection address for a settlement chain, or null when none is configured. */
export function getFeeTreasury(chain: string): string | null {
  return FEE_TREASURY[(chain || '').toLowerCase()] ?? null;
}

/**
 * Split an amount into amount + fee + total for a chain.
 *
 * The fee is ADDED to what the user typed, matching the withdrawal flow: they say how much to
 * move, and we show the larger figure that will actually leave their wallet.
 */
export function quotePlatformFee(params: {
  amount: number;
  percent: number;
  chain: string;
}): PlatformFeeQuote {
  const { amount, percent, chain } = params;
  const fee = amount * (percent / 100);
  return {
    amount,
    fee,
    total: amount + fee,
    percent,
    treasury: getFeeTreasury(chain),
  };
}
