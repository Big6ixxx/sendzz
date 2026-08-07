import { Database } from '@/types/database';
import { createClient } from '@supabase/supabase-js';
import { guardSupabaseWrites } from './network-guard';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/**
 * Service-role client — bypasses RLS, so it is exactly the client that must not be
 * allowed to write testnet rows into production. See `network-guard`.
 */
export const supabaseAdmin = guardSupabaseWrites(
  createClient<Database>(supabaseUrl, supabaseServiceRole),
);
