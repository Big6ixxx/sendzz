import { sendNotificationEmail } from '../../lib/emailService';
import { NextResponse } from 'next/server';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { v4 as uuidv4 } from 'uuid';
import { supabase as adminSupabase } from '@/app/lib/supabaseClient';
import { createClient } from '@/app/lib/utils/supabase/server'; 

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { email, amount } = await req.json();
    const treasuryWalletId = process.env.GATEWAY_WALLET_ID;

    const client = initiateDeveloperControlledWalletsClient({
      apiKey: process.env.CIRCLE_API_KEY!,
      entitySecret: process.env.ENTITY_SECRET!,
    });

    // --- 🔍 DEBUG: Check what tokens this wallet actually has ---
    console.log(`🔎 Checking balances for wallet: ${treasuryWalletId}`);
    const balances = await client.getWalletTokenBalance({ id: treasuryWalletId! });
    const usdcToken = balances.data?.tokenBalances?.find(t => t.token.symbol === 'USDC');
    
    if (!usdcToken) {
      console.error("❌ USDC not found in this wallet. Available tokens:", balances.data?.tokenBalances?.map(t => t.token.symbol));
      return NextResponse.json({ error: "USDC Token not found in Treasury" }, { status: 404 });
    }
    console.log(`✅ Found USDC. Using Token ID: ${usdcToken.token.id}`);

    let recipientAddress = "";
    const { data: existingUser } = await adminSupabase.from('users').select('*').eq('email', email).maybeSingle(); 

    if (existingUser) {
      recipientAddress = existingUser.evm_address;
    } else {
      const walletSet = await client.createWalletSet({ name: `User: ${email}` });
      const wallets = await client.createWallets({
        accountType: 'SCA',
        blockchains: ['ETH-SEPOLIA'], 
        count: 1,
        walletSetId: walletSet.data!.walletSet!.id,
      });
      recipientAddress = wallets.data!.wallets![0].address;
      await adminSupabase.from('users').insert([{ email, wallet_id: wallets.data!.wallets![0].id, evm_address: recipientAddress }]);
    }

    // --- 💸 EXECUTION ---
    console.log(`💸 Sending ${amount} USDC to ${recipientAddress}...`);
    const response = await client.createTransaction({
      walletId: treasuryWalletId!,
      tokenId: usdcToken.token.id, // Using the ID we just found dynamically
      amount: [amount.toString()],
      destinationAddress: recipientAddress,
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
      idempotencyKey: uuidv4(),
    });

    // --- 📊 LOG TO HISTORY ---
    await adminSupabase.from('transactions').insert([{
      sender_id: user.id,
      recipient_email: email,
      amount: parseFloat(amount),
      tx_id: response.data!.id,
      status: 'complete'
    }]);

    await sendNotificationEmail(email, amount.toString(), response.data!.id);
    return NextResponse.json({ success: true, txId: response.data!.id });

  } catch (error: any) {
    console.error("❌ Circle API Error Details:", error.response?.data || error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}