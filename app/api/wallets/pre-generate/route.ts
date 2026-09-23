import { writeUserAddresses } from '@/lib/supabase/user-records';
import { getVerifiedIdentity } from '@/lib/auth/session';
import { redactEmail } from '@/lib/log';
import { computeCircleSmartAddress } from '@/lib/web3/circle-client';
import { LinkedAccountEmbeddedWallet, PrivyClient } from '@privy-io/node';
import { NextResponse } from 'next/server';
import {
  RATE_LIMITS,
  checkRateLimit,
  rateLimitResponse,
} from '@/lib/security/rate-limit';

const privy = new PrivyClient({
  appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID || '',
  appSecret: process.env.PRIVY_APP_SECRET || '',
});

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // ── The CALLER must be signed in; the email is the RECIPIENT ────────────
    //
    // Unusually for this codebase the email here is legitimately somebody else's: this creates
    // a wallet for a person who has never used Sendzz, so that money can be sent to them
    // before they sign up. What it must not be is anonymous — creating a Privy user and an
    // on-chain account on every call is expensive, and unauthenticated it is a free way to
    // make us do that forever, or to pre-create wallets against addresses somebody controls.
    //
    // The sender is always signed in at this point, so requiring a session costs the real
    // flow nothing.
    const identity = await getVerifiedIdentity();
    if (!identity) {
      return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
    }

    // Every call creates a Privy user and derives an address. A signed-in account should not be
    // able to make us do that without limit.
    {
      const limit = await checkRateLimit(RATE_LIMITS.walletCreate, identity.email);
      if (!limit.allowed) return rateLimitResponse(limit);
    }

    // 1. Create a "shell" user in Privy for this email
    console.log(`[JIT Wallet] Creating Privy user for: ${redactEmail(email)}`);
    const user = await privy.users().create({
      linked_accounts: [{ type: 'email', address: email }],
      wallets: [{ chain_type: 'ethereum' }],
    });

    const embeddedWallet = user.linked_accounts.find(
      (a) => a.type === 'wallet' && a.wallet_client_type === 'privy',
    ) as LinkedAccountEmbeddedWallet | undefined;

    if (!embeddedWallet?.address) {
      throw new Error('Failed to generate Privy embedded wallet');
    }

    const privyEoaAddress = embeddedWallet.address;
    console.log(`[JIT Wallet] Privy EOA generated: ${privyEoaAddress}`);

    // 2. Deterministically compute the Circle Smart Account Address
    const smartAccountAddress =
      await computeCircleSmartAddress(privyEoaAddress);
    console.log(
      `[JIT Wallet] Computed Circle Smart Account: ${smartAccountAddress}`,
    );

    // 3. Register it in our Supabase DB
    await writeUserAddresses(email, { smartAccountAddress });

    return NextResponse.json({
      success: true,
      address: smartAccountAddress,
      eoaAddress: privyEoaAddress,
    });
  } catch (error) {
    console.error('[JIT Wallet] Error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Internal Server Error' },
      { status: 500 },
    );
  }
}
