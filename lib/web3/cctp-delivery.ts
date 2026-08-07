/**
 * "Has this CCTP message already been minted on the destination chain?"
 *
 * This is the question that decides whether we ask the user to sign a `receiveMessage`
 * or simply mark the bridge done. Getting it wrong is expensive: a message that has in
 * fact been delivered looks undelivered forever, so the UI keeps retrying a claim that
 * can only revert, and the transfer appears stuck even though the USDC arrived.
 *
 * The app previously asked `processedMessages(messageHash)` — a **CCTP V1** function.
 * On the V2 MessageTransmitter that call *reverts*, and every call site swallowed it
 * with `.catch(() => false)`, so the answer was always "not delivered".
 *
 * V2 tracks delivery by the message's own nonce: `usedNonces(nonce) != 0`.
 */

import type { PublicClient } from 'viem';
import { MESSAGE_TRANSMITTER_V2 } from '../circle/gateway';

/**
 * MessageTransmitterV2 — one CREATE2 address across every EVM chain in a network family.
 * Mainnet and testnet are different address sets; both live in `circle/gateway` so the
 * bridge and the delivery check can never disagree about which contract they mean.
 */
export const MESSAGE_TRANSMITTER_ADDRESS: string = MESSAGE_TRANSMITTER_V2;

/**
 * EVM destinations whose delivery state this module can read.
 *
 * Deliberately wider than the chains we let a user bridge *to*: a chain drops out of the
 * bridge UI long before its historical rows do, and a row we can't check gets treated as
 * undelivered forever. Arc belongs here for the opposite reason — it is the testnet home
 * chain, so it is the most common destination of all, and three separate copies of this
 * list had all omitted it. Keep this the single copy.
 */
export const EVM_CLAIM_CHAINS: string[] = [
  'arc',
  'base',
  'arbitrum',
  'optimism',
  'polygon',
  'avalanche',
  'ethereum',
];

export const USED_NONCES_ABI = [
  {
    name: 'usedNonces',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'nonce', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/**
 * Pull the 32-byte nonce out of a raw CCTP V2 message.
 *
 * Header layout (bytes): version(4) sourceDomain(4) destinationDomain(4) nonce(32) …
 * so the nonce starts at byte 12.
 */
export function extractCctpNonce(messageHex: string): `0x${string}` | null {
  const hex = messageHex.replace(/^0x/, '');
  if (hex.length < 24 + 64) return null;
  return `0x${hex.slice(24, 24 + 64)}` as `0x${string}`;
}

/**
 * MessageTransmitterV2's delivery event.
 *
 * The V1 shape — `MessageReceived(address, uint32, uint64, bytes32)` — hashes to a
 * different topic, so filtering on it silently matches nothing and every mint-hash
 * lookup comes back empty (which is what left receipts showing "N/A"). The nonce is
 * indexed here, so a lookup is an exact, cheap filter rather than a scan.
 */
const MESSAGE_RECEIVED_V2 = {
  name: 'MessageReceived',
  type: 'event',
  inputs: [
    { name: 'caller', type: 'address', indexed: true },
    { name: 'sourceDomain', type: 'uint32', indexed: false },
    { name: 'nonce', type: 'bytes32', indexed: true },
    { name: 'sender', type: 'bytes32', indexed: false },
    { name: 'finalityThresholdExecuted', type: 'uint32', indexed: true },
    { name: 'messageBody', type: 'bytes', indexed: false },
  ],
} as const;

/**
 * How far back to hunt for the delivery event.
 *
 * This was briefly dropped to 50 blocks because some public nodes cap `eth_getLogs` at a
 * 50-block span. That silently broke mint-hash recovery: 50 blocks is under two minutes
 * on most of these chains, so any claim not looked up almost immediately came back
 * "delivered, hash unknown" and the row was completed with a placeholder instead of a
 * real hash. The cap is a per-request span limit, not a history limit, so the fix is to
 * ask for a wide range first and fall back to walking it in cap-sized windows.
 */
const LOG_WIDE_LOOKBACK_BLOCKS = 10_000n;
const LOG_WINDOW_BLOCKS = 50n;
const LOG_WINDOW_ATTEMPTS = 40n; // 40 x 50 = 2,000 blocks when windowing is forced

/**
 * The transaction that minted this message on the destination chain, if we can find it.
 *
 * Returns undefined when the log range doesn't reach it or the RPC refuses the query —
 * callers should treat that as "delivered, hash unknown", never as "not delivered".
 */
export async function findMintTxHash(
  client: PublicClient,
  messageHex: string,
  transmitter: string = MESSAGE_TRANSMITTER_ADDRESS,
): Promise<string | undefined> {
  const nonce = extractCctpNonce(messageHex);
  if (!nonce) return undefined;

  const query = async (fromBlock: bigint, toBlock: bigint) => {
    const logs = await client.getLogs({
      address: transmitter as `0x${string}`,
      event: MESSAGE_RECEIVED_V2,
      args: { nonce },
      fromBlock,
      toBlock,
    });
    return logs[0]?.transactionHash;
  };

  let latest: bigint;
  try {
    latest = await client.getBlockNumber();
  } catch (err) {
    console.warn(`[CCTP/Delivery] Could not read block height: ${(err as Error).message}`);
    return undefined;
  }

  const floor = (n: bigint) => (latest > n ? latest - n : 0n);

  // One wide query first — most providers allow it, and it's a single round trip.
  try {
    const hash = await query(floor(LOG_WIDE_LOOKBACK_BLOCKS), latest);
    if (hash) {
      console.log(`[CCTP/Delivery] ✓ Found MessageReceivedV2 in wide scan. Tx: ${hash}`);
      return hash;
    }
  } catch {
    // Range rejected — walk it in cap-sized windows instead, newest first.
    for (let i = 0n; i < LOG_WINDOW_ATTEMPTS; i++) {
      const to = floor(i * LOG_WINDOW_BLOCKS);
      const from = floor((i + 1n) * LOG_WINDOW_BLOCKS);
      if (to === 0n) break;
      try {
        const hash = await query(from, to);
        if (hash) {
          console.log(`[CCTP/Delivery] ✓ Found MessageReceivedV2 in windowed scan. Tx: ${hash}`);
          return hash;
        }
      } catch (err) {
        console.warn(
          `[CCTP/Delivery] Window ${from}-${to} rejected: ${(err as Error).message}`,
        );
        return undefined;
      }
    }
  }

  console.warn('[CCTP/Delivery] No MessageReceivedV2 log found in the scanned range.');
  return undefined;
}

/**
 * True when the destination chain has already consumed this message's nonce.
 *
 * Returns false if the nonce can't be read — an unreachable RPC must not be mistaken
 * for "already delivered", since that would strand funds by skipping a real claim.
 */
export async function isMessageDelivered(
  client: PublicClient,
  messageHex: string,
  transmitter: string = MESSAGE_TRANSMITTER_ADDRESS,
): Promise<boolean> {
  const nonce = extractCctpNonce(messageHex);
  if (!nonce) return false;

  try {
    const used = await client.readContract({
      address: transmitter as `0x${string}`,
      abi: USED_NONCES_ABI,
      functionName: 'usedNonces',
      args: [nonce],
    });
    const isDelivered = used !== 0n;
    if (isDelivered) {
      console.log(`[CCTP/Delivery] Nonce ${nonce} is confirmed USED on-chain.`);
    }
    return isDelivered;
  } catch (err) {
    console.error(`[CCTP/Delivery] ❌ usedNonces RPC query failed (RPC node unreachable or rate-limited): ${(err as Error).message}`);
    return false;
  }
}
