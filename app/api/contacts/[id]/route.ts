/**
 * Contact Detail API
 *
 * DELETE /api/contacts/[id] - Remove a contact
 */

import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id); // Extra safety check though RLS handles it

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] DELETE /contacts/[id] error:', error);
    return NextResponse.json(
      { error: 'Failed to delete contact' },
      { status: 500 },
    );
  }
}
