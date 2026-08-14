'use server';

import { Database } from '@/types/database';
import { requireUserId } from '@/lib/auth/session';
import { supabaseAdmin } from './adminClient';

export type ContactRow = Database['public']['Tables']['contacts']['Row'];

/**
 * The signed-in user's own id. Replaces a lookup that took an email from the caller — these
 * are POST endpoints, so that let anyone read or edit another person's saved contacts (and,
 * for bank contacts, their account numbers) by naming their address.
 */
async function resolveSelfId(accessToken?: string): Promise<string> {
  const { userId } = await requireUserId(accessToken);
  return userId;
}

export async function getUserContacts(accessToken?: string): Promise<ContactRow[]> {
  try {
    const userId = await resolveSelfId(accessToken);

    const { data, error } = await supabaseAdmin
      .from('contacts')
      .select('*')
      .eq('user_id', userId)
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
  accessToken?: string;
  contactEmail: string;
  contactName: string;
  avatarUrl?: string;
}): Promise<{ success: true }> {
  try {
    const userId = await resolveSelfId(params.accessToken);

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
  contactId: string,
  accessToken?: string,
): Promise<{ success: true }> {
  try {
    const userId = await resolveSelfId(accessToken);

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
  accessToken?: string;
  contactId: string;
  contactEmail: string;
  contactName: string;
}): Promise<{ success: true }> {
  try {
    const userId = await resolveSelfId(params.accessToken);

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
