/**
 * Stellar Transaction Builders
 *
 * Builds unsigned Stellar transaction XDRs for common operations:
 *   - USDC payment (Stellar → Stellar)
 *   - CCTP bridge (Stellar → Base via depositForBurn)
 *
 * These are server-side helpers. Signing is done via Privy TEE in privy-wallet.ts.
 * Submission is done via submitStellarTransaction in privy-wallet.ts.
 */

import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';

// ── Constants ────────────────────────────────────────────────────────────────

const STELLAR_HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ?? 'https://horizon.stellar.org';

const STELLAR_RPC_URL =
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL ??
  'https://soroban-rpc.mainnet.stellar.gateway.fm';

const STELLAR_NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? Networks.PUBLIC;

/** Circle's USDC classic asset issuer on Stellar mainnet */
const USDC_CLASSIC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const USDC_ASSET = new Asset('USDC', USDC_CLASSIC_ISSUER);

// ── Account helpers ───────────────────────────────────────────────────────────

/**
 * Load a Stellar account's sequence number from Horizon.
 */
export async function loadAccount(address: string): Promise<Account> {
  const res = await fetch(`${STELLAR_HORIZON_URL}/accounts/${address}`);
  if (!res.ok) {
    throw new Error(
      `Stellar account not found. Make sure the account has been funded with at least 1 XLM. (${address.slice(0, 6)}...)`,
    );
  }
  const data = (await res.json()) as { sequence: string };
  return new Account(address, data.sequence);
}

// ── USDC balance ──────────────────────────────────────────────────────────────

/**
 * Get a Stellar account's USDC (classic) balance.
 */
export async function getStellarUsdcBalance(address: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${STELLAR_HORIZON_URL}/accounts/${address}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return '0';
    const data = (await res.json()) as {
      balances?: { asset_code?: string; asset_issuer?: string; balance?: string }[];
    };
    const usdcEntry = data.balances?.find(
      (b) => b.asset_code === 'USDC' && b.asset_issuer === USDC_CLASSIC_ISSUER,
    );
    return usdcEntry?.balance ?? '0';
  } catch {
    return '0';
  }
}

/**
 * Get a Stellar account's XLM (native) balance.
 */
export async function getStellarXlmBalance(address: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${STELLAR_HORIZON_URL}/accounts/${address}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return '0';
    const data = (await res.json()) as {
      balances?: { asset_type?: string; balance?: string }[];
    };
    const xlmEntry = data.balances?.find((b) => b.asset_type === 'native');
    return xlmEntry?.balance ?? '0';
  } catch {
    return '0';
  }
}

/**
 * Check if account exists on Stellar network.
 */
export async function stellarAccountExists(address: string): Promise<boolean> {
  const res = await fetch(`${STELLAR_HORIZON_URL}/accounts/${address}`);
  return res.ok;
}

// ── USDC Payment Builder ──────────────────────────────────────────────────────

export interface BuildUsdcPaymentResult {
  /** Base64 XDR of the unsigned transaction — pass to signStellarTransaction */
  xdr: string;
  /** Human-readable fee in XLM */
  feeXlm: string;
}

/**
 * Build a Stellar USDC (classic) payment transaction.
 * The caller must:
 *   1. sign with signStellarTransaction(walletId, xdr, senderAddress)
 *   2. optionally fee-bump with buildFeeBumpTransaction(signedXdr)
 *   3. submit with submitStellarTransaction(signedOrBumpedXdr)
 *
 * @param senderAddress   Sender's G... Stellar address
 * @param recipientAddress  Recipient's G... Stellar address
 * @param amount          USDC amount as string e.g. "10.00"
 * @param memo            Optional text memo (max 28 bytes)
 */
export async function buildUsdcPaymentTx(
  senderAddress: string,
  recipientAddress: string,
  amount: string,
  memo?: string,
): Promise<BuildUsdcPaymentResult> {
  const account = await loadAccount(senderAddress);

  const builder = new TransactionBuilder(account, {
    fee: '100',  // 100 stroops = 0.00001 XLM (minimum)
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  }).addOperation(
    Operation.payment({
      destination: recipientAddress,
      asset: USDC_ASSET,
      amount,
    }),
  );

  if (memo) {
    builder.addMemo({ type: 'text', value: memo } as any);
  }

  const tx = builder.setTimeout(300).build();

  return {
    xdr: tx.toEnvelope().toXDR('base64'),
    feeXlm: (parseInt('100') / 10_000_000).toFixed(7),
  };
}

// ── Trustline Builder ─────────────────────────────────────────────────────────

/**
 * Build a transaction to add the USDC trustline for a new Stellar account.
 * Required before receiving USDC. Only needs to be done once.
 */
export async function buildAddUsdcTrustlineTx(
  address: string,
): Promise<{ xdr: string }> {
  const account = await loadAccount(address);

  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.changeTrust({
        asset: USDC_ASSET,
      }),
    )
    .setTimeout(300)
    .build();

  return { xdr: tx.toEnvelope().toXDR('base64') };
}

// ── Merge / Recovery ──────────────────────────────────────────────────────────

/**
 * Build a transaction to merge the user's Stellar account into a destination
 * (used for fund recovery — sends all XLM and closes the account).
 * USDC must be sent to 0 balance first before merging.
 */
export async function buildAccountMergeTx(
  address: string,
  destinationAddress: string,
): Promise<{ xdr: string }> {
  const account = await loadAccount(address);

  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.accountMerge({
        destination: destinationAddress,
      }),
    )
    .setTimeout(300)
    .build();

  return { xdr: tx.toEnvelope().toXDR('base64') };
}
