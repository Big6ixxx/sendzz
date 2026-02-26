/**
 * User Wallet API Route
 *
 * GET /api/user/wallet
 * Returns the user's Solana deposit address and wallet info.
 */

import { createClient } from '@/lib/supabase/server';
import { createUserWallet, getUserWalletAddress } from '@/server/services';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Try to get existing wallet address
    let { solanaAddress } = await getUserWalletAddress(user.id);

    // If no address exists, create one
    if (!solanaAddress) {
      const result = await createUserWallet(user.id, user.email);
      if (result.success) {
        solanaAddress = result.solanaAddress || null;
      }
    }

    return NextResponse.json({
      success: true,
      solanaAddress,
    });
  } catch (error) {
    console.error('[WalletAPI] Error:', error);
    return NextResponse.json(
      { error: 'Failed to get wallet info' },
      { status: 500 },
    );
  }
}
