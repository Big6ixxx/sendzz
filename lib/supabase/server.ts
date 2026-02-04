/**
 * Supabase Server Client
 *
 * Creates a Supabase client for use in server components and API routes.
 */

import type { Database } from '@/types/database';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Create a Supabase client for server-side use (respects RLS)
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    },
  );
}

/**
 * Create a Supabase admin client (bypasses RLS)
 * USE WITH CAUTION - only for server-side operations that need elevated permissions
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  }

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {
          // No-op for admin client
        },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
