import { registerUserAddress } from '@/lib/supabase/users';
import { computeCircleSmartAddress } from '@/lib/web3/circle-client';
import { LinkedAccountEmbeddedWallet, PrivyClient } from '@privy-io/node';
import { NextResponse } from 'next/server';

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

    // 1. Create a "shell" user in Privy for this email
    console.log(`[JIT Wallet] Creating Privy user for: ${email}`);
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
    await registerUserAddress(email, smartAccountAddress);

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
