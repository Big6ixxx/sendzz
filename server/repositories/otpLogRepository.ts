/**
 * OTP Log Repository
 *
 * Database operations for OTP attempt logging (for rate limiting and security).
 */

import { createAdminClient } from '@/lib/supabase/server';
import type { Database, OtpPurpose } from '@/types/database';

type OtpLog = Database['public']['Tables']['otp_logs']['Row'];

export interface OtpLogEntry {
  userId?: string;
  email: string;
  purpose: OtpPurpose;
  success: boolean;
  ip?: string;
  userAgent?: string;
}

/**
 * Log an OTP attempt
 */
export async function logOtpAttempt(entry: OtpLogEntry): Promise<boolean> {
  const supabase = createAdminClient();
  const { error } = await supabase.from('otp_logs').insert({
    user_id: entry.userId,
    email: entry.email.toLowerCase(),
    purpose: entry.purpose,
    success: entry.success,
    ip: entry.ip,
    user_agent: entry.userAgent,
  });

  if (error) {
    console.error('[OtpLogRepo] log error:', error);
    return false;
  }
  return true;
}

/**
 * Count recent failed attempts for an email
 */
export async function countRecentFailedAttempts(
  email: string,
  purpose: OtpPurpose,
  windowMinutes: number = 60,
): Promise<number> {
  const supabase = createAdminClient();
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);

  const { count, error } = await supabase
    .from('otp_logs')
    .select('*', { count: 'exact', head: true })
    .eq('email', email.toLowerCase())
    .eq('purpose', purpose)
    .eq('success', false)
    .gte('created_at', windowStart.toISOString());

  if (error) {
    console.error('[OtpLogRepo] countFailed error:', error);
    return 0;
  }
  return count || 0;
}

/**
 * Check if user is locked out due to too many failed attempts
 */
export async function isLockedOut(
  email: string,
  purpose: OtpPurpose,
  maxAttempts: number = 5,
  windowMinutes: number = 60,
): Promise<boolean> {
  const failedCount = await countRecentFailedAttempts(
    email,
    purpose,
    windowMinutes,
  );
  return failedCount >= maxAttempts;
}

/**
 * Get recent OTP logs for debugging
 */
export async function getRecentOtpLogs(
  email: string,
  limit: number = 10,
): Promise<OtpLog[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('otp_logs')
    .select('*')
    .eq('email', email.toLowerCase())
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[OtpLogRepo] getRecent error:', error);
    return [];
  }
  return data || [];
}
