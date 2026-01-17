import { NextResponse } from 'next/server';
import { createClient } from '@/app/lib/utils/supabase/server';
import { supabase as adminSupabase } from '@/app/lib/supabaseClient';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { preferredNetwork, payoutDetails } = await req.json();

    // UPDATE THE USER PROFILE IN SUPABASE
    // This tells the "Intent Tech" where the money should go next time
    const { error } = await adminSupabase
      .from('users')
      .update({ 
        preferred_network: preferredNetwork, // 'EVM', 'STELLAR', or 'BANK'
        payout_details: payoutDetails 
      })
      .eq('id', user.id);

    if (error) throw error;

    return NextResponse.json({ success: true, message: "Intent Profile Updated" });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}