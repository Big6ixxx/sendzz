import { Database } from '@/types/database';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const supabaseAdmin = createClient<Database>(
  supabaseUrl,
  supabaseServiceRole,
);
