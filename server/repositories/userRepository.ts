/**
 * User Repository
 *
 * Database operations for user profiles.
 */

import { createAdminClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

type UserProfile = Database['public']['Tables']['user_profiles']['Row'];
type UserProfileInsert =
  Database['public']['Tables']['user_profiles']['Insert'];
type UserProfileUpdate =
  Database['public']['Tables']['user_profiles']['Update'];

/**
 * Find user profile by ID
 */
export async function findUserById(
  userId: string,
): Promise<UserProfile | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('[UserRepo] findById error:', error);
    return null;
  }
  return data;
}

/**
 * Find user profile by email
 */
export async function findUserByEmail(
  email: string,
): Promise<UserProfile | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (error) {
    console.error('[UserRepo] findByEmail error:', error);
    return null;
  }
  return data;
}

/**
 * Check if user exists by email
 */
export async function userExistsByEmail(email: string): Promise<boolean> {
  const user = await findUserByEmail(email);
  return user !== null;
}

/**
 * Create or update user profile
 * Note: The trigger `handle_new_user` auto-creates profiles on auth signup,
 * but this can be used for manual creation or updates.
 */
export async function upsertUser(
  userId: string,
  data: Partial<UserProfileInsert>,
): Promise<UserProfile | null> {
  const supabase = createAdminClient();
  const { data: profile, error } = await supabase
    .from('user_profiles')
    .upsert({ id: userId, ...data } as UserProfileInsert, { onConflict: 'id' })
    .select()
    .single();

  if (error) {
    console.error('[UserRepo] upsert error:', error);
    return null;
  }
  return profile;
}

/**
 * Update user profile
 */
export async function updateUser(
  userId: string,
  data: UserProfileUpdate,
): Promise<UserProfile | null> {
  const supabase = createAdminClient();
  const { data: profile, error } = await supabase
    .from('user_profiles')
    .update(data)
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    console.error('[UserRepo] update error:', error);
    return null;
  }
  return profile;
}

/**
 * Mark onboarding as complete
 */
export async function markOnboardingComplete(userId: string): Promise<boolean> {
  const result = await updateUser(userId, { onboarding_completed: true });
  return result !== null;
}
