/**
 * Get Institutions for Currency API Route
 *
 * GET /api/paycrest/institutions/[currency]
 * Returns list of supported banks/institutions for a specific currency.
 */

import { getInstitutions } from '@/lib/paycrest';
import { NextResponse } from 'next/server';

interface RouteParams {
  params: Promise<{ currency: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { currency } = await params;

    if (!currency || currency.length !== 3) {
      return NextResponse.json(
        { error: 'Invalid currency code' },
        { status: 400 },
      );
    }

    const institutions = await getInstitutions(currency.toUpperCase());

    return NextResponse.json({
      success: true,
      currency: currency.toUpperCase(),
      institutions,
    });
  } catch (error) {
    console.error('[API] paycrest/institutions error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch institutions' },
      { status: 500 },
    );
  }
}
