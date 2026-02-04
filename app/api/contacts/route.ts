/**
 * Contacts AP
 *
 * GET /api/contacts - List all contacts
 * POST /api/contacts - Create a new contact
 */

import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: contacts, error } = await supabase
      .from('contacts')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;

    return NextResponse.json({ contacts });
  } catch (error) {
    console.error('[API] GET /contacts error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch contacts' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { name, email, avatar_url } = await request.json();

    if (!name || !email) {
      return NextResponse.json(
        { error: 'Name and email are required' },
        { status: 400 },
      );
    }

    if (email.toLowerCase() === user.email?.toLowerCase()) {
      return NextResponse.json(
        { error: 'Cannot add yourself as a contact' },
        { status: 400 },
      );
    }

    const { data: contact, error } = await supabase
      .from('contacts')
      .insert({
        user_id: user.id,
        name,
        email: email.toLowerCase(),
        avatar_url,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Contact already exists' },
          { status: 400 },
        );
      }
      throw error;
    }

    return NextResponse.json({ contact });
  } catch (error) {
    console.error('[API] POST /contacts error:', error);
    return NextResponse.json(
      { error: 'Failed to create contact' },
      { status: 500 },
    );
  }
}
