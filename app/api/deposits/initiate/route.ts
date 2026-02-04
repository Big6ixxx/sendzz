import { createClient } from '@/lib/supabase/server';
import { creditBalance, getBalance } from '@/server/repositories/balanceRepository';
import { createDeposit } from '@/server/repositories/depositRepository';
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

    const { amount } = result.data;
    const amountNum = parseFloat(amount);

    // SIMULATION: Create confirmed deposit immediately
    const deposit = await createDeposit({
      userId: user.id,
      amount: amountNum,
      status: 'confirmed',
    });

    // Credit balance immediately
    const credited = await creditBalance(user.id, amountNum);

    if (!credited) {
      console.error('Failed to credit balance for deposit', deposit.id);
      return NextResponse.json(
        { error: 'Failed to process deposit' },
        { status: 500 },
      );
    }

    // Get updated balance
    const newBalance = await getBalance(user.id);

    return NextResponse.json({
      success: true,
      message: 'Deposit successful',
      balance: newBalance,
    });
  } catch (error) {
    console.error('Deposit error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
