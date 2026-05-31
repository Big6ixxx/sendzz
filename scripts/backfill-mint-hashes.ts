import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { createPublicClient, http, parseAbiItem } from 'viem';
import { base } from 'viem/chains';

// ─── Environment Loader ───────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf8');
    env.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const index = trimmed.indexOf('=');
      if (index === -1) return;
      const key = trimmed.slice(0, index).trim();
      let val = trimmed.slice(index + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    });
    console.log('[Env] Loaded environmental variables from .env successfully.');
  } else {
    console.warn('[Env] No .env file found in workspace root.');
  }
}

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || 'https://mainnet.base.org';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('[Error] Missing Supabase configuration. Please ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.');
  process.exit(1);
}

// Initialize Supabase admin client (bypasses RLS policies)
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Initialize Base Public Client via viem
const publicClient = createPublicClient({
  chain: base,
  transport: http(rpcUrl),
});

// CCTP Domains Mapping
const CCTP_DOMAINS: Record<string, number> = {
  ethereum: 0,
  avalanche: 1,
  optimism: 2,
  arbitrum: 3,
  solana: 5,
  base: 6,
  polygon: 7,
  stellar: 27,
};

const MESSAGE_TRANSMITTER_ADDRESS = '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64';
const MESSAGE_RECEIVED_EVENT = parseAbiItem(
  'event MessageReceived(address indexed caller, uint32 sourceDomain, uint64 indexed nonce, bytes32 indexed sender, bytes32 messageBody)'
);

// ─── Block Estimation Helper ──────────────────────────────────────────────────
async function getBlockNumberForTimestamp(
  targetTimestamp: number,
  latestBlockNumber: bigint,
  latestBlockTimestamp: number
): Promise<bigint> {
  const blockTime = 2; // Base produces blocks precisely every 2 seconds
  const timeDifference = latestBlockTimestamp - targetTimestamp;
  const estimatedBlockDiff = BigInt(Math.floor(timeDifference / blockTime));
  let estimatedBlock = latestBlockNumber - estimatedBlockDiff;

  if (estimatedBlock < 1n) estimatedBlock = 1n;

  try {
    const block = await publicClient.getBlock({ blockNumber: estimatedBlock });
    const blockTimestamp = Number(block.timestamp);
    const drift = blockTimestamp - targetTimestamp;
    const driftBlocks = BigInt(Math.floor(drift / blockTime));
    let correctedBlock = estimatedBlock - driftBlocks;
    if (correctedBlock < 1n) correctedBlock = 1n;
    return correctedBlock;
  } catch (e) {
    return estimatedBlock;
  }
}

// ─── Main Backfill Processor ─────────────────────────────────────────────────
async function run() {
  console.log('\n🚀 Starting CCTP Mint Hash Backfill Scanner...\n');

  // Fetch latest block data on Base to perform time-drift calculations
  console.log('[RPC] Fetching latest block from Base...');
  const latestBlock = await publicClient.getBlock({ blockTag: 'latest' });
  const latestBlockNumber = latestBlock.number;
  const latestBlockTimestamp = Number(latestBlock.timestamp);
  console.log(`[RPC] Base height: ${latestBlockNumber} | Block time: ${new Date(latestBlockTimestamp * 1000).toISOString()}`);

  // Query all bridge transactions that do not have a mint transaction hash
  console.log('[Supabase] Fetching bridge transactions with missing mint hashes...');
  const { data: bridges, error: dbError } = await supabase
    .from('bridge_transactions')
    .select('*')
    .or('mint_tx_hash.is.null,mint_tx_hash.eq.');

  if (dbError) {
    console.error('[Supabase] Failed to fetch bridge transactions:', dbError);
    process.exit(1);
  }

  if (!bridges || bridges.length === 0) {
    console.log('✅ All bridge transactions already have valid mint transaction hashes! No backfill needed.');
    process.exit(0);
  }

  console.log(`🔍 Found ${bridges.length} bridge transaction(s) requiring backfill.\n`);

  for (const b of bridges) {
    console.log(`─── Processing Bridge [${b.id.slice(0, 8)}] ───`);
    console.log(`• Source Chain: ${b.source_chain.toUpperCase()}`);
    console.log(`• Amount: ${b.amount} USDC`);
    console.log(`• Burn Hash: ${b.burn_tx_hash}`);
    console.log(`• Created At: ${b.created_at}`);

    const domain = CCTP_DOMAINS[b.source_chain.toLowerCase()];
    if (domain === undefined) {
      console.log(`⚠️ Unsupported source chain "${b.source_chain}". Skipping.`);
      continue;
    }

    try {
      // 1. Query Circle Iris API for message details and attestation
      console.log(`• [Iris] Querying Circle for CCTP message bytes...`);
      const irisRes = await fetch(`https://iris-api.circle.com/v2/messages/${domain}?transactionHash=${b.burn_tx_hash}`);
      
      if (!irisRes.ok) {
        console.log(`⚠️ Iris API returned error: ${irisRes.statusText}. Attestation might be pending. Skipping.`);
        continue;
      }

      const irisData = await irisRes.json() as {
        messages?: {
          status: string;
          attestation?: string;
          message?: string;
          forwardTxHash?: string;
        }[];
      };
      
      const message = irisData.messages?.[0];
      if (!message || message.status !== 'complete') {
        console.log(`• [Iris] Attestation status is pending/incomplete. Skipping.`);
        continue;
      }

      console.log('• [Iris] Attestation status is complete!');

      // Check if EVM forwardTxHash is already provided by Circle
      let mintTxHash = message.forwardTxHash;
      if (mintTxHash && mintTxHash.startsWith('0x') && mintTxHash.length === 66) {
        console.log(`• [Iris] Found relay transaction hash: ${mintTxHash}`);
      } else {
        // 2. Parse CCTP message bytes to extract nonce and sourceDomain
        if (!message.message) {
          console.log('⚠️ Complete status but no CCTP message payload returned. Skipping.');
          continue;
        }

        const messageBytes = message.message.startsWith('0x') ? message.message : '0x' + message.message;
        
        // CCTP message hex layout:
        // sourceDomain: chars 10..17 (4 bytes)
        // nonce       : chars 26..41 (8 bytes)
        const sourceDomainHex = messageBytes.slice(10, 18);
        const nonceHex = messageBytes.slice(26, 42);

        const sourceDomain = parseInt(sourceDomainHex, 16);
        const nonce = BigInt('0x' + nonceHex);

        console.log(`• [CCTP] Decoded message: sourceDomain = ${sourceDomain} | nonce = ${nonce.toString()}`);

        // 3. Search Base logs for matching MessageReceived event
        const targetTimestamp = Math.floor(new Date(b.created_at).getTime() / 1000);
        console.log(`• [RPC] Estimating block height at timestamp ${targetTimestamp}...`);
        const targetBlock = await getBlockNumberForTimestamp(targetTimestamp, latestBlockNumber, latestBlockTimestamp);
        
        // Define block search window around estimated target block
        const fromBlock = targetBlock - 2000n < 1n ? 1n : targetBlock - 2000n;
        const toBlock = targetBlock + 60000n > latestBlockNumber ? latestBlockNumber : targetBlock + 60000n;
        console.log(`• [RPC] Searching Base block range [${fromBlock.toString()} -> ${toBlock.toString()}] for CCTP events...`);

        // Perform chunked getLogs queries to satisfy RPC range limits (2000 blocks per chunk)
        const chunk = 2000n;
        for (let current = fromBlock; current < toBlock; current += chunk) {
          const chunkEnd = current + chunk > toBlock ? toBlock : current + chunk;
          
          const logs = await publicClient.getLogs({
            address: MESSAGE_TRANSMITTER_ADDRESS,
            event: MESSAGE_RECEIVED_EVENT,
            args: {
              nonce: nonce,
            },
            fromBlock: current,
            toBlock: chunkEnd,
          });

          // Verify that the non-indexed sourceDomain matches our burn source
          const matchedLog = logs.find(log => log.args.sourceDomain === sourceDomain);
          if (matchedLog) {
            mintTxHash = matchedLog.transactionHash;
            console.log(`🎉 [Success] Found matching Base mint transaction on-chain: ${mintTxHash}`);
            break;
          }
        }
      }

      // 4. Update the record in Supabase with the confirmed mint hash
      if (mintTxHash && mintTxHash.startsWith('0x')) {
        console.log(`• [Supabase] Updating bridge transaction record...`);
        const { error: updateError } = await supabase
          .from('bridge_transactions')
          .update({
            attestation_status: 'complete',
            mint_tx_hash: mintTxHash,
            updated_at: new Date().toISOString(),
          })
          .eq('id', b.id);

        if (updateError) {
          console.error(`⚠️ Failed to update database record for ${b.id}:`, updateError);
        } else {
          console.log(`✅ Bridge completed and mint_tx_hash saved successfully!`);
        }
      } else {
        console.log('⚠️ Base mint transaction could not be located on-chain. It might not be claimed yet.');
      }

    } catch (err) {
      console.error(`⚠️ Critical error processing transaction ${b.id}:`, err);
    }
    console.log('');
  }

  console.log('🏁 Backfill scanner completed successfully.');
}

run().catch((err) => {
  console.error('[Fatal] Runner failed:', err);
  process.exit(1);
});
