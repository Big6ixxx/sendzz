'use server';

import { Database } from '@/types/database';
import { supabaseAdmin } from './adminClient';

type ContactRow = Database['public']['Tables']['contacts']['Row'];

async function resolveUserId(userEmail: string): Promise<string> {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', userEmail)
    .single();
  if (!user) throw new Error('User not found');
  return user.id;
}

export async function getUserContacts(userEmail: string): Promise<ContactRow[]> {
  try {
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', userEmail)
      .single();

    if (!user) return [];

    const { data, error } = await supabaseAdmin
      .from('contacts')
      .select('*')
      .eq('user_id', user.id)
      .order('name', { ascending: true });

    if (error) {
      console.error('[Contacts] Failed to fetch:', error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error('[Contacts] Error fetching contacts:', err);
    return [];
  }
}

export async function addContact(params: {
  userEmail: string;
  contactEmail: string;
  contactName: string;
  avatarUrl?: string;
}): Promise<{ success: true }> {
  try {
    const userId = await resolveUserId(params.userEmail);

    const { error } = await supabaseAdmin.from('contacts').insert({
      user_id: userId,
      email: params.contactEmail.toLowerCase(),
      name: params.contactName,
      avatar_url: params.avatarUrl || null,
    });

    if (error) {
      if (error.code === '23505') throw new Error('Contact already exists in your list.');
      throw new Error(error.message);
    }
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add contact';
    console.error('[Contacts] Error adding contact:', err);
    throw new Error(message);
  }
}

export async function deleteContact(
  userEmail: string,
  contactId: string,
): Promise<{ success: true }> {
  try {
    const userId = await resolveUserId(userEmail);

    const { error } = await supabaseAdmin
      .from('contacts')
      .delete()
      .match({ id: contactId, user_id: userId });

    if (error) throw new Error(error.message);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete contact';
    console.error('[Contacts] Error deleting contact:', err);
    throw new Error(message);
  }
}

export async function updateContact(params: {
  userEmail: string;
  contactId: string;
  contactEmail: string;
  contactName: string;
}): Promise<{ success: true }> {
  try {
    const userId = await resolveUserId(params.userEmail);

    const { error } = await supabaseAdmin
      .from('contacts')
      .update({
        email: params.contactEmail.toLowerCase(),
        name: params.contactName,
      })
      .match({ id: params.contactId, user_id: userId });

    if (error) {
      if (error.code === '23505') throw new Error('Another contact with this email already exists.');
      throw new Error(error.message);
    }
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update contact';
    console.error('[Contacts] Error updating contact:', err);
    throw new Error(message);
  }
}
