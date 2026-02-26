import { createClient } from '@/lib/supabase/server';
import { initiateDeposit } from '@/server/services/depositService';
import { depositSchema } from '@/validators';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const result = depositSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: result.error.errors },
        { status: 400 },
      );
    }

    const { method = 'fiat', amount } = result.data;

    // PRODUCTION MODE
    // NOTE: Paycrest is for payouts (withdrawals) only, NOT deposits.
    // For fiat deposits, you would need:
    // - A payment processor like Flutterwave/Paystack for card payments
    // - Virtual account numbers from a banking-as-a-service provider
    // - Manual bank transfer verification
    //
    // For now, encourage USDC deposits via blockchain

    if (method === 'usdc') {
      return NextResponse.json({
        success: true,
        message:
          'Send USDC to your deposit address. Balance will update automatically.',
      });
    }

    const amountUsdc = parseFloat(amount);

    // Typically you'd fetch live rate here, for now using system default
    const amountNgn = amountUsdc * 1500;

    const depositResult = await initiateDeposit({
      userId: user.id,
      userEmail: user.email || '',
      amountNgn,
      amountUsdc,
    });

    if (!depositResult.success) {
      return NextResponse.json({ error: depositResult.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      paymentUrl: depositResult.paymentUrl,
    });
  } catch (error) {
    console.error('Deposit error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
