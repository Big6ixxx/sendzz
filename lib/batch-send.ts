import { sendTransferEmail } from '@/lib/email/sendEmail';
import { getUserAddressByEmail } from '@/lib/supabase/users';
import { recordTransfer } from '@/lib/supabase/transactions';
import { executeCircleGaslessBatchTransfer } from '@/lib/web3/circle-actions';
import { consolidateFundsToChain } from '@/lib/web3/bridge-actions';
import { planBatchRoute, type ChainBalances, type SolanaSource } from '@/lib/web3/routing';
import { EIP1193Provider, type ConnectedWallet } from '@privy-io/react-auth';

export interface SendResult {
  email: string;
  status: 'success' | 'failed' | 'claim_required';
  txHash?: string;
  error?: string;
}

/**
 * Sends USDC to multiple recipients in a SINGLE atomic batch.
 * This requires only ONE Privy signature.
 */
export async function batchSend({
  recipients,
  amount,
  senderEmail,
  note,
  provider,
  chainBalances,
  wallet,
  smartAddress,
  solanaSource,
  onStatus,
  onProgress,
}: {
  recipients: string[];
  amount: string;
  senderEmail: string;
  note?: string;
  provider: EIP1193Provider;
  /** Per-chain EVM balances; the batch is routed across chains accordingly. */
  chainBalances?: ChainBalances;
  /** Connected wallet + smart address — required to auto-consolidate fragmented funds. */
  wallet?: ConnectedWallet;
  smartAddress?: string;
  /** Solana source, pulled in (via Base) when EVM funds are short. */
  solanaSource?: SolanaSource;
  onStatus?: (status: string) => void;
  onProgress?: (done: number, total: number, result: SendResult) => void;
}): Promise<SendResult[]> {
  const results: SendResult[] = [];
  const total = recipients.length;

  try {
    // 1. Pre-resolve all identities and JIT wallets
    const transferParams: {
      recipientAddress: string;
      amountUSDC: string;
      email: string;
      isNewUser: boolean;
    }[] = [];

    for (let i = 0; i < recipients.length; i++) {
      const email = recipients[i];
      let recipientAddress = await getUserAddressByEmail(email);
      let isNewUser = false;

      if (!recipientAddress) {
        isNewUser = true;
        const res = await fetch('/api/wallets/pre-generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();
        if (!res.ok) {
          results.push({
            email,
            status: 'failed',
            error: data.error || 'Identity generation failed',
          });
          continue;
        }
        recipientAddress = data.address;
      }

      transferParams.push({
        recipientAddress: recipientAddress as string,
        amountUSDC: amount,
        email,
        isNewUser,
      });
    }

    if (transferParams.length === 0) return results;

    // 2. Route the payout across chains. Each recipient is paid wholly on one chain,
    //    so we send one batched UserOp per chain (recipients share an address across
    //    EVM chains, so the chosen chain doesn't matter to them).
    const balancesForRoute: ChainBalances =
      chainBalances && Object.keys(chainBalances).length > 0
        ? chainBalances
        : { base: parseFloat(amount) * transferParams.length }; // legacy: all on Base

    let plan = planBatchRoute(amount, transferParams.length, balancesForRoute, {
      homeChain: 'base',
    });

    if (!plan.feasible) {
      // Funds too fragmented (or partly on Solana) to pay everyone on a single chain.
      // If the combined balance covers it, bridge everything onto Base and run one batch
      // there; otherwise fail with a clear reason.
      const requiredTotal = parseFloat(amount) * transferParams.length;
      const solBal = solanaSource?.balance ?? 0;
      const fundsSuffice =
        plan.needsConsolidation ||
        plan.totalAvailable + solBal + 1e-9 >= requiredTotal;
      if (fundsSuffice && wallet && smartAddress) {
        try {
          onStatus?.('Your funds are spread across networks — moving them to Base…');
          await consolidateFundsToChain(wallet, {
            targetChain: 'base',
            requiredAmount: (requiredTotal * 1.001).toFixed(6),
            balances: balancesForRoute,
            recipient: smartAddress,
            solana: solanaSource,
            onStatus,
          });
        } catch (err) {
          console.error('[BatchSend] Consolidation failed:', err);
          return transferParams.map((p) => ({
            email: p.email,
            status: 'failed',
            error: 'Could not consolidate funds. Please try again.',
          }));
        }
        // All funds are on Base now — pay everyone in one batch there.
        plan = {
          feasible: true,
          needsConsolidation: false,
          groups: [{ chain: 'base', count: transferParams.length }],
          totalAvailable: 0,
          requested: 0,
        };
      } else {
        const msg = plan.needsConsolidation
          ? 'Your balance is split across networks. Move funds onto one network (via Bridge) and retry.'
          : 'Insufficient balance for this batch.';
        return transferParams.map((p) => ({
          email: p.email,
          status: 'failed',
          error: msg,
        }));
      }
    }

    // 3. Execute one batched UserOp per chain, slicing recipients in order.
    let offset = 0;
    for (const group of plan.groups) {
      const slice = transferParams.slice(offset, offset + group.count);
      offset += group.count;
      if (slice.length === 0) continue;

      let txHash: string;
      try {
        txHash = await executeCircleGaslessBatchTransfer(
          provider,
          slice.map((p) => ({
            recipientAddress: p.recipientAddress,
            amountUSDC: p.amountUSDC,
          })),
          group.chain,
        );
      } catch (err) {
        console.error(`[BatchSend] Batch on ${group.chain} failed:`, err);
        const errorMsg =
          err instanceof Error ? err.message : 'Batch execution failed';
        for (const p of slice) {
          const result: SendResult = {
            email: p.email,
            status: 'failed',
            error: errorMsg,
          };
          results.push(result);
          onProgress?.(results.length, total, result);
        }
        continue;
      }

      // Record + notify each recipient settled in this chain's batch.
      for (const p of slice) {
        await recordTransfer({
          senderEmail,
          recipientEmail: p.email,
          amount: parseFloat(p.amountUSDC),
          status: p.isNewUser ? 'pending_claim' : 'completed',
          note,
          txHash,
          chain: group.chain,
        }).catch((err) =>
          console.error(`[BatchSend] Ledger failed for ${p.email}:`, err),
        );

        sendTransferEmail(p.email, p.amountUSDC, senderEmail).catch((err) =>
          console.error(`[BatchSend] Email failed for ${p.email}:`, err),
        );

        const result: SendResult = {
          email: p.email,
          status: p.isNewUser ? 'claim_required' : 'success',
          txHash,
        };
        results.push(result);
        onProgress?.(results.length, total, result);
      }
    }

    return results;
  } catch (err) {
    console.error(`[BatchSend] Atomic batch failed:`, err);
    const errorMsg =
      err instanceof Error ? err.message : 'Batch execution failed';

    // If it failed at the batch level, mark all as failed
    return recipients.map((email) => ({
      email,
      status: 'failed',
      error: errorMsg,
    }));
  }
}
