import { previewTransfer } from '@/server/services/transferService';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token } = body;

    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 });
    }

    const result = await previewTransfer(token);

    if (!result.success) {
      // If error suggests not found/expired, return 404
      const status =
        result.error?.includes('Invalid') || result.error?.includes('expired')
          ? 404
          : 400;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Preview error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
