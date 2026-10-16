/**
 * Check every stored `users.solana_address` against Privy, and optionally repair it.
 *
 * Until registration verified it, `solana_address` was whatever the client sent. It is what
 * Solana sends are verified against, where refunds go, and what deposit scanning credits — so a
 * row pointing at somebody else's wallet is worth finding before Solana is switched back on.
 * New writes are already checked (lib/supabase/users.ts); this covers the rows written before.
 *
 *   npx tsx scripts/verify-solana-addresses.ts           # report only (the default)
 *   npx tsx scripts/verify-solana-addresses.ts --apply   # rewrite mismatches
 *
 * With --apply, a mismatched row is set to the user's Privy Solana wallet when they have exactly
 * one, and cleared when they have none. A user with several is reported and left alone: picking
 * one is a decision, not a repair.
 */
import * as path from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { PrivyClient } from "@privy-io/node";

loadEnvConfig(path.resolve(__dirname, ".."));

const APPLY = process.argv.includes("--apply");
const PAGE = 500;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required. Set it in .env first.`);
  return value;
}

async function main() {
  const supabase = createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
  );
  const privy = new PrivyClient({
    appId: required("NEXT_PUBLIC_PRIVY_APP_ID"),
    appSecret: required("PRIVY_APP_SECRET"),
  });

  let checked = 0;
  let ok = 0;
  const problems: { email: string; stored: string; privy: string[]; action: string }[] = [];

  for (let from = 0; ; from += PAGE) {
    const { data: rows, error } = await supabase
      .from("users")
      .select("id, email, solana_address")
      .not("solana_address", "is", null)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read users: ${error.message}`);
    if (!rows?.length) break;

    for (const row of rows) {
      checked++;
      let wallets: string[];
      try {
        const user = await privy.users().getByEmailAddress({ address: row.email });
        wallets = user.linked_accounts
          .filter(
            (a) =>
              a.type === "wallet" &&
              "chain_type" in a &&
              a.chain_type === "solana" &&
              "wallet_client_type" in a &&
              a.wallet_client_type === "privy",
          )
          .map((a) => (a as { address: string }).address);
      } catch (err) {
        problems.push({
          email: row.email,
          stored: row.solana_address,
          privy: [],
          action: `skipped — Privy lookup failed (${(err as Error).message})`,
        });
        continue;
      }

      if (wallets.includes(row.solana_address)) {
        ok++;
        continue;
      }

      let action: string;
      let next: string | null | undefined;
      if (wallets.length === 1) {
        next = wallets[0];
        action = `set to ${next}`;
      } else if (wallets.length === 0) {
        next = null;
        action = "cleared (no Privy Solana wallet)";
      } else {
        action = "left alone — several Privy Solana wallets, pick one by hand";
      }

      if (APPLY && next !== undefined) {
        const { error: updateError } = await supabase
          .from("users")
          .update({ solana_address: next })
          .eq("id", row.id);
        if (updateError) action = `FAILED to update: ${updateError.message}`;
      } else if (next !== undefined) {
        action = `would be ${action}`;
      }

      problems.push({ email: row.email, stored: row.solana_address, privy: wallets, action });
    }

    if (rows.length < PAGE) break;
  }

  console.log(`Checked ${checked} stored Solana address(es): ${ok} match Privy.`);
  for (const p of problems) {
    console.log(`- ${p.email}: stored ${p.stored}, Privy [${p.privy.join(", ")}] → ${p.action}`);
  }
  if (!APPLY && problems.length) console.log("\nReport only. Re-run with --apply to rewrite.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
