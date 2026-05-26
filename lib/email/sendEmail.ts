'use server';

import { Resend } from 'resend';
import { claimTransferTemplate, transferReceivedTemplate } from './templates';

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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.sendzz.io';

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
