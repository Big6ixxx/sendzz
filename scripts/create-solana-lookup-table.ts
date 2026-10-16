/**
 * Create the address lookup table a Solana CCTP claim is compiled against, once per cluster.
 *
 * A claim names 20 accounts. As a legacy transaction that is 1264 bytes against Solana's
 * 1232-byte limit, so every mainnet claim was refused before it was broadcast. This table holds
 * the accounts that are the same for every claim, letting a v0 transaction name each with a
 * one-byte index instead of a 32-byte key (lib/solana/lookup-table explains the rest).
 *
 *   npx tsx scripts/create-solana-lookup-table.ts            # report what it would do
 *   npx tsx scripts/create-solana-lookup-table.ts --apply    # create it, and print the env var
 *
 * Costs the fee payer a few thousandths of a SOL in rent and fees. The cluster, the USDC mint and
 * the RPC all follow NEXT_PUBLIC_SIMULATION_MODE, so run it once with your mainnet env and once
 * with your testnet env, and set SOLANA_CCTP_LOOKUP_TABLE separately in each.
 *
 * Re-runnable: pass an existing table as SOLANA_CCTP_LOOKUP_TABLE and it adds only what is
 * missing, which is how a newly supported source chain gets its two accounts in.
 */
import * as path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { createTransactionSigner } from '@circle-fin/developer-controlled-wallets/solana/web3';
import {
  AddressLookupTableProgram,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';

loadEnvConfig(path.resolve(__dirname, '..'));

const APPLY = process.argv.includes('--apply');

/** Addresses per extend instruction. Each is 32 bytes, and the transaction must still fit. */
const PER_EXTEND = 20;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required. Set it in .env first.`);
  return value;
}

async function main() {
  // Imported here rather than at the top so a missing env var is reported by `required` below,
  // not by a module reading it as it loads.
  const { solanaClaimLookupAddresses } = await import('@/lib/circle/solana-gateway');
  const { solanaRpcUrl } = await import('@/lib/solana/rpc');
  const { LOOKUP_TABLE_ENV } = await import('@/lib/solana/lookup-table');
  const { NETWORK } = await import('@/lib/network');

  const apiKey = required('CIRCLE_API_KEY');
  const entitySecret = required('CIRCLE_ENTITY_SECRET');
  const feePayer = new PublicKey(required('CIRCLE_SOLANA_FEEPAYER_ADDRESS'));

  const connection = new Connection(solanaRpcUrl(), 'confirmed');
  console.log(`Cluster: ${NETWORK.solana.circleBlockchain}\nFee payer: ${feePayer.toBase58()}`);

  // The same signer lib/solana/circle-signer uses; imported directly because that module is
  // server-only and this runs in plain Node.
  const signer = createTransactionSigner({
    client: initiateDeveloperControlledWalletsClient({ apiKey, entitySecret }),
    address: feePayer,
    chain: NETWORK.solana.circleBlockchain,
  });

  const wanted = await solanaClaimLookupAddresses(connection);
  console.log(`${wanted.length} address(es) belong in the table.`);

  /** Sign with the fee payer, send, and wait. */
  const send = async (instructions: TransactionInstruction[]) => {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const tx = new VersionedTransaction(
      new TransactionMessage({ payerKey: feePayer, recentBlockhash: blockhash, instructions }).compileToV0Message(),
    );
    const signed = await signer.signTransaction(tx);
    const signature = await connection.sendRawTransaction(signed.serialize(), {
      preflightCommitment: 'confirmed',
    });
    const result = await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed',
    );
    if (result.value.err) throw new Error(`${signature} failed: ${JSON.stringify(result.value.err)}`);
    console.log(`  ✓ ${signature}`);
  };

  // An existing table is extended rather than replaced, so the env var stays valid.
  const existing = process.env[LOOKUP_TABLE_ENV];
  let tableKey: PublicKey | null = existing ? new PublicKey(existing) : null;
  let held: PublicKey[] = [];

  if (tableKey) {
    const { value } = await connection.getAddressLookupTable(tableKey);
    if (!value) throw new Error(`${LOOKUP_TABLE_ENV} is set to ${existing}, which does not exist here.`);
    if (!value.state.authority?.equals(feePayer)) {
      throw new Error(`${existing} is not controlled by this fee payer, so it cannot be extended.`);
    }
    held = value.state.addresses;
    console.log(`Reusing ${existing} (holds ${held.length}).`);
  }

  const heldSet = new Set(held.map((a) => a.toBase58()));
  const missing = wanted.filter((a) => !heldSet.has(a.toBase58()));

  if (!tableKey && !APPLY) {
    console.log(`\nWould create a table and add ${missing.length} address(es).`);
  } else if (missing.length === 0) {
    console.log('\nNothing missing. The table is already complete.');
  } else if (!APPLY) {
    console.log(`\nWould add ${missing.length} missing address(es).`);
  }
  if (!APPLY) {
    console.log('Report only. Re-run with --apply to make the changes.');
    return;
  }

  if (!tableKey) {
    const slot = await connection.getSlot('finalized');
    const [createIx, created] = AddressLookupTableProgram.createLookupTable({
      authority: feePayer,
      payer: feePayer,
      recentSlot: slot,
    });
    console.log(`Creating ${created.toBase58()}…`);
    await send([createIx]);
    tableKey = created;
  }

  for (let i = 0; i < missing.length; i += PER_EXTEND) {
    const chunk = missing.slice(i, i + PER_EXTEND);
    console.log(`Adding ${chunk.length} address(es)…`);
    await send([
      AddressLookupTableProgram.extendLookupTable({
        lookupTable: tableKey,
        authority: feePayer,
        payer: feePayer,
        addresses: chunk,
      }),
    ]);
  }

  // A table is only usable from the slot after the one it was extended in.
  console.log('\nDone. Set this, then redeploy:');
  console.log(`\n  ${LOOKUP_TABLE_ENV}="${tableKey.toBase58()}"\n`);
  console.log('A table becomes usable one slot after it is extended, so wait a few seconds.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
