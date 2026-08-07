import { EXPLORER_TX_BASE, HOME_CHAIN } from '@/lib/explorers';
import { IS_TESTNET, IS_ARC_ENABLED } from '@/lib/web3/network';

export const CCTP_DOMAINS: Record<string, number> = {
  ethereum: 0,
  avalanche: 1,
  optimism: 2,
  arbitrum: 3,
  solana: 5,
  base: 6,
  polygon: 7,
  // Arc is domain 26. Verified against MessageTransmitterV2.localDomain() on Arc, which
  // returns 0x1a, and against Iris, which rejects domain 20 as an invalid domain id.
  arc: 26,
  stellar: 27,
};

export type SupportedChain = 'ethereum' | 'avalanche' | 'optimism' | 'arbitrum' | 'base' | 'polygon' | 'arc';

/**
 * CCTP V2 contracts. Each is one CREATE2 address across every chain in its network
 * family, but mainnet and testnet are *different* address sets — the testnet set is what
 * Arc uses, and it is deployed identically on Base Sepolia, Arbitrum Sepolia and Fuji.
 * Pointing testnet at the mainnet addresses (as this file used to) targets an account
 * with no code, so every burn and claim reverts.
 */
export const TOKEN_MESSENGER_V2 = (
  IS_TESTNET
    ? '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'
    : '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d'
) as `0x${string}`;

export const MESSAGE_TRANSMITTER_V2 = (
  IS_TESTNET
    ? '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275'
    : '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64'
) as `0x${string}`;

const IS_SIMULATION = IS_TESTNET;

// USDC contract addresses per chain (Mainnet vs Testnet)
export const USDC_ADDRESSES: Record<SupportedChain, string> = IS_SIMULATION
  ? {
      ethereum: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      avalanche: '0x5425890298aed601595a70AB815c96711a31Bc65',
      optimism: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
      arbitrum: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
      base: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      polygon: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
      // Arc exposes USDC through two interfaces over one balance: a native gas token
      // (18 decimals, for gas and msg.value only) and this ERC-20 system contract
      // (6 decimals). Circle's guidance is to use the ERC-20 for all app logic —
      // transfers, approvals and balance reads — exactly like USDC on any other chain.
      // Never mix the two representations: they differ by 10^12.
      arc: '0x3600000000000000000000000000000000000000',
    }
  : {
      ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      avalanche: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
      optimism: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      arbitrum: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      polygon: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      // Arc has no mainnet yet. This keeps the record total for the type, but Arc is
      // filtered out of every runtime chain list when IS_ARC_ENABLED is false, so it is
      // unreachable in a mainnet build.
      arc: '0x3600000000000000000000000000000000000000',
    };

export const CHAIN_NAMES: Record<SupportedChain, string> = {
  ethereum: 'Ethereum',
  avalanche: 'Avalanche',
  optimism: 'Optimism',
  arbitrum: 'Arbitrum',
  base: 'Base',
  polygon: 'Polygon',
  arc: IS_TESTNET ? 'Arc Testnet' : 'Arc',
};

export const CHAIN_IDS: Record<SupportedChain, number> = IS_SIMULATION
  ? {
      ethereum: 11155111,
      avalanche: 43113,
      optimism: 11155420,
      arbitrum: 421614,
      base: 84532,
      polygon: 80002,
      arc: 5042002,
    }
  : {
      ethereum: 1,
      avalanche: 43114,
      optimism: 10,
      arbitrum: 42161,
      base: 8453,
      polygon: 137,
      arc: 5042002,
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
  arc: EXPLORER_TX_BASE.arc,
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
  // Arc is testnet-only, so it drops out of balance scanning and bridging automatically
  // in a mainnet build rather than pointing at a chain that does not exist yet.
  ...(IS_ARC_ENABLED ? (['arc'] as SupportedChain[]) : []),
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
 * Circle Gas Station policy IDs per chain — set in .env.
 * Used by executeSmartBridge to sponsor gas for USDC burns.
 * Chains without a policy ID fall back to Circle's default paymaster.
 *
 * A policy belongs to the Circle account that created it, so a LIVE policy id is
 * meaningless to a TEST key and is rejected when passed as paymaster context. The two
 * sets are therefore kept apart, and testnet simply has no policies configured by
 * default — falling back to Circle's default paymaster is the right behaviour there.
 * Set the *_TESTNET variables only if you create Gas Station policies on a test account.
 *
 * These are read as literals rather than by building the variable name, because Next
 * inlines `NEXT_PUBLIC_*` by exact textual match and a computed lookup resolves to
 * undefined in the browser bundle.
 */
const MAINNET_GAS_POLICIES: Partial<Record<SupportedChain, string | undefined>> = {
  arbitrum:  process.env.NEXT_PUBLIC_CIRCLE_GAS_POLICY_ARBITRUM,
  avalanche: process.env.NEXT_PUBLIC_CIRCLE_GAS_POLICY_AVALANCHE,
  ethereum:  process.env.NEXT_PUBLIC_CIRCLE_GAS_POLICY_ETHEREUM,
  optimism:  process.env.NEXT_PUBLIC_CIRCLE_GAS_POLICY_OPTIMISM,
  polygon:   process.env.NEXT_PUBLIC_CIRCLE_GAS_POLICY_POLYGON,
};

const TESTNET_GAS_POLICIES: Partial<Record<SupportedChain, string | undefined>> = {
  arbitrum:  process.env.NEXT_PUBLIC_CIRCLE_GAS_POLICY_ARBITRUM_TESTNET,
  avalanche: process.env.NEXT_PUBLIC_CIRCLE_GAS_POLICY_AVALANCHE_TESTNET,
  optimism:  process.env.NEXT_PUBLIC_CIRCLE_GAS_POLICY_OPTIMISM_TESTNET,
  polygon:   process.env.NEXT_PUBLIC_CIRCLE_GAS_POLICY_POLYGON_TESTNET,
  base:      process.env.NEXT_PUBLIC_CIRCLE_GAS_POLICY_BASE_TESTNET,
  arc:       process.env.NEXT_PUBLIC_CIRCLE_GAS_POLICY_ARC_TESTNET,
};

export const GAS_POLICY_IDS: Partial<Record<SupportedChain, string | undefined>> =
  IS_TESTNET ? TESTNET_GAS_POLICIES : MAINNET_GAS_POLICIES;

const IRIS_API_BASE = IS_SIMULATION
  ? 'https://iris-api-sandbox.circle.com/v2'
  : 'https://iris-api.circle.com/v2';

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
  destChain: SupportedChain | 'stellar' | 'solana' = HOME_CHAIN,
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
    destinationChain: HOME_CHAIN as SupportedChain,
    destinationDomain: CCTP_DOMAINS[HOME_CHAIN],
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
    };
  } catch (err) {
    console.error('[Circle Gateway] fetchAttestation error:', err);
    return { status: 'pending' };
  }
}
