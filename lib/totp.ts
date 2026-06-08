import * as speakeasy from "speakeasy";

/**
 * Generate a new TOTP secret for a user
 */
export function generateTOTPSecret(): string {
  return speakeasy.generateSecret().base32;
}

/**
 * Generate a TOTP URI for QR code scanning
 * Format: otpauth://totp/Service:email?secret=SECRET&issuer=Service
 */
export function generateTOTPUri(email: string, secret: string): string {
  // Manually construct the URI to ensure we use the correct secret
  const label = encodeURIComponent(email);
  const issuer = encodeURIComponent("Sendzz");
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}`;
}

/**
 * Verify a TOTP token against a secret
 */
export function verifyTOTPToken(token: string, secret: string): boolean {
  return speakeasy.totp.verify({
    secret,
    token,
    encoding: "base32",
    window: 1, // Allow tokens from 1 time window before and after (±30 seconds, global standard)
  });
}
