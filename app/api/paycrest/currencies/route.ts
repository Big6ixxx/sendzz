/**
 * Get Supported Currencies API Route
 *
 * GET /api/paycrest/currencies
 * Returns list of supported fiat currencies for withdrawal.
 */

import { getSupportedCurrencies } from '@/lib/paycrest';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const currencies = await getSupportedCurrencies();

    return NextResponse.json({
      success: true,
      currencies,
    });
  } catch (error) {
    console.error('[API] paycrest/currencies error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch currencies' },
      { status: 500 },
    );
  }
}
