import { NextResponse } from 'next/server';
import { supabase as adminSupabase } from '@/app/lib/supabaseClient';

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    
    // Check for withdrawal success event from Blockradar docs
    if (payload.event === 'withdraw.success') {
      const { error } = await adminSupabase
        .from('transactions')
        .update({ status: 'completed' })
        .eq('reference', payload.data.reference); // Use the ref we sent in the payout

      if (error) console.error("❌ Webhook DB Error:", error.message);
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}