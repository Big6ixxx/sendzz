/**
 * The server half of lib/solana/fee-payer-balance: read the balance, alert, decide.
 */
import 'server-only';

import { Connection, PublicKey } from '@solana/web3.js';
import { IS_TESTNET } from '@/lib/network';
import { claimAlertSlot } from '@/lib/ops/alert-cooldown';
import {
  alertThresholdLamports,
  feePayerVerdict,
  lamportsNeeded,
  type FeePayerVerdict,
} from './fee-payer-balance';

const ALERT_LOW = { key: 'solana-feepayer-low', cooldownMs: 12 * 60 * 60 * 1000 };
const ALERT_EMPTY = { key: 'solana-feepayer-empty', cooldownMs: 60 * 60 * 1000 };

/**
 * Check the fee payer can cover one sponsored transaction that opens `newAccounts` token
 * accounts. Returns 'insufficient' when it cannot — the caller refuses — and alerts the admins
 * on 'low' and 'insufficient' (rate-limited, a standing condition).
 *
 * An unreadable balance is treated as fine: the transaction's own preflight will still refuse
 * if the money is really not there, and an RPC hiccup should not take sponsorship down.
 */
export async function preflightFeePayer(
  connection: Connection,
  feePayer: PublicKey,
  newAccounts = 0,
): Promise<FeePayerVerdict> {
  let balance: number;
  try {
    balance = await connection.getBalance(feePayer, 'confirmed');
  } catch (err) {
    console.warn('[SolanaFeePayer] balance unreadable; continuing:', (err as Error).message);
    return 'ok';
  }

  const threshold = alertThresholdLamports(process.env.SOLANA_FEEPAYER_ALERT_SOL);
  const verdict = feePayerVerdict(balance, lamportsNeeded(newAccounts), threshold);

  if (verdict !== 'ok') {
    const blocking = verdict === 'insufficient';
    console.error(
      `[SolanaFeePayer] ${blocking ? 'CANNOT PAY' : 'LOW'}: ${feePayer.toBase58()} holds ` +
        `${(balance / 1e9).toFixed(4)} SOL (alert below ${(threshold / 1e9).toFixed(2)} SOL).`,
    );
    const slot = blocking ? ALERT_EMPTY : ALERT_LOW;
    void (async () => {
      if (!(await claimAlertSlot(slot.key, slot.cooldownMs))) return;
      const { sendSolanaFeePayerAlert } = await import('@/lib/email/admin-alerts');
      await sendSolanaFeePayerAlert({
        address: feePayer.toBase58(),
        balanceSol: balance / 1e9,
        thresholdSol: threshold / 1e9,
        network: IS_TESTNET ? 'devnet' : 'mainnet',
        blocking,
      });
    })().catch((err) => console.error('[SolanaFeePayer] alert failed:', err));
  }
  return verdict;
}
