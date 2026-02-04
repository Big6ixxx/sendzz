/**
 * Withdrawal Service
 *
 * Business logic for stablecoin → fiat payouts via Paycrest.
 */

import { sendEmail, withdrawalOTPTemplate } from '@/lib/email';
import { createPayoutOrder, getInstitutionByCode } from '@/lib/paycrest';
import { generateOTPCode, hashToken, maskSensitiveData } from '@/lib/security';
import {
  AUDIT_ACTIONS,
  createAuditLog,
  createWithdrawal,
  findWithdrawalById,
  getBalance,
  lockBalance,
  markWithdrawalVerified,
  releaseLockedBalance,
  unlockBalance,
  updateWithdrawalStatus,
} from '@/server/repositories';

export interface InitiateWithdrawalInput {
  userId: string;
  userEmail: string;
  amountUsdc: number;
  fiatCurrency: string;
  institutionCode: string;
  accountNumber: string;
  accountName?: string;
}

export interface InitiateWithdrawalResult {
  success: boolean;
  withdrawalId?: string;
  error?: string;
}

/**
 * Initiate a withdrawal (creates pending withdrawal, sends OTP)
 */
export async function initiateWithdrawal(
  input: InitiateWithdrawalInput,
): Promise<InitiateWithdrawalResult> {
  const {
    userId,
    userEmail,
    amountUsdc,
    fiatCurrency,
    institutionCode,
    accountNumber,
  } = input;

  // Validate balance
  const balance = await getBalance(userId);
  if (!balance || balance.available < amountUsdc) {
    return { success: false, error: 'Insufficient balance' };
  }

  // Validate institution
  const institution = await getInstitutionByCode(fiatCurrency, institutionCode);
  if (!institution) {
    return { success: false, error: 'Invalid bank/institution' };
  }

  // Lock funds
  const locked = await lockBalance(userId, amountUsdc);
  if (!locked) {
    return { success: false, error: 'Failed to lock funds' };
  }

  // Generate OTP for verification
  const otpCode = generateOTPCode();
  const otpHash = hashToken(otpCode);
  const expiresAt = new Date(
    Date.now() +
      parseInt(process.env.OTP_EXPIRY_MINUTES || '10', 10) * 60 * 1000,
  );

  // Mask the account number
  const bankAccountMasked = maskSensitiveData(accountNumber, 4);

  // Create withdrawal record
  const withdrawal = await createWithdrawal({
    userId,
    amountUsdc,
    fiatCurrency,
    institutionCode,
    bankAccountMasked,
    verificationTokenHash: otpHash,
    verificationExpiresAt: expiresAt,
  });

  if (!withdrawal) {
    // Rollback: unlock funds
    await unlockBalance(userId, amountUsdc);
    return { success: false, error: 'Failed to create withdrawal request' };
  }

  // Store full account details temporarily (you might want to encrypt this)
  // For now, we'll pass them in the verify step

  // Audit log
  await createAuditLog({
    userId,
    action: AUDIT_ACTIONS.WITHDRAWAL_INITIATED,
    metadata: {
      withdrawalId: withdrawal.id,
      amountUsdc,
      fiatCurrency,
      institutionCode,
      bankAccountMasked,
    },
  });

  // Send OTP email
  await sendEmail({
    to: userEmail,
    subject: `🔐 Verify your Sendzz withdrawal`,
    html: withdrawalOTPTemplate(otpCode, amountUsdc.toString(), fiatCurrency),
  });

  return { success: true, withdrawalId: withdrawal.id };
}

export interface VerifyWithdrawalInput {
  withdrawalId: string;
  userId: string;
  userEmail: string;
  otpCode: string;
  // Full account details needed for Paycrest
  accountNumber: string;
  accountName?: string;
}

export interface VerifyWithdrawalResult {
  success: boolean;
  paycrestOrderId?: string;
  error?: string;
}

/**
 * Verify withdrawal OTP and create Paycrest payout order
 */
export async function verifyWithdrawal(
  input: VerifyWithdrawalInput,
): Promise<VerifyWithdrawalResult> {
  const { withdrawalId, userId, otpCode, accountNumber, accountName } = input;

  // Find withdrawal
  const withdrawal = await findWithdrawalById(withdrawalId);
  if (!withdrawal) {
    return { success: false, error: 'Withdrawal not found' };
  }

  // Verify ownership
  if (withdrawal.user_id !== userId) {
    return { success: false, error: 'Unauthorized' };
  }

  // Check status
  if (withdrawal.verification_status !== 'pending') {
    return { success: false, error: 'Withdrawal already processed' };
  }

  // Check expiry
  if (
    withdrawal.verification_expires_at &&
    new Date(withdrawal.verification_expires_at) < new Date()
  ) {
    // Unlock funds and fail the withdrawal
    await unlockBalance(userId, Number(withdrawal.amount_usdc));
    await updateWithdrawalStatus(withdrawalId, 'failed');
    return { success: false, error: 'Verification code expired' };
  }

  // Verify OTP
  const otpHash = hashToken(otpCode);
  if (otpHash !== withdrawal.verification_token_hash) {
    return { success: false, error: 'Invalid verification code' };
  }

  // Create Paycrest payout order
  let paycrestOrderId: string;
  try {
    const order = await createPayoutOrder({
      amount: withdrawal.amount_usdc.toString(),
      token: 'USDC',
      currency: withdrawal.fiat_currency,
      recipient: {
        institutionCode: withdrawal.institution_code,
        accountNumber,
        accountName,
      },
      reference: `SENDZZ-${withdrawal.id}`,
    });
    paycrestOrderId = order.id;
  } catch (error) {
    console.error('[WithdrawalService] Paycrest error:', error);
    // Don't unlock funds yet - we might retry
    return {
      success: false,
      error: 'Failed to process payout. Please try again.',
    };
  }

  // Mark withdrawal as verified
  const verified = await markWithdrawalVerified(withdrawalId, paycrestOrderId);
  if (!verified) {
    return { success: false, error: 'Failed to update withdrawal status' };
  }

  // Audit log
  await createAuditLog({
    userId,
    action: AUDIT_ACTIONS.WITHDRAWAL_VERIFIED,
    metadata: {
      withdrawalId,
      paycrestOrderId,
      amountUsdc: withdrawal.amount_usdc,
      fiatCurrency: withdrawal.fiat_currency,
    },
  });

  return { success: true, paycrestOrderId };
}

/**
 * Handle successful withdrawal completion (called from webhook)
 */
export async function completeWithdrawal(
  withdrawalId: string,
  fiatAmount?: string,
): Promise<boolean> {
  const withdrawal = await findWithdrawalById(withdrawalId);
  if (!withdrawal) return false;

  // Release locked funds (they've been paid out)
  await releaseLockedBalance(
    withdrawal.user_id,
    Number(withdrawal.amount_usdc),
  );

  // Update status
  await updateWithdrawalStatus(withdrawalId, 'completed');

  // Audit log
  await createAuditLog({
    userId: withdrawal.user_id,
    action: AUDIT_ACTIONS.WITHDRAWAL_COMPLETED,
    metadata: {
      withdrawalId,
      amountUsdc: withdrawal.amount_usdc,
      fiatAmount,
    },
  });

  // TODO: Send completion email (need to get user email)

  return true;
}

/**
 * Handle failed withdrawal (called from webhook)
 */
export async function failWithdrawal(
  withdrawalId: string,
  reason?: string,
): Promise<boolean> {
  const withdrawal = await findWithdrawalById(withdrawalId);
  if (!withdrawal) return false;

  // Unlock funds (return to available balance)
  await unlockBalance(withdrawal.user_id, Number(withdrawal.amount_usdc));

  // Update status
  await updateWithdrawalStatus(withdrawalId, 'failed');

  // Audit log
  await createAuditLog({
    userId: withdrawal.user_id,
    action: AUDIT_ACTIONS.WITHDRAWAL_FAILED,
    metadata: {
      withdrawalId,
      amountUsdc: withdrawal.amount_usdc,
      reason,
    },
  });

  return true;
}
