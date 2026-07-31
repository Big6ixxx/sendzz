import dotenv from "dotenv";
dotenv.config();

import crypto from "crypto";

const clientId = process.env.BITNOB_CLIENT_ID || "4c755503-ae7d-44f1-9dc6-1591cccab19a";
const apiKey = process.env.BITNOB_API_KEY || "live_d8a5bb16ca9c53f12f4bef7028d03e603ee5b99b4598a0f4576b8a0b75f93097";
const baseUrl = "https://api.bitnob.com";

async function testBitnobLookup() {
  console.log("\n--- Testing Bitnob Account Lookup ---");
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString("hex");
  const body = JSON.stringify({
    bank_code: "SAFAKEPC",
    account_number: "0716881025",
    country: "KE"
  });
  const signature = crypto.createHmac("sha256", apiKey).update(`${clientId}:${ts}:${nonce}:${body}`).digest("hex");

  try {
    const res = await fetch(`${baseUrl}/api/payouts/account-lookup`, {
      method: "POST",
      headers: {
        "x-auth-client": clientId,
        "x-auth-timestamp": ts,
        "x-auth-nonce": nonce,
        "x-auth-signature": signature,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body
    });
    console.log("Status Bitnob Lookup:", res.status);
    const text = await res.text();
    console.log("Response Bitnob Lookup:", text);
  } catch (err: any) {
    console.log("Error Bitnob Lookup:", err.message);
  }
}

testBitnobLookup();
