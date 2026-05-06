"use server";

import { Resend } from "resend";
import { transferReceivedTemplate } from "./templates";

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
  const fromAddress = process.env.EMAIL_FROM_ADDRESS || "noreply@sendzz.io";

  if (!apiKey) {
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  const resend = new Resend(apiKey);

  try {
    const response = await resend.emails.send({
      from: `Sendzz <${fromAddress}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo || "support@sendzz.io",
    });

    if (response.error) {
      return { success: false, error: response.error.message };
    }

    return { success: true, messageId: response.data?.id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function sendTransferEmail(
  recipientEmail: string,
  amountUSDC: string,
  senderEmail: string,
) {
  const result = await sendEmail({
    to: recipientEmail,
    subject: `You received ${amountUSDC} USDC on Sendzz`,
    html: transferReceivedTemplate(amountUSDC, senderEmail),
  });

  if (!result.success) {
    console.error("[sendTransferEmail] Failed:", result.error);
    throw new Error(result.error || "Failed to send transfer email");
  }
}
