'use server';


import { supabaseAdmin } from './adminClient';

export type BankContactRow = {
  id: string;
  user_id: string;
  bank_name: string;
  bank_code: string;
  account_number: string;
  account_name: string;
  created_at: string;
};

async function resolveUserId(userEmail: string): Promise<string> {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', userEmail.toLowerCase())
    .single();
  if (!user) throw new Error('User not found');
  return user.id;
}

export async function getUserBankContacts(userEmail: string): Promise<BankContactRow[]> {
  try {
    const userId = await resolveUserId(userEmail);

    const { data, error } = await supabaseAdmin
      .from('bank_contacts')
      .select('*')
      .eq('user_id', userId)
      .order('account_name', { ascending: true });

    if (error) {
      // If table doesn't exist yet, we return empty to avoid crashes during development
      if (error.code === '42P01') {
        console.warn('[BankContacts] Table bank_contacts does not exist. Returning empty list.');
        return [];
      }
      console.error('[BankContacts] Failed to fetch:', error.message);
      return [];
    }
    return (data as BankContactRow[]) || [];
  } catch (err) {
    console.error('[BankContacts] Error fetching contacts:', err);
    return [];
  }
}

export async function addBankContact(params: {
  userEmail: string;
  bankName: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
}): Promise<{ success: true }> {
  try {
    const userId = await resolveUserId(params.userEmail);

    const { error } = await supabaseAdmin.from('bank_contacts').insert({
      user_id: userId,
      bank_name: params.bankName,
      bank_code: params.bankCode,
      account_number: params.accountNumber,
      account_name: params.accountName,
    });

    if (error) {
      if (error.code === '23505') throw new Error('Bank account already exists in your list.');
      throw new Error(error.message);
    }
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add bank contact';
    console.error('[BankContacts] Error adding contact:', err);
    throw new Error(message);
  }
}

export async function deleteBankContact(
  userEmail: string,
  contactId: string,
): Promise<{ success: true }> {
  try {
    const userId = await resolveUserId(userEmail);

    const { error } = await supabaseAdmin
      .from('bank_contacts')
      .delete()
      .match({ id: contactId, user_id: userId });

    if (error) throw new Error(error.message);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete bank contact';
    console.error('[BankContacts] Error deleting contact:', err);
    throw new Error(message);
  }
}
