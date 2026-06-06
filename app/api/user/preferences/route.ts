import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/adminClient';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const email = searchParams.get('email');

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .select('two_fa_enabled, two_fa_threshold, two_fa_nudge_dismissed_at')
      .eq('email', email)
      .single() as { data: { two_fa_enabled: boolean; two_fa_threshold: number; two_fa_nudge_dismissed_at: string | null }, error: { code: string; message: string } | null };

    if (error) {
      if (error.code === 'PGRST116') {
        // Not found, return defaults assuming migration applied
        return NextResponse.json({
          two_fa_enabled: false,
          two_fa_threshold: 500,
          two_fa_nudge_dismissed_at: null,
        });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      two_fa_enabled: data.two_fa_enabled ?? false,
      two_fa_threshold: data.two_fa_threshold ?? 500,
      two_fa_nudge_dismissed_at: data.two_fa_nudge_dismissed_at,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email, two_fa_enabled, two_fa_threshold, two_fa_nudge_dismissed_at } = body;

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (two_fa_enabled !== undefined) updates.two_fa_enabled = two_fa_enabled;
    if (two_fa_threshold !== undefined) updates.two_fa_threshold = two_fa_threshold;
    if (two_fa_nudge_dismissed_at !== undefined) updates.two_fa_nudge_dismissed_at = two_fa_nudge_dismissed_at;

    const { error } = await supabaseAdmin
      .from('user_profiles')
      .update(updates)
      .eq('email', email);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
