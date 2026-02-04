/**
 * Security: Token Utilities
 *
 * Cryptographic token generation and verification for claim tokens
 * and verification tokens.
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto';

const TOKEN_BYTES = 32; // 256 bits
const HASH_ALGORITHM = 'sha256';

/**
 * Generate a cryptographically secure random token
 * Returns a hex-encoded string
 */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

/**
 * Generate a URL-safe base64 token (for use in URLs)
 */
export function generateUrlSafeToken(): string {
  return randomBytes(TOKEN_BYTES)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Hash a token for secure storage
 * NEVER store raw tokens in the database
 */
export function hashToken(token: string): string {
  return createHash(HASH_ALGORITHM).update(token).digest('hex');
}

/**
 * Verify a token against a stored hash
 * Uses timing-safe comparison to prevent timing attacks
 */
export function verifyToken(token: string, storedHash: string): boolean {
  try {
    const tokenHash = hashToken(token);
    const tokenBuffer = Buffer.from(tokenHash, 'hex');
    const storedBuffer = Buffer.from(storedHash, 'hex');

    if (tokenBuffer.length !== storedBuffer.length) {
      return false;
    }

    return timingSafeEqual(tokenBuffer, storedBuffer);
  } catch {
    return false;
  }
}

/**
 * Generate a 6-digit OTP code
 */
export function generateOTPCode(): string {
  // Generate random number between 100000 and 999999
  const bytes = randomBytes(4);
  const num = (bytes.readUInt32BE(0) % 900000) + 100000;
  return num.toString();
}

/**
 * Mask sensitive data (e.g., bank account numbers)
 * Shows last 4 characters, masks the rest with asterisks
 */
export function maskSensitiveData(
  data: string,
  visibleChars: number = 4,
): string {
  if (data.length <= visibleChars) {
    return '*'.repeat(data.length);
  }
  const masked = '*'.repeat(data.length - visibleChars);
  const visible = data.slice(-visibleChars);
  return masked + visible;
}

/**
 * Calculate token expiry date
 */
export function getExpiryDate(daysFromNow: number = 7): Date {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + daysFromNow);
  return expiry;
}

/**
 * Check if a date has expired
 */
export function isExpired(expiryDate: Date | string | null): boolean {
  if (!expiryDate) return true;
  const expiry =
    typeof expiryDate === 'string' ? new Date(expiryDate) : expiryDate;
  return expiry.getTime() < Date.now();
}
