/**
 * Transfer Service
 *
 * Business logic for email-to-email USDC transfers.
 */

import {
  claimTransferTemplate,
  sendEmail,
  transferReceivedTemplate,
} from '@/lib/email';
import {
  generateUrlSafeToken,
  getExpiryDate,
  hashToken,
  isExpired,
  verifyToken,
} from '@/lib/security';
import {
  AUDIT_ACTIONS,
  createAuditLog,
  createTransfer,
  creditBalance,
  debitBalance,
  findTransferByClaimTokenHash,
  findUserByEmail,
  getBalance,
  markTransferClaimed,
  markTransferCompleted,
} from '@/server/repositories';

export interface SendTransferInput {
  senderId: string;
  senderEmail: string;
  recipientEmail: string;
  amount: number;
  note?: string;
}

export interface SendTransferResult {
  success: boolean;
  transferId?: string;
  claimRequired?: boolean;
  error?: string;
}

/**
 * Send USDC to an email address
 * - If recipient exists, instant transfer
 * - If recipient doesn't exist, create pending claim
 */
export async function sendTransfer(
  input: SendTransferInput,
): Promise<SendTransferResult> {
  const { senderId, senderEmail, recipientEmail, amount, note } = input;

  // Validate sender balance
  const balance = await getBalance(senderId);
  if (!balance || balance.available < amount) {
    return { success: false, error: 'Insufficient balance' };
  }

  // Check if recipient exists
  const recipient = await findUserByEmail(recipientEmail);

  // Debit sender
  const debited = await debitBalance(senderId, amount);
  if (!debited) {
    return { success: false, error: 'Failed to debit balance' };
  }

  if (recipient) {
    // Instant transfer - recipient exists
    const credited = await creditBalance(recipient.id, amount);
    if (!credited) {
      // Rollback: credit sender back
      await creditBalance(senderId, amount);
      return { success: false, error: 'Failed to credit recipient' };
    }

    // Create completed transfer record
    const transfer = await createTransfer({
      senderId,
      recipientId: recipient.id,
      recipientEmail,
      amount,
      note,
      status: 'completed',
    });

    if (!transfer) {
      return { success: false, error: 'Failed to create transfer record' };
    }

    // Audit log
    await createAuditLog({
      userId: senderId,
      action: AUDIT_ACTIONS.TRANSFER_INITIATED,
      metadata: {
        transferId: transfer.id,
        recipientEmail,
        amount,
        instant: true,
      },
    });

    // Send notification email to recipient
    await sendEmail({
      to: recipientEmail,
      subject: `💰 You received ${amount} USDC from Sendzz!`,
      html: transferReceivedTemplate(amount.toString(), senderEmail, note),
    });

    return { success: true, transferId: transfer.id, claimRequired: false };
  } else {
    // Pending claim - recipient doesn't exist
    const claimToken = generateUrlSafeToken();
    const claimTokenHash = hashToken(claimToken);
    const expiresAt = getExpiryDate(
      parseInt(process.env.CLAIM_TOKEN_EXPIRY_DAYS || '7', 10),
    );

    const transfer = await createTransfer({
      senderId,
      recipientEmail,
      amount,
      note,
      claimTokenHash,
      expiresAt,
      status: 'pending_claim',
    });

    if (!transfer) {
      // Rollback: credit sender back
      await creditBalance(senderId, amount);
      return { success: false, error: 'Failed to create transfer record' };
    }

    // Audit log
    await createAuditLog({
      userId: senderId,
      action: AUDIT_ACTIONS.TRANSFER_INITIATED,
      metadata: {
        transferId: transfer.id,
        recipientEmail,
        amount,
        pendingClaim: true,
      },
    });

    // Send claim email to recipient
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const claimUrl = `${baseUrl}/claim/${claimToken}`;

    await sendEmail({
      to: recipientEmail,
      subject: `💰 You received ${amount} USDC! Claim now on Sendzz`,
      html: claimTransferTemplate(
        amount.toString(),
        senderEmail,
        claimUrl,
        note,
      ),
    });

    return { success: true, transferId: transfer.id, claimRequired: true };
  }
}

export interface ClaimTransferInput {
  token: string;
  claimantId: string;
  claimantEmail: string;
}

export interface ClaimTransferResult {
  success: boolean;
  amount?: number;
  error?: string;
}

/**
 * Claim a pending transfer using the claim token
 */
export async function claimTransfer(
  input: ClaimTransferInput,
): Promise<ClaimTransferResult> {
  const { token, claimantId, claimantEmail } = input;

  // Hash the token to look up
  const tokenHash = hashToken(token);

  // Find the pending transfer
  const transfer = await findTransferByClaimTokenHash(tokenHash);
  if (!transfer) {
    return { success: false, error: 'Invalid or expired claim link' };
  }

  // Verify token matches
  if (!verifyToken(token, transfer.claim_token_hash!)) {
    return { success: false, error: 'Invalid claim token' };
  }

  // Check expiry
  if (isExpired(transfer.expires_at)) {
    return { success: false, error: 'Claim link has expired' };
  }

  // Verify recipient email matches (optional but recommended)
  if (transfer.recipient_email.toLowerCase() !== claimantEmail.toLowerCase()) {
    return {
      success: false,
      error: 'This transfer was sent to a different email address',
    };
  }

  // Mark transfer as claimed and set recipient
  const claimed = await markTransferClaimed(transfer.id, claimantId);
  if (!claimed) {
    return { success: false, error: 'Failed to claim transfer' };
  }

  // Credit the claimant's balance
  const credited = await creditBalance(claimantId, Number(transfer.amount));
  if (!credited) {
    return { success: false, error: 'Failed to credit balance' };
  }

  // Mark transfer as completed
  await markTransferCompleted(transfer.id);

  // Audit log
  await createAuditLog({
    userId: claimantId,
    action: AUDIT_ACTIONS.TRANSFER_CLAIMED,
    metadata: {
      transferId: transfer.id,
      amount: transfer.amount,
      senderId: transfer.sender_id,
    },
  });

  return { success: true, amount: Number(transfer.amount) };
}
