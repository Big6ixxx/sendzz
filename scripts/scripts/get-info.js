const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');
require('dotenv').config({ path: '.env.local' });

const client = initiateDeveloperControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY,
  entitySecret: process.env.ENTITY_SECRET,
});

async function run() {
  console.log("🔍 Searching for your wallet info...");
  try {
    const res = await client.listWallets();
    const wallet = res.data.wallets[0];
    if (wallet) {
      console.log("\n🎯 FOUND IT!");
      console.log("Wallet ID: ", wallet.id);
      console.log("Address:   ", wallet.address);
    } else {
      console.log("No wallet found. You might need to run the create-treasury script.");
    }
  } catch (e) { console.error("Error:", e.message); }
}
run();