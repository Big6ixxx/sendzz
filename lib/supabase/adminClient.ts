/**
 * The service-role Supabase client. SERVER ONLY.
 *
 * This key bypasses row-level security entirely — it is the credential every guard in the
 * schema is written to keep away from users. It has no NEXT_PUBLIC prefix, so Next does not
 * inline it into a client bundle, and the key itself is therefore not leaked by an accidental
 * import. What happens instead is worse in a different way: in the browser the variable
 * resolves to an empty string, `createClient` throws at module evaluation, and the page dies
 * before it renders — for everyone, signed in or not.
 *
 * That is not hypothetical. A client-side referral helper imported a module that imported this
 * one, and the landing page threw "supabaseKey is required" on every load. The message named
 * the symptom and nothing about the cause, which is what the guard below fixes: an accidental
 * import now says what is wrong and where to look.
 *
 * The rule: anything reaching for this module belongs in a route handler, a `'use server'`
 * action, or a plain server module. If a browser needs part of what a server module does,
 * split the pure part out — see lib/referrals/code-format.ts and lib/referrals/benefit-math.ts
 * for the shape.
 */
import { Database } from '@/types/database';
import { createClient } from '@supabase/supabase-js';

if (typeof window !== 'undefined') {
  throw new Error(
    'lib/supabase/adminClient is server-only and was imported into a browser bundle. ' +
      'Follow the import chain in the stack trace above: a client component or a "use client" ' +
      'module is reaching a server module. Split the pure part out rather than importing this.',
  );
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Checked here rather than left to `createClient`, whose "supabaseKey is required" says
// nothing about WHICH key or where it should have come from.
if (!supabaseServiceRole) {
  throw new Error(
    'SUPABASE_SERVICE_ROLE_KEY is not set. The server cannot read or write any user data ' +
      'without it — set it in the deployment environment.',
  );
}

export const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceRole);
