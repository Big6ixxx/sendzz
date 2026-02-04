/**
 * Send OTP API
 *
 * Generates and sends a 6-digit OTP to the user's email.
 * Rate limited to 3 requests per email per 10 minutes.
 */

import { otpLoginTemplate, sendEmail } from '@/lib/email';
import {
    checkRateLimit,
    generateOTPCode,
    getExpiryDate,
    hashToken,
    OTP_RATE_LIMIT,
} from '@/lib/security';
import { createAdminClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Rate limit check
    const rateLimitResult = checkRateLimit(
      `otp_send:${normalizedEmail}`,
      OTP_RATE_LIMIT,
    );

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          error: 'Too many requests. Please try again later.',
          retryAfter: rateLimitResult.retryAfterMs,
        },
        { status: 429 },
      );
    }

    // Generate 6-digit OTP
    const otp = generateOTPCode();
    const otpHash = hashToken(otp);
    const expiresAt = getExpiryDate(10); // 10 minutes

    const supabase = createAdminClient();

    // Delete any existing OTPs for this email
    await supabase.from('auth_otp').delete().eq('email', normalizedEmail);

    // Store new OTP
    const { error: insertError } = await supabase.from('auth_otp').insert({
      email: normalizedEmail,
      otp_hash: otpHash,
      expires_at: expiresAt.toISOString(),
      attempts: 0,
      used: false,
    });

    if (insertError) {
      console.error('[Auth] Failed to store OTP:', insertError);
      return NextResponse.json(
        { error: 'Failed to generate OTP' },
        { status: 500 },
      );
    }

    // Send email
    const emailResult = await sendEmail({
      to: normalizedEmail,
      subject: 'Your Sendzz Login Code',
      html: otpLoginTemplate(otp),
    });

    if (!emailResult.success) {
      console.error('[Auth] Failed to send OTP email:', emailResult.error);
      return NextResponse.json(
        { error: 'Failed to send email' },
        { status: 500 },
      );
    }

    console.log(`[Auth] OTP sent to ${normalizedEmail}`);

    return NextResponse.json({
      success: true,
      message: 'Verification code sent',
    });
  } catch (error) {
    console.error('[Auth] send-otp error:', error);
    return NextResponse.json(
      { error: 'Something went wrong' },
      { status: 500 },
    );
  }
}
