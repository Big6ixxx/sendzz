/**
 * Stellar CCTP V2 Gateway
 *
 * Handles building depositForBurn Soroban transactions, balance checks, and
 * attestation polling for Circle CCTP V2 on Stellar (domain 27 → Base domain 6).
 *
 * Key addresses (mainnet — configure via env vars):
 *   TokenMessenger (Soroban) : NEXT_PUBLIC_STELLAR_TOKEN_MESSENGER_CONTRACT
 *   USDC token (Soroban)     : NEXT_PUBLIC_STELLAR_USDC_CONTRACT
 *   USDC classic issuer      : GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
 *   CctpForwarder (optional) : NEXT_PUBLIC_STELLAR_CCTP_FORWARDER
 *
 * Decimal precision:
 *   Stellar USDC classic has 7 decimal places (stroops × 10^7)
 *   CCTP message amounts are always 6-decimal subunits — multiply user input × 10^6
 */

import {
  Address,
  Contract,
  nativeToScVal,
  Networks,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';
import { type AttestationResponse } from './gateway';

// ── Constants ────────────────────────────────────────────────────────────────

export const STELLAR_CCTP_DOMAIN = 27;
export const BASE_CCTP_DOMAIN = 6;

/** Env-configured Soroban contract addresses */
export const STELLAR_TOKEN_MESSENGER_CONTRACT =
  process.env.NEXT_PUBLIC_STELLAR_TOKEN_MESSENGER_CONTRACT ?? '';
export const STELLAR_USDC_CONTRACT =
  process.env.NEXT_PUBLIC_STELLAR_USDC_CONTRACT ??
  'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI';
/** Optional CctpForwarder address — if set, used as mintRecipient for correct routing */
export const STELLAR_CCTP_FORWARDER =
  process.env.NEXT_PUBLIC_STELLAR_CCTP_FORWARDER ?? '';

export const STELLAR_RPC_URL =
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL ??
  'https://soroban-mainnet.stellar.gateway.fm';

export const STELLAR_HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ?? 'https://horizon.stellar.org';

export const STELLAR_NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? Networks.PUBLIC;

/** Circle's USDC classic asset issuer on Stellar mainnet */
export const USDC_CLASSIC_ISSUER =
  'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

const IRIS_API_BASE = 'https://iris-api.circle.com/v2';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Encode an EVM address as a 32-byte BytesN ScVal for CCTP.
 * EVM addresses are 20 bytes; CCTP uses 32-byte fields (left-padded with zeros).
 */
function evmAddressToScValBytes32(evmAddress: string): xdr.ScVal {
  const buf = Buffer.alloc(32, 0);
  const addrHex = evmAddress.replace(/^0x/i, '');
  Buffer.from(addrHex.padStart(40, '0'), 'hex').copy(buf, 12);
  return xdr.ScVal.scvBytes(buf);
}

/**
 * Zero-filled 32-byte ScVal used for destinationCaller (no restriction).
 */
function zeroBytes32ScVal(): xdr.ScVal {
  return xdr.ScVal.scvBytes(Buffer.alloc(32, 0));
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface StellarDepositForBurnResult {
  /** Base64-encoded XDR of the prepared (simulated + footprint-set) transaction */
  xdr: string;
}

/**
 * Build a Stellar Soroban depositForBurn transaction for CCTP V2.
 *
 * The function simulates the transaction against the Soroban RPC to obtain the
 * correct resource footprint, then returns the prepared XDR ready for Freighter
 * to sign.
 *
 * @param senderAddress   Stellar G-address of the sender
 * @param evmRecipient    The Base smart account address (0x…)
 * @param amountUsdc      Human-readable USDC amount (e.g. "10.50")
 * @param maxFeeSubunits  Pre-calculated maxFee in 6-decimal USDC subunits
 */
export async function buildStellarDepositForBurnTx(
  senderAddress: string,
  evmRecipient: string,
  amountUsdc: string,
  maxFeeSubunits: bigint,
): Promise<StellarDepositForBurnResult> {
  if (!STELLAR_TOKEN_MESSENGER_CONTRACT) {
    throw new Error(
      'NEXT_PUBLIC_STELLAR_TOKEN_MESSENGER_CONTRACT is not configured',
    );
  }

  // Convert to 6-decimal subunits (CCTP standard — NOT Stellar's 7-decimal stroops)
  const [whole, frac = ''] = amountUsdc.split('.');
  const frac6 = (frac + '000000').slice(0, 6);
  const amountSubunits = BigInt(whole + frac6);

  // mintRecipient: if CctpForwarder is configured, use it; otherwise use EVM address directly
  let mintRecipientScVal: xdr.ScVal;
  if (STELLAR_CCTP_FORWARDER) {
    // CctpForwarder is a Soroban contract address on Stellar — encode as ScVal Address
    mintRecipientScVal = new Address(STELLAR_CCTP_FORWARDER).toScVal();
  } else {
    // Direct EVM address encoding — standard for Stellar → EVM bridges
    mintRecipientScVal = evmAddressToScValBytes32(evmRecipient);
  }

  // forwardRecipient: the user's actual Base EVM address (only needed with CctpForwarder)
  const forwardRecipientScVal = evmAddressToScValBytes32(evmRecipient);

  const server = new SorobanRpc.Server(STELLAR_RPC_URL);
  const account = await server.getAccount(senderAddress);

  const contract = new Contract(STELLAR_TOKEN_MESSENGER_CONTRACT);

  // Build the instruction arguments
  // depositForBurn(amount, destination_domain, mint_recipient, burn_token,
  //               destination_caller, max_fee, min_finality_threshold)
  const callArgs: xdr.ScVal[] = [
    nativeToScVal(amountSubunits, { type: 'u128' }),
    nativeToScVal(BASE_CCTP_DOMAIN, { type: 'u32' }),
    mintRecipientScVal,
    new Address(STELLAR_USDC_CONTRACT).toScVal(),
    zeroBytes32ScVal(), // destinationCaller = no restriction
    nativeToScVal(maxFeeSubunits, { type: 'u128' }),
    nativeToScVal(1000, { type: 'u32' }), // minFinalityThreshold = Fast Transfer
  ];

  // If using CctpForwarder, add forwardRecipient as an extra argument
  if (STELLAR_CCTP_FORWARDER) {
    callArgs.push(forwardRecipientScVal);
  }

  const operation = contract.call('deposit_for_burn', ...callArgs);

  const tx = new TransactionBuilder(account, {
    fee: '1000000', // 0.1 XLM as the base fee ceiling
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  // Simulate to get the resource footprint
  const simResult = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(
      `Stellar simulation failed: ${(simResult as SorobanRpc.Api.SimulateTransactionErrorResponse).error}`,
    );
  }

  // Assemble with footprint and resource limits
  const preparedTx = SorobanRpc.assembleTransaction(tx, simResult).build();

  return { xdr: preparedTx.toEnvelope().toXDR('base64') };
}

/**
 * Get the USDC balance (in full USDC) of a Stellar account.
 * Queries Stellar Horizon for the classic USDC trust line balance.
 * Returns 0 if the account has no USDC trust line or doesn't exist.
 */
export async function getStellarUsdcBalance(
  stellarAddress: string,
): Promise<number> {
  try {
    const res = await fetch(
      `${STELLAR_HORIZON_URL}/accounts/${stellarAddress}`,
    );
    if (!res.ok) return 0;

    const data = (await res.json()) as {
      balances?: { asset_code?: string; asset_issuer?: string; balance?: string }[];
    };
    const usdcBalance = data.balances?.find(
      (b) =>
        b.asset_code === 'USDC' && b.asset_issuer === USDC_CLASSIC_ISSUER,
    );
    return usdcBalance ? parseFloat(usdcBalance.balance ?? '0') : 0;
  } catch {
    return 0;
  }
}

/**
 * Fetch CCTP attestation status for a Stellar burn transaction.
 * Uses the Circle Iris API /v2/messages endpoint with domain 27.
 */
export async function fetchStellarAttestation(
  txHash: string,
): Promise<AttestationResponse> {
  try {
    const res = await fetch(
      `${IRIS_API_BASE}/messages/${STELLAR_CCTP_DOMAIN}?transactionHash=${txHash}`,
    );
    if (res.status === 404) return { status: 'pending' };
    if (!res.ok) throw new Error(`Iris API error: ${res.statusText}`);

    const data = (await res.json()) as {
      messages?: { status: string; attestation?: string; forwardTxHash?: string }[];
    };
    const message = data.messages?.[0];
    if (!message) return { status: 'pending' };

    return {
      status: message.status === 'complete' ? 'complete' : 'pending',
      attestation: message.attestation,
      mintTxHash: message.forwardTxHash,
    };
  } catch (err) {
    console.error('[StellarGateway] fetchAttestation error:', err);
    return { status: 'pending' };
  }
}

/**
 * Calculate the maxFee for a Stellar → Base transfer.
 * Fetches from Circle Iris API and adds a 20% safety buffer.
 *
 * @returns maxFee in 6-decimal USDC subunits
 */
export async function calculateStellarMaxFee(amountUsdc: string): Promise<bigint> {
  const { fetchCctpFees } = await import('./gateway');
  const fees = await fetchCctpFees(STELLAR_CCTP_DOMAIN, BASE_CCTP_DOMAIN);
  const fastFee = fees.find((f) => f.finalityThreshold === 1000) ?? fees[0];
  const bps = fastFee.minimumFee;

  const [whole, frac = ''] = amountUsdc.split('.');
  const frac6 = (frac + '000000').slice(0, 6);
  const amountSubunits = BigInt(whole + frac6);

  const protocolFee =
    (amountSubunits * BigInt(Math.round(bps * 100))) / 1_000_000n;
  return (protocolFee * 120n) / 100n; // +20% buffer
}
