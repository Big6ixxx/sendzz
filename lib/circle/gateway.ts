import { EXPLORER_TX_BASE } from '@/lib/explorers';

export const CCTP_DOMAINS: Record<string, number> = {
  ethereum: 0,
  avalanche: 1,
  optimism: 2,
  arbitrum: 3,
  solana: 5,
  base: 6,
  polygon: 7,
  stellar: 27,
};

export type SupportedChain = 'ethereum' | 'avalanche' | 'optimism' | 'arbitrum' | 'base' | 'polygon';

// CCTP V2 TokenMessengerV2 — same address across all EVM chains (CREATE2 deployment)
export const TOKEN_MESSENGER_V2 =
  '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d' as const;

// USDC contract addresses per chain
export const USDC_ADDRESSES: Record<SupportedChain, string> = {
  ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  avalanche: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  optimism: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  arbitrum: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  polygon: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
};

/**
 * Every EVM chain we can read USDC movement on.
 *
 * Deliberately NOT the same as `EVM_CHAINS` in lib/web3/routing.ts, which is the narrower set we
 * can transact on and excludes Ethereum L1. This one is derived from the USDC address map so the
 * two cannot drift: if a chain has a USDC contract here, it is scannable and verifiable.
 */
export const EVM_USDC_CHAINS = Object.keys(USDC_ADDRESSES) as SupportedChain[];

/** Can we read USDC transfers on this chain? Takes a plain string, so callers need no cast. */
export function isEvmUsdcChain(chain: string): boolean {
  return (EVM_USDC_CHAINS as readonly string[]).includes(chain.toLowerCase());
}

export const CHAIN_NAMES: Record<SupportedChain, string> = {
  ethereum: 'Ethereum',
  avalanche: 'Avalanche',
  optimism: 'Optimism',
  arbitrum: 'Arbitrum',
  base: 'Base',
  polygon: 'Polygon',
};

export const CHAIN_IDS: Record<SupportedChain, number> = {
  ethereum: 1,
  avalanche: 43114,
  optimism: 10,
  arbitrum: 42161,
  base: 8453,
  polygon: 137,
};

/**
 * EVM explorer bases, kept for existing callers. The full per-chain map (including Solana
 * and Stellar) lives in `lib/explorers.ts` — add new chains there, not here.
 */
export const CHAIN_EXPLORERS: Record<SupportedChain, string> = {
  ethereum: EXPLORER_TX_BASE.ethereum,
  avalanche: EXPLORER_TX_BASE.avalanche,
  optimism: EXPLORER_TX_BASE.optimism,
  arbitrum: EXPLORER_TX_BASE.arbitrum,
  base: EXPLORER_TX_BASE.base,
  polygon: EXPLORER_TX_BASE.polygon,
};

// Source chains the user can bridge FROM (Base is the destination)
// Circle sponsors gas with USDC on these chains.
//
// This list also drives balance scanning in /api/balances/cross-chain, so a chain
// removed here stops being tracked app-wide: no balance, no portfolio line, no spend
// routing. Ethereum L1 is commented out for now — see BRIDGE_DISABLED_CHAINS below.
export const SOURCE_CHAINS: SupportedChain[] = [
  'arbitrum',
  'avalanche',
  // 'ethereum',
  'optimism',
  'polygon',
];

/**
 * EVM chains currently disabled for bridging.
 *
 * ethereum — Circle's modular bundler doesn't serve L1, so a CCTP claim there can't be
 *   sponsored: it has to go from the user's Privy EOA with the user paying gas, which
 *   can exceed the transfer itself. Rather than offer that, L1 is switched off.
 *
 * Ethereum is currently commented out of every user-facing list, not just this one.
 * To bring it back, restore all of these together:
 *   - SOURCE_CHAINS above           — balance scanning + smart-bridge sources
 *   - EVM_CHAINS (lib/web3/routing) — spend routing + ChainBridge source/dest list
 *   - SPEND_PRIORITY (same file)    — spend ordering
 *   - RAMP_NETWORKS (same file)     — on-ramp deposit networks
 *   - EVM_NETWORKS (ReceiveCryptoFlow)   — receive-crypto network picker
 *   - AVAILABLE_CHAINS (CryptoTransferForm) — send network picker
 *   - the EOA claim block in executeReceiveMessage (lib/web3/bridge-actions)
 *   - this entry
 *
 * Chain *metadata* (CHAIN_META, deposit-shared, explorers) deliberately keeps its
 * ethereum entries — historical L1 transactions still need a name, colour and
 * explorer link to render.
 */
export const BRIDGE_DISABLED_CHAINS: SupportedChain[] = ['ethereum'];

/**
 * Whether users are shown a Solana address to receive on.
 *
 * Off for now. Solana is not a `SupportedChain` above — it is its own rail with its own
 * address — so it cannot go in BRIDGE_DISABLED_CHAINS, but the intent is the same: stop
 * advertising a network before people put money on it.
 *
 * Deliberately narrow. This hides the receive tab and nothing else: balance scanning,
 * spend routing, bridging and pending claims all keep working, so anyone who already
 * holds USDC on Solana can still see it and still move it. Turning those off instead
 * would strand real funds behind a flag.
 *
 * To bring Solana back, set this to true. It is the only switch.
 */
export const SOLANA_RECEIVE_ENABLED = false;

export function isBridgeable(chain: string): boolean {
  return !(BRIDGE_DISABLED_CHAINS as string[]).includes(chain);
}

/**
 * All EVM chains the Smart Bridge will scan.
 *
 * Derived from SOURCE_CHAINS rather than repeated: the two had drifted apart, and the
 * copy here was missing Polygon. A chain the app is willing to bridge *to* but won't
 * scan for balances is a one-way door — the funds arrive and the UI offers no way out.
 */
export const SMART_BRIDGE_CHAINS: SupportedChain[] = SOURCE_CHAINS.filter(isBridgeable);

/**
 * Circle Gas Station policy IDs per chain — set in .env
 * Used by executeSmartBridge to sponsor gas for USDC burns.
 * Chains without a policy ID fall back to Circle's default paymaster.
 */
export const GAS_POLICY_IDS: Partial<Record<SupportedChain, string | undefined>> = {
  arbitrum:  process.env.NEXT_PUBLIC_CIRCLE_GAS_POLICY_ARBITRUM,
  avalanche: process.env.NEXT_PUBLIC_CIRCLE_GAS_POLICY_AVALANCHE,
  ethereum:  process.env.NEXT_PUBLIC_CIRCLE_GAS_POLICY_ETHEREUM,
  optimism:  process.env.NEXT_PUBLIC_CIRCLE_GAS_POLICY_OPTIMISM,
  polygon:   process.env.NEXT_PUBLIC_CIRCLE_GAS_POLICY_POLYGON,
};

// Circle Iris API base URL (mainnet)
const IRIS_API_BASE = 'https://iris-api.circle.com/v2';

// ─── Fee Fetching ───────────────────────────────────────────────────────────

export interface CctpFee {
  /** Finality threshold: 1000 = Fast Transfer, 2000 = Standard */
  finalityThreshold: number;
  /** Minimum fee in basis points */
  minimumFee: number;
}

/**
 * Fetch current CCTP transfer fees from Circle Iris API.
 * Returns fees sorted: [Fast Transfer, Standard Transfer]
 */
export async function fetchCctpFees(
  sourceDomain: number,
  destDomain: number,
): Promise<CctpFee[]> {
  const res = await fetch(
    `${IRIS_API_BASE}/burn/USDC/fees/${sourceDomain}/${destDomain}`,
  );
  if (!res.ok) throw new Error(`Failed to fetch CCTP fees: ${res.statusText}`);
  const data = await res.json();
  return data as CctpFee[];
}

/**
 * Calculate the maxFee parameter for depositForBurn.
 * Fetches the current fee and adds a 20% buffer to handle fluctuations.
 *
 * @returns maxFee in USDC subunits (6 decimals)
 */
export async function calculateMaxFee(
  sourceChain: SupportedChain,
  amountUSDC: string,
  destChain: SupportedChain | 'stellar' | 'solana' = 'base',
  minFinalityThreshold: number = 1000,
): Promise<bigint> {
  const sourceDomain = CCTP_DOMAINS[sourceChain];
  const destDomain = destChain === 'stellar'
    ? 27
    : destChain === 'solana'
      ? 5
      : CCTP_DOMAINS[destChain as SupportedChain];

  // Convert USDC to subunits (6 decimals)
  const [whole, decimal = ''] = amountUSDC.split('.');
  const decimal6 = (decimal + '000000').slice(0, 6);
  const transferAmount = BigInt(whole + decimal6);

  const fees = await fetchCctpFees(sourceDomain, destDomain);

  // Always use Fast Transfer (finalityThreshold === 1000) — this is the
  // fastest path and what production uses. Standard Transfer (2000) takes
  // 13+ minutes and should never be used for user-facing bridges.
  const fastFee = fees.find((f) => f.finalityThreshold === minFinalityThreshold)
    ?? fees.find((f) => f.finalityThreshold === 1000)
    ?? fees[0];

  const minimumFeeBps = fastFee.minimumFee; // basis points, e.g. 0.000130

  // Calculate protocol fee as percentage of transfer amount
  const protocolFee =
    (transferAmount * BigInt(Math.round(minimumFeeBps * 100))) / 1_000_000n;

  // Add 20% buffer to absorb fluctuations
  const maxFee = (protocolFee * 120n) / 100n;
  return maxFee;
}

// ─── Deposit Instructions ───────────────────────────────────────────────────

export function getCCTPDepositInstructions(
  sourceChain: SupportedChain,
  amount: string,
  recipientAddress: string,
) {
  // Pad recipient to bytes32 (left-pad with zeros as required by CCTP)
  const mintRecipient =
    '0x' + '0'.repeat(24) + recipientAddress.slice(2).toLowerCase();

  return {
    sourceChain,
    destinationChain: 'base' as SupportedChain,
    destinationDomain: CCTP_DOMAINS.base,
    tokenMessenger: TOKEN_MESSENGER_V2,
    usdcAddress: USDC_ADDRESSES[sourceChain],
    amount,
    amountRaw: BigInt(Math.floor(parseFloat(amount) * 1_000_000)).toString(),
    mintRecipient,
    chainName: CHAIN_NAMES[sourceChain],
  };
}

// ─── Attestation Polling ────────────────────────────────────────────────────

export type AttestationStatus = 'pending' | 'complete' | 'pending_confirmations' | 'not_found';

export interface AttestationResponse {
  status: AttestationStatus;
  attestation?: string;
  messageBytes?: string;
  /** Returned when Circle's relayer has submitted the mint tx */
  mintTxHash?: string;
  /**
   * Destination block after which this signature is refused, or 0 when it never expires.
   *
   * Only fast transfers carry one. Circle charges a fee to attest before source finality, and
   * bounds its own risk by making that attestation short-lived — so a fast transfer that is not
   * claimed within the window becomes permanently unclaimable until it is re-attested.
   */
  expirationBlock?: number;
  /** CCTP v2 event nonce. Identifies the message to `reattestMessage`. */
  nonce?: string;
}

/**
 * Poll Circle's Iris API for the status of a CCTP V2 transfer.
 * We use the /v2/messages endpoint which accepts a transaction hash.
 *
 * @param sourceChain The chain where the burn occurred
 * @param txHash      The transaction hash of the burn
 */
export async function fetchAttestation(
  sourceChain: string,
  txHash: string,
): Promise<AttestationResponse> {
  try {
    const domain = CCTP_DOMAINS[sourceChain.toLowerCase()];
    const res = await fetch(
      `${IRIS_API_BASE}/messages/${domain}?transactionHash=${txHash}`,
    );

    if (res.status === 404) return { status: 'not_found' };
    if (!res.ok) throw new Error(`Iris API error: ${res.statusText}`);

    const data = (await res.json()) as {
      messages?: {
        status: string;
        attestation?: string;
        message?: string;
        forwardTxHash?: string;
        eventNonce?: string;
        decodedMessage?: { decodedMessageBody?: { expirationBlock?: number | string } };
      }[];
    };
    const message = data.messages?.[0];

    if (!message) return { status: 'not_found' };

    return {
      status: message.status as AttestationStatus,
      attestation: message.attestation
        ? (message.attestation.startsWith('0x') ? message.attestation : `0x${message.attestation}`)
        : undefined,
      messageBytes: message.message
        ? (message.message.startsWith('0x') ? message.message : `0x${message.message}`)
        : undefined,
      mintTxHash: message.forwardTxHash,
      expirationBlock: Number(
        message.decodedMessage?.decodedMessageBody?.expirationBlock ?? 0,
      ),
      nonce: message.eventNonce,
    };
  } catch (err) {
    console.error('[Circle Gateway] fetchAttestation error:', err);
    return { status: 'pending' };
  }
}

/**
 * Ask Circle to sign an expired message again.
 *
 * A fast transfer's attestation is only valid until `expirationBlock`. Past it the signature is
 * refused by MessageTransmitter forever — the USDC is already burned, so without this the funds
 * are simply stranded. Re-attestation reissues the same message with `expirationBlock: 0`, which
 * never expires, and leaves everything the user cares about untouched: same nonce, same amount,
 * same recipient, all baked into the message Circle signs.
 *
 * Returns true only when Circle has actually agreed to reissue — the caller's signal that the
 * signature in hand is stale and a replacement is coming.
 *
 * Calling this when there is nothing to reissue is harmless but NOT a no-op. Circle answers
 * 400 "Message is already finalized" for one that has been consumed or already carries a
 * non-expiring signature. That is a benign answer rather than a fault — the message needs
 * nothing — so it is logged quietly and returns false, which reads correctly as "no reissue is
 * pending". Verified against the live API; an earlier version of this comment claimed Circle
 * no-ops on a repeat call, and it does not.
 */
export async function reattestMessage(nonce: string): Promise<boolean> {
  try {
    const res = await fetch(`${IRIS_API_BASE}/reattest/${nonce}`, { method: 'POST' });
    if (res.ok) {
      console.log(`[Circle Gateway] re-attested expired message ${nonce}`);
      return true;
    }

    const body = await res.text();

    // Nothing to reissue. The claim is not broken, so this must not read as an error.
    if (/already finalized|cannot re-attest/i.test(body)) {
      console.log(`[Circle Gateway] ${nonce.slice(0, 14)} needs no re-attestation.`);
      return false;
    }

    console.error(`[Circle Gateway] reattest ${nonce} refused: ${res.status} ${body}`);
    return false;
  } catch (err) {
    console.error('[Circle Gateway] reattest error:', err);
    return false;
  }
}
