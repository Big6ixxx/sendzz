/**
 * Verify Account API Route
 *
 * POST /api/paycrest/verify-account
 * Validates bank account and returns account holder name.
 */

import { verifyAccount } from '@/lib/paycrest';
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const verifyAccountRequestSchema = z.object({
  institutionCode: z
    .string()
    .min(2, 'Invalid institution code')
    .max(20, 'Invalid institution code'),
  accountNumber: z
    .string()
    .min(5, 'Account number is too short')
    .max(20, 'Account number is too long'),
});

export async function POST(request: Request) {
  try {
    // Require authentication
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse and validate request body
    const body = await request.json();
    const parsed = verifyAccountRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { institutionCode, accountNumber } = parsed.data;

    // Call Paycrest verify-account API
    const accountName = await verifyAccount(institutionCode, accountNumber);

    if (!accountName) {
      return NextResponse.json(
        { error: 'Unable to verify account. Please check the details.' },
        { status: 404 },
      );
    }

    return NextResponse.json({ accountName });
  } catch (error) {
    console.error('[API] verify-account error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
