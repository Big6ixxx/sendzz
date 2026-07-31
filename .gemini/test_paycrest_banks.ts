import dotenv from "dotenv";
dotenv.config();

import { getPaycrestClient } from "../lib/paycrest/client";

async function test() {
  const client = getPaycrestClient();
  
  console.log("\n--- Testing Kenya Commercial Bank (KCBLKENX) ---");
  try {
    const res1 = await client.verifyAccount("KCBLKENX", "1101234567", "KES");
    console.log("KCB Result:", res1);
  } catch (e: any) {
    console.log("KCB Error:", e.message);
  }

  console.log("\n--- Testing Equity Bank Kenya (EQBLKENA) ---");
  try {
    const res2 = await client.verifyAccount("EQBLKENA", "0110123456789", "KES");
    console.log("Equity Result:", res2);
  } catch (e: any) {
    console.log("Equity Error:", e.message);
  }

  console.log("\n--- Testing Nigeria Access Bank (044) ---");
  try {
    const res3 = await client.verifyAccount("044", "0690000032", "NGN");
    console.log("Access Bank Result:", res3);
  } catch (e: any) {
    console.log("Access Bank Error:", e.message);
  }
}

test();
