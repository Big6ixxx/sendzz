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

/** MessageTransmitterV2 — one CREATE2 address across every supported EVM chain. */
export const MESSAGE_TRANSMITTER_ADDRESS =
  process.env.NEXT_PUBLIC_SIMULATION_MODE === 'true'
    ? '0x81D40F2169b009c9103C280963d76e4B4d4c464B'
    : '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64';

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

/** How far back to look for the delivery. Ample for a mint we just watched land. */
const LOG_LOOKBACK_BLOCKS = 50_000n;

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

  try {
    const latest = await client.getBlockNumber();
    const fromBlock = latest > LOG_LOOKBACK_BLOCKS ? latest - LOG_LOOKBACK_BLOCKS : 0n;

    const logs = await client.getLogs({
      address: transmitter as `0x${string}`,
      event: MESSAGE_RECEIVED_V2,
      args: { nonce },
      fromBlock,
      toBlock: latest,
    });
    return logs[0]?.transactionHash;
  } catch (err) {
    console.warn('[CCTP] Mint tx lookup failed:', (err as Error).message);
    return undefined;
  }
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
    return used !== 0n;
  } catch (err) {
    console.error('[CCTP] usedNonces lookup failed:', (err as Error).message);
    return false;
  }
}
