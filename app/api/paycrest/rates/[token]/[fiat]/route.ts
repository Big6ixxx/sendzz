/**
 * Paycrest Rates API Route
 *
 * GET /api/paycrest/rates/{token}/{fiat}
 * Returns live exchange rate from Paycrest.
 */

import { getExchangeRate } from '@/lib/paycrest';
import { NextResponse } from 'next/server';

interface RouteParams {
  params: Promise<{ token: string; fiat: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { token, fiat } = await params;

    if (!token || !fiat) {
      return NextResponse.json(
        { error: 'Token and fiat currency are required' },
        { status: 400 },
      );
    }

    const rate = await getExchangeRate(token, fiat);

    return NextResponse.json({
      success: true,
      data: rate,
    });
  } catch (error) {
    console.error('[RatesAPI] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch exchange rate' },
      { status: 500 },
    );
  }
}
