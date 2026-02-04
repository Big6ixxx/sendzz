/**
 * Supabase Browser Client
 *
 * Creates a Supabase client for use in browser/client components.
 */

import type { Database } from '@/types/database';
import { createBrowserClient } from '@supabase/ssr';

let browserClient: ReturnType<typeof createBrowserClient<Database>> | null =
  null;

/**
 * Get or create a Supabase browser client (singleton)
 */
export function getSupabaseBrowserClient() {
  if (!browserClient) {
    browserClient = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return browserClient;
}

/**
 * Create a new Supabase browser client (for cases where you need a fresh instance)
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
