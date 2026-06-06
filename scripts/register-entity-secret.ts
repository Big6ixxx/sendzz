import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { registerEntitySecretCiphertext } from "@circle-fin/developer-controlled-wallets";
import { loadEnvConfig } from "@next/env";

const baseDir = path.resolve(__dirname, "..");

// Load environment variables using Next.js config loader
loadEnvConfig(baseDir);

async function main() {
  const apiKey: string | undefined = process.env.CIRCLE_API_KEY;
  if (!apiKey) {
    throw new Error("CIRCLE_API_KEY is required. Set it in .env first.");
  }

  const envPath = path.join(baseDir, ".env");

  // Refuse to overwrite an existing entity secret in .env.
  const existingEnv: string = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, "utf8")
    : "";
  if (/^CIRCLE_ENTITY_SECRET=/m.test(existingEnv)) {
    throw new Error(
      "CIRCLE_ENTITY_SECRET already exists in .env. Refusing to overwrite it.",
    );
  }

  // Generate a 32-byte entity secret. The SDK's generateEntitySecret() helper
  // prints to stdout but doesn't return the value, so use crypto directly.
  const entitySecret: string = crypto.randomBytes(32).toString("hex");
  const recoveryDirectory: string = path.join(baseDir, "recovery");


  fs.mkdirSync(recoveryDirectory, { recursive: true });

  await registerEntitySecretCiphertext({
    apiKey,
    entitySecret,
    recoveryFileDownloadPath: recoveryDirectory,
  });

  // For production, prefer a secrets manager over .env.
  fs.appendFileSync(envPath, `\nCIRCLE_ENTITY_SECRET=${entitySecret}\n`);

  console.log("Entity secret registered.");
  console.log(`Recovery file saved inside directory: ${recoveryDirectory}`);
  console.log("CIRCLE_ENTITY_SECRET added to .env");
}

main().catch((err) => {
  console.error("Failed to register entity secret:", err);
  process.exit(1);
});