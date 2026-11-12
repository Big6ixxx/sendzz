import 'server-only';

import { getAddress } from 'viem';
import { supabaseAdmin } from './adminClient';
import { EVM_ADDRESS } from '@/lib/web3/recipient-key';

/**
 * The Sendzz account an on-chain address belongs to, if any.
 *
 * A send to a Sendzz user's wallet address is a transfer between two of our users, exactly as
 * one sent to their email is. Recorded with no recipient account, it was only half a transfer:
 * the sender saw "sent", the deposit scanner credited the same arrival to the recipient as a
 * deposit, and the ledger held one payment as two — doubling volume and showing each side a
 * different kind of transaction. Every duplicate check keys off `transfers.recipient_id`, so
 * filling it in is what makes the arrival a transfer for both of them.
 *
 * Matched the way the deposit webhook matches: an EVM address in both spellings (it is stored
 * checksummed, typed lowercase), Stellar and Solana exactly, since their case is part of the
 * address. Returns null for an address that is not ours, or when the lookup fails — the
 * transfer is then recorded as before, to an outside address.
 */
export async function accountForAddress(address: string): Promise<{ id: string; email: string } | null> {
  const value = address.trim();
  let column: 'smart_account_address' | 'stellar_address' | 'solana_address';
  let forms: string[];
  if (EVM_ADDRESS.test(value)) {
    column = 'smart_account_address';
    forms = [value.toLowerCase()];
    try {
      forms.push(getAddress(value));
    } catch {
      // Not a valid checksum form; the lowercase one is still worth asking for.
    }
  } else if (/^G[A-Z2-7]{55}$/.test(value)) {
    column = 'stellar_address';
    forms = [value];
  } else if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
    column = 'solana_address';
    forms = [value];
  } else {
    return null;
  }

  const { data, error } = await supabaseAdmin.from('users').select('id, email').in(column, forms).limit(2);
  if (error) {
    console.error(`[address-owner] lookup failed for ${value.slice(0, 10)}…: ${error.message}`);
    return null;
  }
  // Two accounts on one address would be a data problem; linking either would be a guess.
  return data?.length === 1 ? data[0] : null;
}
