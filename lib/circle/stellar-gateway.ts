/**
 * Stellar CCTP V2 Gateway
 *
 * Handles building depositForBurn Soroban transactions, balance checks, and
 * attestation polling for Circle CCTP V2 on Stellar (domain 27 → Base domain 6).
 *
 * Key addresses (mainnet — configure via env vars):
 *   TokenMessenger (Soroban) : NEXT_PUBLIC_STELLAR_TOKEN_MESSENGER_CONTRACT
 *   USDC token (Soroban)     : NEXT_PUBLIC_STELLAR_USDC_CONTRACT
 *   CctpForwarder (optional) : NEXT_PUBLIC_STELLAR_CCTP_FORWARDER
 *
 * Decimal precision:
 *   Soroban USDC uses 6 decimal places (same as CCTP standard across all chains).
 *   CCTP message amounts are always 6-decimal subunits — multiply user input × 10^6
 */

import {
  Account,
  Address,
  Contract,
  Keypair,
  nativeToScVal,
  scValToNative,
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
  'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75';

export const STELLAR_RPC_URL =
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL ??
  'https://soroban-rpc.mainnet.stellar.gateway.fm';

export const STELLAR_HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ?? 'https://horizon.stellar.org';

export const STELLAR_NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? Networks.PUBLIC;

/** Circle's USDC classic asset issuer on Stellar mainnet */
const USDC_CLASSIC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

const IRIS_API_BASE = 'https://iris-api.circle.com/v2';

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Load a Stellar account's sequence number via Soroban RPC getLedgerEntries.
 * Avoids any Horizon dependency — works entirely through the Soroban RPC.
 */
async function loadAccountFromRpc(
  address: string,
  server: SorobanRpc.Server,
): Promise<Account> {
  console.log('[StellarGateway] loadAccountFromRpc: fetching account for', address, 'via Soroban RPC', STELLAR_RPC_URL);

  const accountKey = xdr.LedgerKey.account(
    new xdr.LedgerKeyAccount({
      accountId: Keypair.fromPublicKey(address).xdrPublicKey(),
    }),
  );

  let result: Awaited<ReturnType<typeof server.getLedgerEntries>>;
  try {
    result = await server.getLedgerEntries(accountKey);
    console.log('[StellarGateway] loadAccountFromRpc: getLedgerEntries result entries count:', result.entries?.length ?? 0);
  } catch (e) {
    console.error('[StellarGateway] loadAccountFromRpc: getLedgerEntries threw:', e);
    throw e;
  }

  if (!result.entries?.length) {
    console.error('[StellarGateway] loadAccountFromRpc: account NOT found in Soroban RPC response');
    throw new Error(
      'Stellar account not found on the network. Make sure your Freighter wallet has at least 1 XLM as a minimum balance.',
    );
  }

  let seqNum: string;
  try {
    seqNum = result.entries[0].val.account().seqNum().toString();
    console.log('[StellarGateway] loadAccountFromRpc: sequence number =', seqNum);
  } catch (e) {
    console.error('[StellarGateway] loadAccountFromRpc: failed to parse account entry XDR:', e);
    throw e;
  }

  return new Account(address, seqNum);
}

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
  destChain: string = 'base',
  account?: Account,
  minFinalityThreshold: number = 1000,
): Promise<StellarDepositForBurnResult> {
  if (!STELLAR_TOKEN_MESSENGER_CONTRACT) {
    throw new Error(
      'NEXT_PUBLIC_STELLAR_TOKEN_MESSENGER_CONTRACT is not configured',
    );
  }

  // Convert to Stellar USDC local subunits (7 decimals — Stellar native precision).
  // The TokenMessengerMinterV2 contract accepts `amount` in local decimals and internally
  // normalizes to the canonical CCTP 6-decimal format via its TokenDecimalConfig.
  const [whole, frac = ''] = amountUsdc.split('.');
  const frac7 = (frac + '0000000').slice(0, 7);
  const amountSubunits = BigInt(whole + frac7);

  // Map destination chain to domain
  const { CCTP_DOMAINS } = await import('./gateway');
  const destinationDomain = destChain in CCTP_DOMAINS 
    ? CCTP_DOMAINS[destChain as keyof typeof CCTP_DOMAINS]
    : BASE_CCTP_DOMAIN;

  // mintRecipient: BytesN<32> — for Stellar → EVM, this is always the
  // user's EVM address left-padded to 32 bytes.
  const mintRecipientScVal = evmAddressToScValBytes32(evmRecipient);

  console.log('[StellarGateway] buildStellarDepositForBurnTx: amount subunits =', amountSubunits.toString(), '| maxFee subunits =', maxFeeSubunits.toString());
  const server = new SorobanRpc.Server(STELLAR_RPC_URL);
  const txAccount = account ?? await loadAccountFromRpc(senderAddress, server);

  const contract = new Contract(STELLAR_TOKEN_MESSENGER_CONTRACT);

  // The Circle TokenMessengerMinterV2 Stellar contract's deposit_for_burn signature
  // (see packages/cctp-interfaces/src/token_messenger.rs in circlefin/stellar-cctp):
  //
  //   deposit_for_burn(
  //     e: &Env,                         ← host-provided, NOT passed by caller
  //     caller: Address,                 ← 1st user arg: the Stellar sender
  //     amount: i128,                    ← local 7-decimal Stellar USDC subunits
  //     destination_domain: u32,
  //     mint_recipient: BytesN<32>,      ← EVM address left-padded to 32 bytes
  //     burn_token: Address,             ← USDC SAC contract
  //     destination_caller: BytesN<32>,  ← zeros = no restriction
  //     max_fee: i128,                   ← local 7-decimal subunits
  //     min_finality_threshold: u32,
  //   )
  //
  // For the _with_hook variant there is a 9th `hook_data: Bytes` parameter.
  // We do NOT use that variant; this is always the standard deposit_for_burn.
  const callArgs: xdr.ScVal[] = [
    new Address(senderAddress).toScVal(),              // caller
    nativeToScVal(amountSubunits, { type: 'i128' }),   // amount (i128 local units)
    nativeToScVal(destinationDomain, { type: 'u32' }), // destination_domain
    mintRecipientScVal,                                // mint_recipient
    new Address(STELLAR_USDC_CONTRACT).toScVal(),      // burn_token
    zeroBytes32ScVal(),                               // destination_caller = no restriction
    nativeToScVal(maxFeeSubunits, { type: 'i128' }),   // max_fee (i128 local units)
    nativeToScVal(minFinalityThreshold, { type: 'u32' }), // min_finality_threshold
  ];

  const operation = contract.call('deposit_for_burn', ...callArgs);

  const tx = new TransactionBuilder(txAccount, {
    fee: '1000000', // 0.1 XLM as the base fee ceiling
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(300)
    .build();

  // Simulate to get the resource footprint
  console.log('[StellarGateway] buildStellarDepositForBurnTx: simulating transaction…');
  const simResult = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    const simError = (simResult as SorobanRpc.Api.SimulateTransactionErrorResponse).error;
    console.error('[StellarGateway] buildStellarDepositForBurnTx: simulation failed:', simError);
    throw new Error(`Stellar simulation failed: ${simError}`);
  }
  console.log('[StellarGateway] buildStellarDepositForBurnTx: simulation succeeded');

  // Assemble with footprint and resource limits
  const preparedTx = SorobanRpc.assembleTransaction(tx, simResult).build();

  return { xdr: preparedTx.toEnvelope().toXDR('base64') };
}

/**
 * Get the USDC balance (in full USDC) of a Stellar account.
 * Queries Stellar Horizon for the classic USDC trustline balance.
 * Returns 0 if the account has no USDC trustline or doesn't exist.
 */
export async function getStellarUsdcBalance(
  stellarAddress: string,
): Promise<number> {
  try {
    const res = await fetch(`${STELLAR_HORIZON_URL}/accounts/${stellarAddress}`);
    if (!res.ok) return 0;
    const data = await res.json() as {
      balances?: { asset_code?: string; asset_issuer?: string; balance?: string }[];
    };
    const usdcBalance = data.balances?.find(
      (b) => b.asset_code === 'USDC' && b.asset_issuer === USDC_CLASSIC_ISSUER,
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
      messages?: { status: string; attestation?: string; message?: string; forwardTxHash?: string }[];
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
export async function calculateStellarMaxFee(
  amountUsdc: string,
  destChain: string = 'base',
  minFinalityThreshold: number = 1000,
): Promise<bigint> {
  const { fetchCctpFees, CCTP_DOMAINS } = await import('./gateway');
  const destinationDomain = destChain in CCTP_DOMAINS 
    ? CCTP_DOMAINS[destChain as keyof typeof CCTP_DOMAINS]
    : BASE_CCTP_DOMAIN;
  const fees = await fetchCctpFees(STELLAR_CCTP_DOMAIN, destinationDomain);
  const matchingFee = fees.find((f) => f.finalityThreshold === minFinalityThreshold) ?? fees[0];
  const minimumFeeUSDC = matchingFee.minimumFee; // e.g. 1.3 or 0

  // Convert flat fee to 7-decimal subunits (Stellar native precision)
  const minimumFeeSubunits = BigInt(Math.round(minimumFeeUSDC * 10_000_000));

  // Add 20% safety buffer
  const maxFee = (minimumFeeSubunits * 120n) / 100n;
  return maxFee;
}

/**
 * Query the user's current USDC allowance for a spender on Soroban.
 * Since this is read-only, it uses simulateTransaction and requires no signatures.
 */
export async function getStellarUsdcAllowance(
  userAddress: string,
  spenderAddress: string,
): Promise<bigint> {
  try {
    const server = new SorobanRpc.Server(STELLAR_RPC_URL);
    // Dummy account sequence is fine since it's only a simulation
    const dummyAccount = new Account(userAddress, '0');
    const usdcContract = new Contract(STELLAR_USDC_CONTRACT);
    const operation = usdcContract.call(
      'allowance',
      new Address(userAddress).toScVal(),
      new Address(spenderAddress).toScVal(),
    );
    const tx = new TransactionBuilder(dummyAccount, {
      fee: '100',
      networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(300)
      .build();

    const simResult = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResult)) {
      console.warn('[StellarGateway] getStellarUsdcAllowance simulation failed:', simResult.error);
      return 0n;
    }

    if (simResult.result?.retval) {
      const native = scValToNative(simResult.result.retval);
      if (typeof native === 'bigint') {
        return native;
      }
      return BigInt(native ?? 0);
    }
    return 0n;
  } catch (err) {
    console.error('[StellarGateway] getStellarUsdcAllowance failed:', err);
    return 0n;
  }
}

/**
 * Build a transaction to approve TokenMessenger to spend USDC.
 */
export async function buildStellarApproveTx(
  senderAddress: string,
  spenderAddress: string,
  amountUsdc: string,
  account?: Account,
): Promise<{ xdr: string }> {
  const [whole, frac = ''] = amountUsdc.split('.');
  const frac7 = (frac + '0000000').slice(0, 7);
  const amountSubunits = BigInt(whole + frac7);

  const server = new SorobanRpc.Server(STELLAR_RPC_URL);
  const txAccount = account ?? await loadAccountFromRpc(senderAddress, server);

  const latestLedgerResponse = await server.getLatestLedger();
  const latestLedger = latestLedgerResponse.sequence;
  const expirationLedger = latestLedger + 500; // ~40 minutes validation time

  const usdcContract = new Contract(STELLAR_USDC_CONTRACT);
  const approveOperation = usdcContract.call(
    'approve',
    new Address(senderAddress).toScVal(),
    new Address(spenderAddress).toScVal(),
    nativeToScVal(amountSubunits, { type: 'i128' }),
    nativeToScVal(expirationLedger, { type: 'u32' }),
  );

  const tx = new TransactionBuilder(txAccount, {
    fee: '1000000', // 0.1 XLM base fee ceiling
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(approveOperation)
    .setTimeout(300)
    .build();

  console.log('[StellarGateway] buildStellarApproveTx: simulating approval transaction…');
  const simResult = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    const simError = (simResult as SorobanRpc.Api.SimulateTransactionErrorResponse).error;
    console.error('[StellarGateway] buildStellarApproveTx: simulation failed:', simError);
    throw new Error(`Stellar approval simulation failed: ${simError}`);
  }

  const preparedTx = SorobanRpc.assembleTransaction(tx, simResult).build();
  return { xdr: preparedTx.toEnvelope().toXDR('base64') };
}

/**
 * Load a user's Stellar account sequence number from Soroban RPC.
 */
export async function loadStellarAccount(address: string): Promise<Account> {
  const server = new SorobanRpc.Server(STELLAR_RPC_URL);
  return loadAccountFromRpc(address, server);
}
