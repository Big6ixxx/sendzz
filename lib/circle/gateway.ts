/**
 * Circle CCTP Gateway Service
 *
 * Core service for orchestrating Cross-Chain Transfer Protocol (CCTP) transfers.
 * Rather than relying on auto-forwarding hooks, this implements a robust,
 * production-ready flow involving direct burn and manual backend-driven minting.
 *
 * Flow:
 * 1. User calls depositForBurn on source chain TokenMessenger
 * 2. BridgeWorker polls the burn transaction logs to extract the MessageHash
 * 3. BridgeWorker fetches the attestation signature from Iris API
 * 4. BridgeWorker calls receiveMessage on the destination chain MessageTransmitter
 */

// CCTP Domain IDs for supported chains
export const CCTP_DOMAINS = {
  ethereum: 0,
  avalanche: 1,
  optimism: 2,
  arbitrum: 3,
  solana: 5,
  base: 6,
  polygon: 7,
} as const;

export type SupportedChain = keyof typeof CCTP_DOMAINS;

// Contract addresses for CCTP TokenMessenger
export const TOKEN_MESSENGER_ADDRESSES: Record<SupportedChain, string> = {
  ethereum: '0xBd3fa81B58Ba92a82136038B25aDec7066af3155',
  avalanche: '0x6b25532e1060ce10cc3b0a99e5683b91bfde6982',
  arbitrum: '0x19330d10D9Cc8751218eaf51E8885D058642E08A',
  base: '0x1682Ae6375C4E4A97e4B583BC394c861A46D8962',
  polygon: '0x9daF8c91AEFAE50b9c0E69629D3F6Ca40cA3B3FE',
  optimism: '0x2B4069517957735bE00ceE0fadAE88a26365528f',
  solana: 'CCTP1V4o69zB586146B8B165C7B6195E054210452G',
};

// USDC contract addresses per chain
export const USDC_ADDRESSES: Record<SupportedChain, string> = {
  ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  avalanche: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  arbitrum: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  polygon: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  optimism: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  solana: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // mainnet USDC
};

/**
 * Get the deposit instructions for manual CCTP bridging.
 */
export function getDepositForBurnParams(
  sourceChain: SupportedChain,
  destinationChain: SupportedChain,
  amount: string,
) {
  const recipientAmount = BigInt(parseFloat(amount) * 1_000_000); // 6 decimals

  return {
    sourceChain,
    destinationChain,
    destinationDomain: CCTP_DOMAINS[destinationChain],
    tokenMessenger: TOKEN_MESSENGER_ADDRESSES[sourceChain],
    usdcAddress: USDC_ADDRESSES[sourceChain],
    amount: recipientAmount.toString(),
    instructions: `Call approve() on the USDC token to allow TokenMessenger (${TOKEN_MESSENGER_ADDRESSES[sourceChain]}) to spend ${amount} USDC. Then call depositForBurn() on the TokenMessenger contract with destination domain ${CCTP_DOMAINS[destinationChain]}.`,
  };
}

export interface AttestationResponse {
  attestation: string;
  status: 'complete' | 'pending';
}

/**
 * Fetch the attestation signature from Circle's Iris API
 *
 * @param messageHash The explicit keccak256 hash of the message bytes
 */
export async function fetchAttestation(
  messageHash: string,
): Promise<AttestationResponse> {
  const baseUrl = 'https://iris-api.circle.com/v1';

  try {
    const response = await fetch(`${baseUrl}/attestations/${messageHash}`);

    if (response.status === 404) {
      // Attestation not ready yet
      return { attestation: '', status: 'pending' };
    }

    if (!response.ok) {
      throw new Error(`Iris API query failed: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      attestation: data.attestation,
      status: data.status,
    };
  } catch (error) {
    console.error('[CCTP] Error fetching attestation:', error);
    return { attestation: '', status: 'pending' };
  }
}
