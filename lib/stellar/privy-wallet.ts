/**
 * Stellar Wallet via Privy TEE
 *
 * Full zero-XLM-for-users flow:
 *   1. Privy TEE generates the Stellar keypair — user gets a permanent G-address
 *   2. Sponsor auto-sends 2 XLM to activate the account on-chain
 *   3. Sponsor fee-bumps a changeTrust tx to add the USDC trustline
 *   4. All future transactions are fee-bumped by the sponsor
 *   → Users never see, hold, or spend XLM. They just send and receive USDC.
 *
 * Required env vars:
 *   PRIVY_AUTHORIZATION_PRIVATE_KEY  — base64 PKCS8 P-256 key (Privy Dashboard →
 *                                      Wallet infrastructure → Authorization keys)
 *   STELLAR_SPONSOR_SECRET_KEY       — S... Stellar secret key, keep 5–10 XLM funded
 */

import {
  Asset,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { PrivyClient } from '@privy-io/node';

// ── Privy client ─────────────────────────────────────────────────────────────

const privy = new PrivyClient({
  appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID || '',
  appSecret: process.env.PRIVY_APP_SECRET || '',
});

// ── Network constants ─────────────────────────────────────────────────────────

export const STELLAR_HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ?? 'https://horizon.stellar.org';

export const STELLAR_NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? Networks.PUBLIC;

const USDC_CLASSIC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const USDC_ASSET = new Asset('USDC', USDC_CLASSIC_ISSUER);

/**
 * XLM sent by sponsor to each new user wallet:
 *   1.0 XLM  base account reserve (2 × 0.5 base_reserve)
 *   0.5 XLM  USDC trustline reserve (1 × 0.5 base_reserve per trustline)
 *   0.1 XLM  transaction fee buffer for the user's future fee-bumped operations
 *   ───────
 *   1.6 XLM  total per new wallet activation
 *
 * Note: sponsor needs available balance > ACTIVATION_XLM + fees.
 * Keep sponsor funded with at least 5 XLM above its 1 XLM base reserve.
 */
const ACTIVATION_XLM = '1.6';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PrivyStellarWallet {
  /** Privy wallet ID — required for server-side signing */
  walletId: string;
  /** Stellar G... public key address */
  address: string;
  /** true = account activated + USDC trustline set, user can send/receive USDC */
  trustlineReady: boolean;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function tag(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getAuthorizationContext() {
  const authKey = process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY;
  if (!authKey) {
    throw new Error(
      'PRIVY_AUTHORIZATION_PRIVATE_KEY is not set. ' +
      'Privy Dashboard → Wallet infrastructure → Authorization keys → New key.',
    );
  }
  return { authorization_private_keys: [authKey] };
}

function getSponsorKeypair(): Keypair {
  const secret = process.env.STELLAR_SPONSOR_SECRET_KEY;
  if (!secret) {
    throw new Error(
      'STELLAR_SPONSOR_SECRET_KEY is not configured. ' +
      'Generate a Stellar keypair, fund it with 5–10 XLM, and add the secret key to your .env.',
    );
  }
  return Keypair.fromSecret(secret);
}

async function loadHorizonAccount(address: string) {
  const res = await fetch(`${STELLAR_HORIZON_URL}/accounts/${address}`);
  if (!res.ok) {
    throw new Error(
      `[StellarPrivy] Account ${tag(address)} not found on ${STELLAR_HORIZON_URL}. ` +
      `Make sure the account is funded and the STELLAR_HORIZON_URL points to the correct network.`,
    );
  }
  const data = (await res.json()) as { sequence: string };
  const { Account } = await import('@stellar/stellar-sdk');
  return new Account(address, data.sequence);
}

async function accountExistsOnChain(address: string): Promise<boolean> {
  const res = await fetch(`${STELLAR_HORIZON_URL}/accounts/${address}`);
  return res.ok;
}

async function checkTrustlineStatus(
  address: string,
): Promise<'ready' | 'missing' | 'not_activated'> {
  try {
    const res = await fetch(`${STELLAR_HORIZON_URL}/accounts/${address}`);
    if (res.status === 404) return 'not_activated';
    if (!res.ok) return 'not_activated';

    const data = (await res.json()) as {
      balances?: { asset_code?: string; asset_issuer?: string; asset_type?: string; balance?: string }[];
    };

    const hasTrustline = data.balances?.some(
      (b) => b.asset_code === 'USDC' && b.asset_issuer === USDC_CLASSIC_ISSUER,
    );
    return hasTrustline ? 'ready' : 'missing';
  } catch (err) {
    console.error('[StellarPrivy] checkTrustlineStatus error:', (err as Error).message);
    return 'not_activated';
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Submit a signed XDR transaction to the Stellar Horizon network.
 */
export async function submitStellarTransaction(
  signedXdr: string,
): Promise<{ hash: string; successful: boolean }> {
  const res = await fetch(`${STELLAR_HORIZON_URL}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ tx: signedXdr }),
  });

  const data = (await res.json()) as {
    hash?: string;
    successful?: boolean;
    title?: string;
    extras?: { result_codes?: { transaction?: string; operations?: string[] } };
  };

  if (!res.ok) {
    const opCodes = data.extras?.result_codes?.operations?.join(', ') ?? '';
    const txCode = data.extras?.result_codes?.transaction ?? '';
    throw new Error(
      `Horizon submission failed: ${data.title ?? res.statusText}. ` +
      `tx=${txCode} ops=[${opCodes}]`,
    );
  }

  return { hash: data.hash ?? '', successful: data.successful ?? true };
}

/**
 * Wrap a signed inner transaction in a fee-bump paid by the sponsor.
 * Every user-facing transaction goes through this so users never pay XLM fees.
 *
 * Fee requirements:
 *   - Regular transactions (payment, changeTrust): 1,000 stroops is fine
 *   - Soroban transactions (approve, depositForBurn): minimum 1,000,000 stroops
 *
 * We default to 1,000,000 stroops to handle both cases safely.
 * At 0.1 XLM per fee-bump, the sponsor's 4 XLM covers ~40 bridge operations.
 *
 * @param feeStroops  Base fee in stroops (default 1,000,000 = 0.1 XLM, required for Soroban)
 */
export async function buildFeeBumpTransaction(
  innerSignedXdr: string,
  feeStroops = 1_000_000,
): Promise<string> {
  const sponsorKeypair = getSponsorKeypair();

  // Verify sponsor is on-chain before attempting the bump
  const sponsorAddress = sponsorKeypair.publicKey();
  const sponsorRes = await fetch(`${STELLAR_HORIZON_URL}/accounts/${sponsorAddress}`);
  if (!sponsorRes.ok) {
    throw new Error(
      `[StellarPrivy] Sponsor account ${tag(sponsorAddress)} is not funded on this network. ` +
      `Send at least 5 XLM to ${sponsorAddress} before using fee bumping.`,
    );
  }

  const sponsorData = (await sponsorRes.json()) as {
    balances?: { asset_type?: string; balance?: string }[];
  };
  const xlmEntry = sponsorData.balances?.find((b) => b.asset_type === 'native');
  const xlmBalance = parseFloat(xlmEntry?.balance ?? '0');
  console.log(`[StellarPrivy] Sponsor ${tag(sponsorAddress)} XLM balance: ${xlmBalance}`);

  if (xlmBalance < 1.5) {
    throw new Error(
      `[StellarPrivy] Sponsor account ${tag(sponsorAddress)} has insufficient XLM (${xlmBalance}). ` +
      `Top up to at least 5 XLM. Soroban fee-bumps cost 0.1 XLM each.`,
    );
  }

  const innerTx = new Transaction(innerSignedXdr, STELLAR_NETWORK_PASSPHRASE);

  const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
    sponsorKeypair,
    feeStroops.toString(),
    innerTx,
    STELLAR_NETWORK_PASSPHRASE,
  );

  feeBumpTx.sign(sponsorKeypair);
  return feeBumpTx.toEnvelope().toXDR('base64');
}

/**
 * Sign a Stellar transaction XDR using Privy's rawSign endpoint.
 *
 * Privy Stellar wallets only support `hash` mode — we pre-compute the
 * transaction hash via tx.hash() and pass it directly.
 *
 * tx.hash() = sha256(sha256(network_passphrase) || ENVELOPE_TYPE_TX || tx_body)
 */
export async function signStellarTransaction(
  walletId: string,
  txXdr: string,
  stellarAddress: string,
): Promise<string> {
  console.log(`[StellarPrivy] Signing tx for ${tag(stellarAddress)} via Privy TEE...`);

  const tx = new Transaction(txXdr, STELLAR_NETWORK_PASSPHRASE);
  const txHashBytes: Buffer = tx.hash();
  const txHashHex = '0x' + txHashBytes.toString('hex');

  const signResult = await privy.wallets().rawSign(walletId, {
    params: { hash: txHashHex },
    authorization_context: getAuthorizationContext(),
  });

  const sigHex = signResult.signature.replace(/^0x/i, '');
  const sigBase64 = Buffer.from(sigHex, 'hex').toString('base64');

  tx.addSignature(stellarAddress, sigBase64);
  console.log(`[StellarPrivy] Signed successfully for ${tag(stellarAddress)}`);
  return tx.toEnvelope().toXDR('base64');
}

/**
 * Sponsor activates a new user wallet by sending 2 XLM via createAccount.
 * This is called automatically on first wallet creation.
 */
async function sponsorActivateWallet(userAddress: string): Promise<void> {
  const sponsorKeypair = getSponsorKeypair();
  const sponsorAddress = sponsorKeypair.publicKey();

  console.log(
    `[StellarPrivy] Activating wallet ${tag(userAddress)} — ` +
    `sponsor ${tag(sponsorAddress)} sending ${ACTIVATION_XLM} XLM...`,
  );

  const sponsorAccount = await loadHorizonAccount(sponsorAddress);

  // Pre-flight: verify sponsor has enough available balance
  // Sponsor minimum reserve = 1 XLM (2 × 0.5 base_reserve for the account itself)
  // Required available = ACTIVATION_XLM + ~0.001 XLM for fees
  const sponsorRes = await fetch(`${STELLAR_HORIZON_URL}/accounts/${sponsorAddress}`);
  const sponsorData = (await sponsorRes.json()) as {
    balances?: { asset_type?: string; balance?: string }[];
  };
  const sponsorXlm = parseFloat(
    sponsorData.balances?.find((b) => b.asset_type === 'native')?.balance ?? '0',
  );
  const sponsorReserve = 1.0; // 2 × 0.5 base_reserve
  const sponsorAvailable = sponsorXlm - sponsorReserve;
  const activationAmount = parseFloat(ACTIVATION_XLM);

  console.log(
    `[StellarPrivy] Sponsor balance: ${sponsorXlm} XLM | ` +
    `Reserve: ${sponsorReserve} XLM | Available: ${sponsorAvailable.toFixed(4)} XLM | ` +
    `Needed: ${activationAmount} XLM`,
  );

  if (sponsorAvailable < activationAmount + 0.01) {
    throw new Error(
      `[StellarPrivy] Sponsor ${tag(sponsorAddress)} has insufficient balance. ` +
      `Available: ${sponsorAvailable.toFixed(4)} XLM, needed: ${activationAmount + 0.01} XLM. ` +
      `Top up the sponsor account to continue. Current total: ${sponsorXlm} XLM.`,
    );
  }

  const tx = new TransactionBuilder(sponsorAccount, {
    fee: '1000',
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.createAccount({
        destination: userAddress,
        startingBalance: ACTIVATION_XLM,
      }),
    )
    .setTimeout(300)
    .build();

  tx.sign(sponsorKeypair);

  const result = await submitStellarTransaction(tx.toEnvelope().toXDR('base64'));
  console.log(
    `[StellarPrivy] ✓ Wallet ${tag(userAddress)} activated with ${ACTIVATION_XLM} XLM. ` +
    `tx=${result.hash}`,
  );
}

/**
 * Ensure the USDC trustline is present on the account.
 * If missing, signs a changeTrust tx (user's Privy key) and fee-bumps it (sponsor pays).
 *
 * Returns true if trustline is ready, false only if account isn't activated yet.
 */
export async function ensureTrustline(
  walletId: string,
  address: string,
): Promise<boolean> {
  const status = await checkTrustlineStatus(address);
  console.log(`[StellarPrivy] Trustline status for ${tag(address)}: ${status}`);

  if (status === 'ready') {
    console.log(`[StellarPrivy] ✓ USDC trustline already set for ${tag(address)}`);
    return true;
  }

  if (status === 'not_activated') {
    console.warn(`[StellarPrivy] Account ${tag(address)} not yet activated on Stellar — needs XLM first.`);
    return false;
  }

  // Account exists, no trustline yet — add it now
  console.log(`[StellarPrivy] Adding USDC trustline for ${tag(address)}...`);

  const userAccount = await loadHorizonAccount(address);

  const innerTx = new TransactionBuilder(userAccount, {
    fee: '500',
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.changeTrust({ asset: USDC_ASSET }))
    .setTimeout(300)
    .build();

  const signedInner = await signStellarTransaction(
    walletId,
    innerTx.toEnvelope().toXDR('base64'),
    address,
  );

  const feeBumpXdr = await buildFeeBumpTransaction(signedInner, 1000);
  console.log(`[StellarPrivy] Fee bump applied for trustline tx on ${tag(address)}.`);

  const result = await submitStellarTransaction(feeBumpXdr);
  console.log(`[StellarPrivy] ✓ USDC trustline set for ${tag(address)}. tx=${result.hash}`);
  return true;
}

/**
 * Provision a Stellar wallet — the only function you need to call.
 * Handles everything automatically: wallet creation, activation, trustline.
 * Users just get their address and can send/receive USDC immediately.
 *
 * IDEMPOTENT — safe to call on every login/page load.
 * Returns the same wallet every time for the same Privy user ID.
 *
 * New user flow (first call):
 *   1. Create Stellar keypair in Privy TEE → permanent G-address
 *   2. Sponsor sends 2 XLM → activates account on-chain
 *   3. User signs changeTrust → sponsor fee-bumps → USDC trustline set
 *   → trustlineReady: true — wallet is fully operational
 *
 * Returning user flow:
 *   - Returns existing wallet from Privy
 *   - Skips activation (already funded)
 *   - Re-checks trustline (adds if somehow missing)
 */
export async function provisionStellarWallet(
  privyUserId: string,
): Promise<PrivyStellarWallet> {
  console.log(`[StellarPrivy] provisionStellarWallet called for user ${privyUserId.slice(0, 20)}...`);

  // ── Step 1: Get or create wallet in Privy TEE ──────────────────────────────
  // Use a simple in-memory lock to prevent concurrent wallet creation
  // when multiple requests arrive simultaneously for the same user.
  const existingWallets = await privy.wallets().list({
    user_id: privyUserId,
    chain_type: 'stellar',
  });

  let walletId: string;
  let address: string;
  let isNewWallet = false;

  const first = existingWallets.data?.[0];
  if (first?.id && first?.address) {
    console.log(`[StellarPrivy] Found existing Privy wallet: ${first.address}`);
    walletId = first.id;
    address = first.address;
  } else {
    console.log('[StellarPrivy] No existing wallet — creating new Stellar wallet in Privy TEE...');

    // Check once more with a small delay to handle race conditions where
    // a parallel request may have just created the wallet
    await new Promise((r) => setTimeout(r, 500));
    const recheckWallets = await privy.wallets().list({
      user_id: privyUserId,
      chain_type: 'stellar',
    });
    const recheck = recheckWallets.data?.[0];
    if (recheck?.id && recheck?.address) {
      console.log(`[StellarPrivy] Race condition resolved — found wallet on recheck: ${recheck.address}`);
      walletId = recheck.id;
      address = recheck.address;
    } else {
      const wallet = await privy.wallets().create({
        chain_type: 'stellar',
        owner: { user_id: privyUserId },
      });

      if (!wallet.id || !wallet.address) {
        throw new Error('[StellarPrivy] Privy returned an empty wallet — check your Privy credentials.');
      }

      console.log(`[StellarPrivy] ✓ New Stellar wallet created: ${wallet.address}`);
      walletId = wallet.id;
      address = wallet.address;
      isNewWallet = true;
    }
  }

  // ── Step 2: Activate account on-chain if needed ────────────────────────────
  const onChain = await accountExistsOnChain(address);
  console.log(`[StellarPrivy] Account ${tag(address)} on-chain: ${onChain}`);

  if (isNewWallet || !onChain) {
    try {
      await sponsorActivateWallet(address);
    } catch (err) {
      const msg = (err as Error).message;
      // createAccount fails if the account already exists — safe to skip
      if (msg.includes('op_already_exists') || msg.includes('ACCOUNT_EXISTS') || msg.includes('tx_bad_seq')) {
        console.log(`[StellarPrivy] Account ${tag(address)} already exists — skipping activation.`);
      } else {
        console.error(`[StellarPrivy] ✗ Activation failed for ${tag(address)}:`, msg);
        return { walletId, address, trustlineReady: false };
      }
    }
  }

  // ── Step 3: Ensure USDC trustline ─────────────────────────────────────────
  let trustlineReady = false;
  try {
    trustlineReady = await ensureTrustline(walletId, address);
  } catch (err) {
    console.error(`[StellarPrivy] ✗ ensureTrustline failed for ${tag(address)}:`, (err as Error).message);
  }

  if (trustlineReady) {
    console.log(`[StellarPrivy] ✓ Wallet ${tag(address)} fully operational — USDC ready.`);
  } else {
    console.warn(`[StellarPrivy] ⚠ Wallet ${tag(address)} provisioned but trustline not yet set.`);
  }

  return { walletId, address, trustlineReady };
}
