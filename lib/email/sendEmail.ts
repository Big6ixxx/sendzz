/**
 * Email Service - Base Email Sender
 *
 * Abstraction layer for sending emails via Resend.
 */

import { Resend } from 'resend';

// Initialize Resend client
const resend = new Resend(process.env.RESEND_API_KEY);

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
  const fromAddress = process.env.EMAIL_FROM_ADDRESS || 'noreply@sendzz.io';

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
      console.error('[Email] Send failed:', response.error);
      return {
        success: false,
        error: response.error.message,
      };
    }

    console.log(
      `[Email] Sent successfully to ${options.to}:`,
      response.data?.id,
    );
    return {
      success: true,
      messageId: response.data?.id,
    };
  } catch (error) {
    console.error('[Email] Unexpected error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
