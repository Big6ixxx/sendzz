/**
 * Security: Rate Limiting
 *
 * In-memory rate limiting for sensitive operations.
 * For production, consider using Redis or a distributed cache.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory store (per-instance, resets on server restart)
const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically
const CLEANUP_INTERVAL = 60 * 1000; // 1 minute
let cleanupTimer: NodeJS.Timeout | null = null;

function startCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      if (entry.resetAt <= now) {
        rateLimitStore.delete(key);
      }
    }
  }, CLEANUP_INTERVAL);
  // Don't prevent process exit
  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }
}

export interface RateLimitConfig {
  /** Maximum number of requests allowed */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
}

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Current count of requests in window */
  current: number;
  /** Maximum allowed requests */
  limit: number;
  /** Remaining requests in window */
  remaining: number;
  /** When the window resets (ISO string) */
  resetAt: string;
  /** Milliseconds until reset */
  retryAfterMs: number;
}

/**
 * Check and update rate limit for a key
 *
 * @param key - Unique identifier (e.g., user ID, IP address, email)
 * @param config - Rate limit configuration
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): RateLimitResult {
  startCleanup();

  const now = Date.now();
  const entry = rateLimitStore.get(key);

  // If no entry or expired, create new window
  if (!entry || entry.resetAt <= now) {
    const resetAt = now + config.windowMs;
    rateLimitStore.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      current: 1,
      limit: config.maxRequests,
      remaining: config.maxRequests - 1,
      resetAt: new Date(resetAt).toISOString(),
      retryAfterMs: 0,
    };
  }

  // Increment count
  entry.count++;
  const allowed = entry.count <= config.maxRequests;

  return {
    allowed,
    current: entry.count,
    limit: config.maxRequests,
    remaining: Math.max(0, config.maxRequests - entry.count),
    resetAt: new Date(entry.resetAt).toISOString(),
    retryAfterMs: allowed ? 0 : entry.resetAt - now,
  };
}

/**
 * Reset rate limit for a key (e.g., after successful verification)
 */
export function resetRateLimit(key: string): void {
  rateLimitStore.delete(key);
}

/**
 * Clear all rate limits (for testing)
 */
export function clearAllRateLimits(): void {
  rateLimitStore.clear();
}

// ===========================================
// PREDEFINED RATE LIMIT CONFIGS
// ===========================================

/**
 * OTP request rate limit: 5 per hour
 */
export const OTP_RATE_LIMIT: RateLimitConfig = {
  maxRequests: parseInt(process.env.MAX_OTP_ATTEMPTS_PER_HOUR || '5', 10),
  windowMs: 60 * 60 * 1000, // 1 hour
};

/**
 * OTP verification attempts: 5 per 15 minutes
 */
export const OTP_VERIFY_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 5,
  windowMs: 15 * 60 * 1000, // 15 minutes
};

/**
 * Withdrawal rate limit: 10 per day
 */
export const WITHDRAWAL_RATE_LIMIT: RateLimitConfig = {
  maxRequests: parseInt(
    process.env.MAX_WITHDRAWAL_ATTEMPTS_PER_DAY || '10',
    10,
  ),
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
};

/**
 * Transfer rate limit: 20 per hour
 */
export const TRANSFER_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 20,
  windowMs: 60 * 60 * 1000, // 1 hour
};

/**
 * API general rate limit: 100 per minute
 */
export const API_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 100,
  windowMs: 60 * 1000, // 1 minute
};
