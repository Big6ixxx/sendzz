'use server'

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

export async function getUserAddressByEmail(email: string): Promise<string | null> {
  const supabase = createClient(supabaseUrl, supabaseServiceRole)
  const { data, error } = await supabase
    .from('users')
    .select('smart_account_address')
    .eq('email', email)
    .single()

  if (error || !data) return null
  return data.smart_account_address
}

export async function registerUserAddress(email: string, address: string) {
  const supabase = createClient(supabaseUrl, supabaseServiceRole)
  const { error } = await supabase
    .from('users')
    .upsert({ email, smart_account_address: address }, { onConflict: 'email' })
    
  if (error) throw new Error(`Failed to map address: ${error.message}`)
}
