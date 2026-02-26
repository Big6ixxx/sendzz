/**
 * Deposit Service
 *
 * Business logic for fiat deposits via Paystack.
 * Handles payment initialization and webhook processing.
 */

import { getBushaClient } from '@/lib/busha';
import { AUDIT_ACTIONS, createAuditLog } from '@/server/repositories';
import { creditBalance } from '@/server/repositories/balanceRepository';
import {
    createDeposit,
    findDepositByReference,
    updateDepositStatus,
} from '@/server/repositories/depositRepository';

export interface InitiateDepositInput {
  userId: string;
  userEmail: string;
  amountNgn: number; // Amount in NGN
  amountUsdc: number; // Equivalent in USDC after conversion
}

export interface InitiateDepositResult {
  success: boolean;
  paymentUrl?: string;
  reference?: string;
  depositId?: string;
  error?: string;
}

/**
 * Initiate a fiat deposit via Paystack
 */
export async function initiateDeposit(
  input: InitiateDepositInput,
): Promise<InitiateDepositResult> {
  const { userId, amountNgn, amountUsdc } = input;

  // Generate unique reference
  const reference = `DEP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Production: Initialize Busha deposit charge
  try {
    const busha = getBushaClient();
    const redirectUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?deposit=success`;
    const cancelUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?deposit=cancelled`;

    const response = await busha.createCharge({
      local_price: {
        amount: amountNgn, // Busha uses the standard unit
        currency: 'NGN',
      },
      redirect_url: redirectUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId,
        amountUsdc,
        reference,
      },
    });

    // Create pending deposit record
    const deposit = await createDeposit({
      userId,
      amount: amountUsdc,
      status: 'pending',
      paymentReference: reference,
    });

    await createAuditLog({
      userId,
      action: AUDIT_ACTIONS.DEPOSIT_INITIATED,
      metadata: {
        depositId: deposit.id,
        amountUsdc,
        amountNgn,
        reference,
      },
    });

    return {
      success: true,
      paymentUrl: response.data.hosted_url,
      reference, // Busha will pass this via metadata webhook
      depositId: deposit.id,
    };
  } catch (error) {
    console.error('[DepositService] Busha error:', error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Payment initialization failed',
    };
  }
}

/**
 * Complete a deposit after successful payment (called from webhook)
 */
export async function completeDeposit(
  reference: string,
  paidAmount?: number,
): Promise<boolean> {
  const deposit = await findDepositByReference(reference);
  if (!deposit) {
    console.error(
      '[DepositService] Deposit not found for reference:',
      reference,
    );
    return false;
  }

  if (deposit.status === 'confirmed') {
    console.log('[DepositService] Deposit already confirmed:', reference);
    return true; // Already processed
  }

  // Credit user's balance
  const credited = await creditBalance(
    deposit.user_id,
    Number(deposit.amount_usdc),
  );
  if (!credited) {
    console.error('[DepositService] Failed to credit balance for:', reference);
    return false;
  }

  // Update deposit status
  await updateDepositStatus(deposit.id, 'confirmed');

  await createAuditLog({
    userId: deposit.user_id,
    action: AUDIT_ACTIONS.DEPOSIT_COMPLETED,
    metadata: {
      depositId: deposit.id,
      amount: deposit.amount_usdc,
      paidAmount,
      reference,
    },
  });

  return true;
}

/**
 * Fail a deposit (called from webhook on payment failure)
 */
export async function failDeposit(
  reference: string,
  reason?: string,
): Promise<boolean> {
  const deposit = await findDepositByReference(reference);
  if (!deposit) return false;

  await updateDepositStatus(deposit.id, 'failed');

  await createAuditLog({
    userId: deposit.user_id,
    action: AUDIT_ACTIONS.DEPOSIT_FAILED,
    metadata: {
      depositId: deposit.id,
      reason,
      reference,
    },
  });

  return true;
}
