import { sendTransferEmail } from '@/lib/email/sendEmail';
import { getUserAddressByEmail, recordTransfer } from '@/lib/supabase/actions';
import { executeCircleGaslessBatchTransfer } from '@/lib/web3/circle-actions';
import { EIP1193Provider } from '@privy-io/react-auth';

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
  onProgress,
}: {
  recipients: string[];
  amount: string;
  senderEmail: string;
  note?: string;
  provider: EIP1193Provider;
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

    // 2. Execute Atomic Batch Transfer (One Signature)
    const txHash = await executeCircleGaslessBatchTransfer(
      provider,
      transferParams.map((p) => ({
        recipientAddress: p.recipientAddress,
        amountUSDC: p.amountUSDC,
      })),
    );

    // 3. Post-execution: Record and Notify
    for (let i = 0; i < transferParams.length; i++) {
      const p = transferParams[i];

      // Record in ledger
      await recordTransfer({
        senderEmail,
        recipientEmail: p.email,
        amount: parseFloat(p.amountUSDC),
        status: p.isNewUser ? 'pending_claim' : 'completed',
        note,
        txHash,
      }).catch((err) =>
        console.error(`[BatchSend] Ledger failed for ${p.email}:`, err),
      );

      // Notify
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
