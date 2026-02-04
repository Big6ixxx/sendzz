/**
 * Supabase Module
 *
 * Centralized exports for Supabase functionality.
 */

export {
    createSupabaseBrowserClient, getSupabaseBrowserClient
} from './client';
export { updateSession } from './middleware';
export { createAdminClient, createClient } from './server';

