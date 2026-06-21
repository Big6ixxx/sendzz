import { config } from 'dotenv';
config(); // Load environment variables from .env

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRole);

async function main() {
  const hash = '35d5b0ab401a17135ac2b524dbb4f2196918f140d673c4a4b433d374d5f0cbeb';
  console.log('Querying database for burn_tx_hash:', hash);

  const { data, error } = await supabaseAdmin
    .from('bridge_transactions')
    .select('*')
    .eq('burn_tx_hash', hash);

  if (error) {
    console.error('Error querying:', error);
  } else {
    console.log('Data found:', data);
  }
}

main().catch(console.error);
