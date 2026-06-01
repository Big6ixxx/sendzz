export const CCTP_DOMAINS = {
  ethereum: 0,
  avalanche: 1,
  optimism: 2,
  arbitrum: 3,
  base: 6,
  polygon: 7,
} as const;

export type SupportedChain = keyof typeof CCTP_DOMAINS;

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

/** Block explorer tx URL for each chain */
export const CHAIN_EXPLORERS: Record<SupportedChain, string> = {
  ethereum: 'https://etherscan.io/tx',
  avalanche: 'https://snowtrace.io/tx',
  optimism: 'https://optimistic.etherscan.io/tx',
  arbitrum: 'https://arbiscan.io/tx',
  base: 'https://basescan.org/tx',
  polygon: 'https://polygonscan.com/tx',
};

// Source chains the user can bridge FROM (Base is the destination)
// Circle sponsors gas with USDC on these chains
export const SOURCE_CHAINS: SupportedChain[] = [
  'arbitrum',
  'avalanche',
  'ethereum',
  'optimism',
  'polygon',
];

export const SMART_BRIDGE_CHAINS: SupportedChain[] = [
  'arbitrum',
  'avalanche',
  'ethereum',
];

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
): Promise<bigint> {
  const sourceDomain = CCTP_DOMAINS[sourceChain];
  const destDomain = CCTP_DOMAINS.base;

  // Convert USDC to subunits (6 decimals)
  const [whole, decimal = ''] = amountUSDC.split('.');
  const decimal6 = (decimal + '000000').slice(0, 6);
  const transferAmount = BigInt(whole + decimal6);

  const fees = await fetchCctpFees(sourceDomain, destDomain);

  // Use Fast Transfer fee (finalityThreshold === 1000) if available
  const fastFee = fees.find((f) => f.finalityThreshold === 1000) ?? fees[0];
  const minimumFeeBps = fastFee.minimumFee;

  // Calculate protocol fee
  const protocolFee =
    (transferAmount * BigInt(Math.round(minimumFeeBps * 100))) / 1_000_000n;

  // Add 20% buffer
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

export type AttestationStatus = 'pending' | 'complete';

export interface AttestationResponse {
  status: AttestationStatus;
  attestation?: string;
  messageBytes?: string;
  /** Returned when Circle's relayer has submitted the mint tx */
  mintTxHash?: string;
}

/**
 * Poll Circle's Iris API for the status of a CCTP V2 transfer.
 * We use the /v2/messages endpoint which accepts a transaction hash.
 *
 * @param sourceChain The chain where the burn occurred
 * @param txHash      The transaction hash of the burn
 */
export async function fetchAttestation(
  sourceChain: SupportedChain,
  txHash: string,
): Promise<AttestationResponse> {
  try {
    const domain = CCTP_DOMAINS[sourceChain];
    const res = await fetch(
      `${IRIS_API_BASE}/messages/${domain}?transactionHash=${txHash}`,
    );

    if (res.status === 404) return { status: 'pending' };
    if (!res.ok) throw new Error(`Iris API error: ${res.statusText}`);

    const data = (await res.json()) as {
      messages?: {
        status: string;
        attestation?: string;
        message?: string;
        forwardTxHash?: string;
      }[];
    };
    const message = data.messages?.[0];

    if (!message) return { status: 'pending' };

    return {
      status: message.status === 'complete' ? 'complete' : 'pending',
      attestation: message.attestation,
      messageBytes: message.message,
      mintTxHash: message.forwardTxHash,
    };
  } catch (err) {
    console.error('[Circle Gateway] fetchAttestation error:', err);
    return { status: 'pending' };
  }
}
