'use server';

import { Resend } from 'resend';
import { claimTransferTemplate, transferReceivedTemplate, depositConfirmedTemplate, bridgeCompletedTemplate, withdrawalCompletedTemplate, securityAlertTemplate, transferSentTemplate } from './templates';
import { userWantsEmail } from '@/lib/supabase/emailPrefs';

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send an email via Resend
 */
export async function sendEmail(
  options: SendEmailOptions,
): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.EMAIL_FROM_ADDRESS || 'noreply@sendzz.io';

  if (!apiKey) {
    return { success: false, error: 'RESEND_API_KEY not configured' };
  }

  const resend = new Resend(apiKey);

  try {
    const response = await resend.emails.send({
      from: `Sendzz <${fromAddress}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo || 'support@sendzz.io',
    });

    if (response.error) {
      return { success: false, error: response.error.message };
    }

    return { success: true, messageId: response.data?.id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Send the appropriate transfer notification email.
 *
 * - pending_claim: recipient gets a "Claim Your Funds" email with a one-time link.
 * - completed:     recipient gets an instant "Funds Received" email.
 */
export async function sendTransferEmail(
  recipientEmail: string,
  amountUSDC: string,
  senderEmail: string,
  options: {
    isPendingClaim: boolean;
    /** Raw (un-hashed) claim token — only required when isPendingClaim is true */
    rawToken?: string;
    note?: string;
  } = { isPendingClaim: false },
) {
  // Claim-link emails are always sent (recipient may not have an account yet).
  // Regular "funds received" emails respect the user's preference.
  if (!options.isPendingClaim) {
    const wantsEmail = await userWantsEmail(recipientEmail, 'email_notif_transfer');
    if (!wantsEmail) {
      console.log(`[sendTransferEmail] Skipping — ${recipientEmail} opted out of transfer emails.`);
      return;
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://sendzz.io';

  let subject: string;
  let html: string;

  if (options.isPendingClaim && options.rawToken) {
    const claimUrl = `${appUrl}/claim?token=${options.rawToken}`;
    subject = `${senderEmail} sent you ${amountUSDC} USDC — claim it now`;
    html = claimTransferTemplate(amountUSDC, senderEmail, claimUrl, options.note);
  } else {
    subject = `You received ${amountUSDC} USDC on Sendzz`;
    html = transferReceivedTemplate(amountUSDC, senderEmail, options.note);
  }

  const result = await sendEmail({ to: recipientEmail, subject, html });

  if (!result.success) {
    console.error('[sendTransferEmail] Failed:', result.error);
    throw new Error(result.error || 'Failed to send transfer email');
  }
}

/**
 * Send Bridge Completed Email if enabled by recipient
 */
export async function sendBridgeEmail(
  recipientEmail: string,
  amountUsdc: string,
  sourceChain: string,
  destChain: string,
  referenceId?: string,
  txHash?: string,
  burnTxHash?: string
): Promise<void> {
  try {
    const wantsEmail = await userWantsEmail(recipientEmail, 'email_notif_bridge');
    if (!wantsEmail) {
      console.log(`[sendBridgeEmail] Skipping — ${recipientEmail} opted out of bridge emails.`);
      return;
    }

    const subject = `Your Bridge of ${amountUsdc} USDC is Complete!`;
    const html = bridgeCompletedTemplate(amountUsdc, sourceChain, destChain, referenceId, txHash, burnTxHash);

    const result = await sendEmail({ to: recipientEmail, subject, html });
    if (!result.success) {
      console.error('[sendBridgeEmail] Failed to send email:', result.error);
    }
  } catch (err) {
    console.error('[sendBridgeEmail] Error:', err);
  }
}

/**
 * Send Deposit Confirmed Email if enabled by recipient
 */
export async function sendDepositEmail(
  recipientEmail: string,
  amountUsdc: string,
  referenceId?: string,
  txHash?: string
): Promise<void> {
  try {
    const wantsEmail = await userWantsEmail(recipientEmail, 'email_notif_deposit');
    if (!wantsEmail) {
      console.log(`[sendDepositEmail] Skipping — ${recipientEmail} opted out of deposit emails.`);
      return;
    }

    const subject = `Deposit Confirmed — ${amountUsdc} USDC Credited 💰`;
    const html = depositConfirmedTemplate(amountUsdc, referenceId, txHash);

    const result = await sendEmail({ to: recipientEmail, subject, html });
    if (!result.success) {
      console.error('[sendDepositEmail] Failed to send email:', result.error);
    }
  } catch (err) {
    console.error('[sendDepositEmail] Error:', err);
  }
}

/**
 * Send Withdrawal Completed Email if enabled by recipient
 */
export async function sendWithdrawalEmail(
  recipientEmail: string,
  amountUsdc: string,
  fiatAmount: string,
  currency: string,
  bankMasked: string,
  referenceId?: string,
  orderId?: string
): Promise<void> {
  try {
    const wantsEmail = await userWantsEmail(recipientEmail, 'email_notif_withdrawal');
    if (!wantsEmail) {
      console.log(`[sendWithdrawalEmail] Skipping — ${recipientEmail} opted out of withdrawal emails.`);
      return;
    }

    const subject = `Withdrawal Completed — ${amountUsdc} USDC Payout Complete ✅`;
    const html = withdrawalCompletedTemplate(amountUsdc, fiatAmount, currency, bankMasked, referenceId, orderId);

    const result = await sendEmail({ to: recipientEmail, subject, html });
    if (!result.success) {
      console.error('[sendWithdrawalEmail] Failed to send email:', result.error);
    }
  } catch (err) {
    console.error('[sendWithdrawalEmail] Error:', err);
  }
}

/**
 * Send Security Alert Email if enabled by user
 */
export async function sendSecurityEmail(
  recipientEmail: string,
  title: string,
  body: string
): Promise<void> {
  try {
    const wantsEmail = await userWantsEmail(recipientEmail, 'email_notif_security');
    if (!wantsEmail) {
      console.log(`[sendSecurityEmail] Skipping — ${recipientEmail} opted out of security emails.`);
      return;
    }

    const subject = `Security Alert: ${title}`;
    const html = securityAlertTemplate(title, body);

    const result = await sendEmail({ to: recipientEmail, subject, html });
    if (!result.success) {
      console.error('[sendSecurityEmail] Failed to send email:', result.error);
    }
  } catch (err) {
    console.error('[sendSecurityEmail] Error:', err);
  }
}

/**
 * Send Transfer Sent Confirmation Email to the sender
 */
export async function sendTransferSentEmail(
  senderEmail: string,
  amountUsdc: string,
  recipient: string,
  referenceId?: string,
  note?: string
): Promise<void> {
  try {
    const wantsEmail = await userWantsEmail(senderEmail, 'email_notif_transfer');
    if (!wantsEmail) {
      console.log(`[sendTransferSentEmail] Skipping — ${senderEmail} opted out of transfer emails.`);
      return;
    }

    const subject = `Successful Transaction Out — Sent ${amountUsdc} USDC`;
    const html = transferSentTemplate(amountUsdc, recipient, referenceId, note);

    const result = await sendEmail({ to: senderEmail, subject, html });
    if (!result.success) {
      console.error('[sendTransferSentEmail] Failed to send email:', result.error);
    }
  } catch (err) {
    console.error('[sendTransferSentEmail] Error:', err);
  }
}

