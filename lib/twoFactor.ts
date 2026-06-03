import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";
import { sendEmail } from "@/lib/email/sendEmail";

export const TWO_FA_LIMIT = 1; // Limit above which 2FA is required

type TransferPayload = {
  amount: number;
  recipientEmail: string;
  note?: string;
};

type WithdrawalPayload = {
  amountUsdc: number;
  accountNumber: string;
  bankCode: string;
  fiatCurrency: string;
  fiatAmount?: number;
};

type TwoFAPayload = TransferPayload | WithdrawalPayload;

export async function generateAndSend2FA(
  userEmail: string,
  actionType: "transfer" | "withdrawal",
  payload: TwoFAPayload,
) {
  const supabase = await createClient();

  // Clean up expired OTPs for this user before generating a new one
  const now = new Date().toISOString();
  await supabase
    .from("transaction_otps")
    .delete()
    .lt("expires_at", now)
    .eq("user_email", userEmail);

  // Check if there's a recent OTP sent within the last minute (rate limiting)
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
  const { data: recentOtp } = await supabase
    .from("transaction_otps")
    .select("id")
    .eq("user_email", userEmail)
    .eq("action_type", actionType)
    .gt("created_at", oneMinuteAgo)
    .single();

  if (recentOtp) {
    throw new Error("Please wait before requesting another code");
  }

  const otpCode = crypto.randomInt(100000, 999999).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("transaction_otps")
    .insert({
      user_email: userEmail,
      otp_code: otpCode,
      action_type: actionType,
      payload,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[generateAndSend2FA] DB Error:", error);
    throw new Error("Failed to create OTP");
  }

  let transactionDetails = "";
  if (actionType === "withdrawal") {
    const withdrawalPayload = payload as WithdrawalPayload;
    transactionDetails = `
          <div style="margin: 20px auto; padding: 15px; background-color: #ecfdf5; border-left: 4px solid #10b981; border-radius: 4px; text-align: left;">
            <p style="color: #065f46; font-size: 14px; margin: 0;">
              <strong>Transaction Details:</strong><br>
              Amount: ${withdrawalPayload.amountUsdc} USDC<br>
              Currency: ${withdrawalPayload.fiatCurrency}
            </p>
          </div>
        `;
  } else if (actionType === "transfer") {
    const transferPayload = payload as TransferPayload;
    transactionDetails = `
          <div style="margin: 20px auto; padding: 15px; background-color: #ecfdf5; border-left: 4px solid #10b981; border-radius: 4px; text-align: left;">
            <p style="color: #065f46; font-size: 14px; margin: 0;">
              <strong>Transaction Details:</strong><br>
              Amount: ${transferPayload.amount} USDC<br>
              Recipient: ${transferPayload.recipientEmail}
            </p>
          </div>
        `;
  }

  await sendEmail({
    to: userEmail,
    subject: `Your Sendzz Authorization Code`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; text-align: center;">
        <h2 style="color: #333;">Authorization Required</h2>
        <p style="color: #666; font-size: 16px;">
          You are attempting a ${actionType} on Sendzz.
        </p>
        ${transactionDetails}
        <p style="color: #666; font-size: 16px; margin-top: 20px;">
          Please use the following code to authorize this transaction:
        </p>
        <div style="margin: 30px auto; padding: 20px; background-color: #f4f4f4; border-radius: 8px; font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #000; max-width: 250px;">
          ${otpCode}
        </div>
        <p style="color: #999; font-size: 12px; margin-top: 20px;">This code will expire in 10 minutes.</p>
        <p style="color: #dc2626; font-size: 11px; margin-top: 15px;">
          If you did not initiate this transaction, please ignore this email and contact support immediately.
        </p>
      </div>
    `,
  });

  return data.id;
}

export async function verifyOTP(
  otpId: string,
  otpCode: string,
  userEmail: string,
) {
  const supabase = await createClient();

  // Clean up expired OTPs for this user before verification
  const now = new Date().toISOString();
  await supabase
    .from("transaction_otps")
    .delete()
    .lt("expires_at", now)
    .eq("user_email", userEmail);

  const { data: otp, error } = await supabase
    .from("transaction_otps")
    .select("*")
    .eq("id", otpId)
    .single();

  if (error || !otp) {
    throw new Error("Invalid or expired authorization code");
  }

  if (otp.user_email !== userEmail) {
    throw new Error("Unauthorized");
  }

  if (new Date(otp.expires_at) < new Date()) {
    throw new Error("OTP has expired");
  }

  if (otp.otp_code !== otpCode) {
    throw new Error("Invalid OTP code");
  }

  // Delete the OTP after successful verification to prevent reuse
  await supabase.from("transaction_otps").delete().eq("id", otpId);

  return true;
}

/**
 * Clean up all expired OTPs in the database.
 * This can be called periodically (e.g., via cron job) to keep the table clean.
 */
export async function cleanupExpiredOTPs() {
  const supabase = await createClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("transaction_otps")
    .delete()
    .lt("expires_at", now);

  if (error) {
    console.error("[cleanupExpiredOTPs] Error:", error);
    throw new Error("Failed to cleanup expired OTPs");
  }

  return true;
}
