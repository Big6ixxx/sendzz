'use server';

import { requireUser } from '@/lib/auth/session';
import {
  getFeeTreasury,
  getPlatformFeePercent,
  quotePlatformFee,
  type PlatformFeeKind,
  type PlatformFeeQuote,
} from '@/lib/fees/platform-fees';

/**
 * The fee for a bridge or external-wallet transfer, resolved server-side.
 *
 * The rate and the treasury address both live in server-only env, but the user operation that
 * collects the fee is built in the browser — so this is the handoff, mirroring how
 * executeOffRamp embeds the treasury in the order it returns.
 *
 * Requires a signed-in caller: it's not secret, but there's no reason to let anyone enumerate
 * our fee configuration.
 */
export async function quoteFee(
  kind: PlatformFeeKind,
  chain: string,
  amount: number,
  accessToken?: string,
): Promise<PlatformFeeQuote> {
  await requireUser(accessToken);
  const percent = getPlatformFeePercent(kind);
  return quotePlatformFee({ amount, percent, chain });
}

/** Just the rate — for showing a fee line before an amount has been entered. */
export async function feePercentFor(
  kind: PlatformFeeKind,
  accessToken?: string,
): Promise<number> {
  await requireUser(accessToken);
  return getPlatformFeePercent(kind);
}

/** Whether a chain can collect fees at all — used to fail closed before starting a transfer. */
export async function hasFeeTreasury(chain: string, accessToken?: string): Promise<boolean> {
  await requireUser(accessToken);
  return getFeeTreasury(chain) !== null;
}
