/**
 * Reading a wallet's Solana USDC balance without mistaking "couldn't read" for "empty".
 *
 * `getTokenAccountBalance` throws both when the token account does not exist (a wallet that has
 * never held USDC — genuinely zero) and when the RPC is down, rate-limited or slow. Treating
 * every throw as zero is how a funded Solana balance silently vanished from the portfolio
 * whenever the public endpoint had a bad moment. So the account is looked up directly: absent
 * means zero, and anything else that goes wrong is reported as unreadable (null), the same way
 * the EVM path in /api/balances/cross-chain omits a chain it could not read.
 */
import { PublicKey, type AccountInfo, type ParsedAccountData } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

/** The one RPC method used. `Connection` satisfies it; tests pass a fake. */
export interface SolanaBalanceRpc {
  getParsedAccountInfo(
    address: PublicKey,
  ): Promise<{ value: AccountInfo<Buffer | ParsedAccountData> | null }>;
}

/** `raw / 10^decimals` as a decimal string, exactly — no float division. */
export function formatRawUnits(raw: bigint, decimals: number): string {
  const neg = raw < 0n;
  const digits = (neg ? -raw : raw).toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const frac = digits.slice(digits.length - decimals).replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/**
 * The owner's USDC balance in their associated token account, as a decimal string.
 *
 * "0" when the account does not exist; null when it could not be read — the caller should omit
 * Solana rather than show zero. Throws nothing.
 */
export async function readSolanaUsdcBalance(
  rpc: SolanaBalanceRpc,
  owner: PublicKey,
  usdcMint: PublicKey,
): Promise<string | null> {
  try {
    const ata = getAssociatedTokenAddressSync(usdcMint, owner, true);
    const { value } = await rpc.getParsedAccountInfo(ata);
    if (value === null) return '0'; // never held USDC
    const data = value.data;
    if (Buffer.isBuffer(data) || data.parsed?.type !== 'account') return null; // not a token account
    const amount = data.parsed.info?.tokenAmount as { amount?: string; decimals?: number } | undefined;
    if (!amount?.amount) return null;
    return formatRawUnits(BigInt(amount.amount), amount.decimals ?? 6);
  } catch (e) {
    console.error('[Balances] solana read failed:', e instanceof Error ? e.message : e);
    return null;
  }
}
