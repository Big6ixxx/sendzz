import { registerEntitySecretCiphertext } from '@circle-fin/developer-controlled-wallets';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function register() {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.ENTITY_SECRET;

  if (!apiKey || !entitySecret) {
    console.error("❌ Error: CIRCLE_API_KEY or ENTITY_SECRET is missing in .env.local");
    process.exit(1);
  }

  console.log("🔐 Registering your Entity Secret with Circle...");

  try {
    // This is the specific function your SDK version uses
    const response = await registerEntitySecretCiphertext({
      apiKey: apiKey,
      entitySecret: entitySecret
    });

    console.log("\n✅ SUCCESS! Your Entity Secret is officially registered.");
    console.log("Recovery File Content (saved in memory):", response.data?.recoveryFile ? "Received" : "Check console");
    console.log("------------------------------------------------");
    console.log("NEXT STEP: Run the Treasury script to create your wallet!");
  } catch (error: any) {
    console.error("\n❌ Registration Failed:");
    console.error(error.response ? error.response.data : error.message);
    process.exit(1);
  }
}

register();
