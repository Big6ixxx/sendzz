/**
 * Verify OTP API
 *
 * Verifies the OTP and creates a Supabase session.
 * Sets session cookies directly using the hashed_token from generateLink.
 */

import {
  checkRateLimit,
  hashToken,
  OTP_VERIFY_RATE_LIMIT,
} from '@/lib/security';
import { createAdminClient } from '@/lib/supabase/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { email, otp } = await request.json();

    if (!email || !otp) {
      return NextResponse.json(
        { error: 'Email and OTP are required' },
        { status: 400 },
      );
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedOtp = otp.trim();

    // Rate limit verification attempts
    const rateLimitResult = checkRateLimit(
      `otp_verify:${normalizedEmail}`,
      OTP_VERIFY_RATE_LIMIT,
    );

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          error: 'Too many attempts. Please request a new code.',
          retryAfter: rateLimitResult.retryAfterMs,
        },
        { status: 429 },
      );
    }

    const supabaseAdmin = createAdminClient();

    // Find OTP record
    const { data: otpRecord, error: findError } = await supabaseAdmin
      .from('auth_otp')
      .select('*')
      .eq('email', normalizedEmail)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (findError || !otpRecord) {
      return NextResponse.json(
        { error: 'Invalid or expired code. Please request a new one.' },
        { status: 400 },
      );
    }

    // Check max attempts
    if (otpRecord.attempts >= 5) {
      await supabaseAdmin
        .from('auth_otp')
        .update({ used: true })
        .eq('id', otpRecord.id);

      return NextResponse.json(
        { error: 'Too many attempts. Please request a new code.' },
        { status: 400 },
      );
    }

    // Increment attempts
    await supabaseAdmin
      .from('auth_otp')
      .update({ attempts: otpRecord.attempts + 1 })
      .eq('id', otpRecord.id);

    // Verify OTP hash
    const otpHash = hashToken(normalizedOtp);
    if (otpHash !== otpRecord.otp_hash) {
      return NextResponse.json(
        { error: 'Invalid code. Please try again.' },
        { status: 400 },
      );
    }

    // Mark OTP as used
    await supabaseAdmin
      .from('auth_otp')
      .update({ used: true })
      .eq('id', otpRecord.id);

    // Check if user exists in Supabase Auth
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    let userId: string;

    const existingUser = existingUsers?.users?.find(
      (u) => u.email?.toLowerCase() === normalizedEmail,
    );

    if (existingUser) {
      userId = existingUser.id;
    } else {
      // Create new user
      const { data: newUser, error: createError } =
        await supabaseAdmin.auth.admin.createUser({
          email: normalizedEmail,
          email_confirm: true,
        });

      if (createError || !newUser.user) {
        console.error('[Auth] Failed to create user:', createError);
        return NextResponse.json(
          { error: 'Failed to create account' },
          { status: 500 },
        );
      }

      userId = newUser.user.id;
      console.log(`[Auth] Created new user: ${userId}`);
    }

    // Generate a magic link for this user
    const { data: linkData, error: linkError } =
      await supabaseAdmin.auth.admin.generateLink({
        type: 'magiclink',
        email: normalizedEmail,
      });

    if (linkError || !linkData) {
      console.error('[Auth] Failed to generate link:', linkError);
      return NextResponse.json(
        { error: 'Failed to create session' },
        { status: 500 },
      );
    }

    // The hashed_token is in the properties
    const hashedToken = linkData.properties.hashed_token;

    if (!hashedToken) {
      console.error(
        '[Auth] No hashed_token in generated link. Properties:',
        linkData.properties,
      );
      return NextResponse.json(
        { error: 'Failed to create session' },
        { status: 500 },
      );
    }

    // Create a response with cookies
    const cookieStore = await cookies();

    // Create a Supabase client that can set cookies
    const supabaseClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          },
        },
      },
    );

    // Verify the generated token to create a session
    const { error: verifyError } = await supabaseClient.auth.verifyOtp({
      token_hash: hashedToken,
      type: 'magiclink',
    });

    if (verifyError) {
      console.error('[Auth] Failed to verify token:', verifyError);
      return NextResponse.json(
        { error: 'Failed to create session' },
        { status: 500 },
      );
    }

    console.log(`[Auth] User verified and session created: ${normalizedEmail}`);

    return NextResponse.json({
      success: true,
      email: normalizedEmail,
    });
  } catch (error) {
    console.error('[Auth] verify-otp error:', error);
    return NextResponse.json(
      { error: 'Something went wrong' },
      { status: 500 },
    );
  }
}
