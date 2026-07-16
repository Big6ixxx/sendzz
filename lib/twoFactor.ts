import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";
import { sendEmail } from "@/lib/email/sendEmail";
import { transactionOTPTemplate, otpEmailSubject } from "@/lib/email/templates";
import { encrypt, decrypt } from "@/lib/encryption";

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

  const encryptionKey = process.env.TOTP_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error("Encryption key not configured");
  }

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

  // Encrypt the OTP code before storing
  const encryptedOtpCode = encrypt(otpCode, encryptionKey);

  const { data, error } = await supabase
    .from("transaction_otps")
    .insert({
      user_email: userEmail,
      otp_code: encryptedOtpCode,
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

  // Build template details from payload
  let emailSubject: string;
  let emailHtml: string;

  if (actionType === 'withdrawal') {
    const p = payload as WithdrawalPayload;
    const templateDetails = {
      amount: p.amountUsdc.toString(),
      fiatCurrency: p.fiatCurrency,
      fiatAmount: p.fiatAmount?.toString(),
    };
    emailSubject = otpEmailSubject('withdrawal', templateDetails);
    emailHtml = transactionOTPTemplate(otpCode, 'withdrawal', templateDetails);
  } else {
    const p = payload as TransferPayload;
    const templateDetails = {
      amount: p.amount.toString(),
      recipientEmail: p.recipientEmail,
      note: p.note,
    };
    emailSubject = otpEmailSubject('transfer', templateDetails);
    emailHtml = transactionOTPTemplate(otpCode, 'transfer', templateDetails);
  }

  await sendEmail({
    to: userEmail,
    subject: emailSubject,
    html: emailHtml,
  });

  return data.id;
}

export async function verifyOTP(
  otpId: string,
  otpCode: string,
  userEmail: string,
) {
  const supabase = await createClient();

  const encryptionKey = process.env.TOTP_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error("Encryption key not configured");
  }

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

  // Decrypt the stored OTP code before comparing
  const decryptedStoredCode = decrypt(otp.otp_code, encryptionKey);

  if (decryptedStoredCode !== otpCode) {
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
