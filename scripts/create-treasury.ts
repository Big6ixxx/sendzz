import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = initiateDeveloperControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY!,
  entitySecret: process.env.ENTITY_SECRET!,
});

async function createTreasury() {
  console.log("🏦 Creating your Treasury Wallet...");

  try {
    // 1. Create a "Wallet Set" (Like a folder for wallets)
    const walletSetResponse = await client.createWalletSet({
      name: 'Email App Treasury Set'
    });
    
    const walletSetId = walletSetResponse.data?.walletSet?.id;
    if (!walletSetId) throw new Error("Failed to create Wallet Set");
    console.log(`✅ Wallet Set Created! ID: ${walletSetId}`);

    // 2. Create the actual Wallet inside that set
    // We are using Ethereum Sepolia (Testnet) for this prototype
    const walletResponse = await client.createWallets({
      blockchains: ['ETH-SEPOLIA'],
      count: 1,
      walletSetId: walletSetId,
    });

    const wallet = walletResponse.data?.wallets?.[0];
    
    if (wallet) {
      console.log("\n🎉 TREASURY WALLET CREATED SUCCESSFULLY!");
      console.log("------------------------------------------------");
      console.log(`Wallet ID:   ${wallet.id}`);
      console.log(`Address:     ${wallet.address}`);
      console.log("------------------------------------------------");
      console.log("👉 ACTION REQUIRED: Copy the 'Wallet ID' above and paste it into your .env.local file!");
    }

  } catch (error) {
    console.error("❌ Failed to create wallet:", error);
  }
}

createTreasury();