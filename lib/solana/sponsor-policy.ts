/**
 * What our Solana fee payer is willing to sign.
 *
 * The sponsor routes put our Circle fee-payer wallet's signature on a transaction the CLIENT
 * built. Circle's `signTransaction` is a raw signer — it applies no gas policy and reads none of
 * the instructions — so whatever this file lets through, our wallet authorises. Before this
 * existed, that was everything: a signed-in user could append `SystemProgram.transfer` from the
 * fee payer and empty it, make it pay rent for accounts they then closed, or burn its SOL on
 * priority fees.
 *
 * So the rule is an allowlist, not a denylist. A transaction is signed only if every instruction
 * is one we expect, every amount comes from the caller's own wallet, and the fee payer appears
 * nowhere except as the fee payer (plus, for a CCTP burn, the one slot we put it in ourselves).
 * A fee payer that is not named by any instruction can lose nothing but the fee, and the fee is
 * capped by the compute-budget limits below.
 *
 * Pure functions over decoded transactions, so every rule is unit-tested without a network.
 */

import { Buffer } from 'buffer';
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  DEPOSIT_FOR_BURN_DISCRIMINATOR,
  SOLANA_USDC_MINT,
  TOKEN_MESSENGER_MINTER_V2,
  decodeMintRecipientFromMessage,
} from '@/lib/circle/solana-gateway';

export type PolicyResult = { ok: true } | { ok: false; reason: string };

const MEMO_PROGRAM_IDS = new Set([
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',
]);

/** Generous for a token transfer or a burn; the runtime default is 200k per instruction. */
export const MAX_COMPUTE_UNITS = 400_000;

/**
 * Priority fee ceiling, in micro-lamports per compute unit. At MAX_COMPUTE_UNITS this caps the
 * priority fee at 0.00008 SOL per transaction — enough to land under congestion, too little to
 * be worth abusing.
 */
export const MAX_MICRO_LAMPORTS_PER_CU = 200_000n;

/** No legitimate sponsored transaction here needs more. */
export const MAX_INSTRUCTIONS = 6;

/** USDC's decimals, as TransferChecked carries them. */
const USDC_DECIMALS = 6;

const deny = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/**
 * Decode a client-supplied transaction, legacy format only.
 *
 * A v0 transaction can pull accounts in from address lookup tables, which this file cannot see
 * without a network call — so an instruction could name the fee payer without the key ever
 * appearing in the message. The previous route forwarded v0 bytes to Circle completely
 * unchecked for exactly that reason. Nothing we build is v0, so nothing v0 is accepted.
 */
export function decodeLegacyTransaction(base64: string): Transaction | null {
  try {
    const bytes = Buffer.from(base64, 'base64');
    const versioned = VersionedTransaction.deserialize(bytes);
    if (versioned.version !== 'legacy') return null;
    return Transaction.from(bytes);
  } catch {
    return null;
  }
}

function mentions(ix: TransactionInstruction, key: PublicKey): boolean {
  return ix.programId.equals(key) || ix.keys.some((k) => k.pubkey.equals(key));
}

/** ComputeBudget: only a capped unit limit and a capped unit price. */
function checkComputeBudget(ix: TransactionInstruction): PolicyResult {
  const kind = ix.data[0];
  if (kind === 2 && ix.data.length === 5) {
    const units = ix.data.readUInt32LE(1);
    return units <= MAX_COMPUTE_UNITS ? { ok: true } : deny('compute unit limit too high');
  }
  if (kind === 3 && ix.data.length === 9) {
    const price = ix.data.readBigUInt64LE(1);
    return price <= MAX_MICRO_LAMPORTS_PER_CU ? { ok: true } : deny('priority fee too high');
  }
  return deny('unsupported compute budget instruction');
}

/**
 * Exactly the accounts that must sign, and nobody else.
 *
 * A signer we did not expect is an account whose authority the transaction is borrowing; with
 * our signature on it, that account's permissions become usable by whoever added it.
 */
function checkSigners(tx: Transaction, expected: PublicKey[]): PolicyResult {
  const message = tx.compileMessage();
  const signers = message.accountKeys.slice(0, message.header.numRequiredSignatures);
  const want = new Set(expected.map((k) => k.toBase58()));
  if (signers.length !== want.size) return deny('unexpected signer set');
  for (const s of signers) if (!want.has(s.toBase58())) return deny('unexpected signer');
  return { ok: true };
}

/**
 * Most token accounts the fee payer will fund in one transaction: the recipient's and the
 * treasury's. Anything more is not a payment.
 */
export const MAX_RENT_PAID_ACCOUNTS = 2;

/**
 * Smallest send, in USDC subunits, for which we will pay to open a token account.
 *
 * Opening one costs ~0.002 SOL of rent — tens of cents. Paying that to deliver a few cents is a
 * bad trade, and a cheap way to farm the rent.
 */
export const MIN_SUBUNITS_FOR_NEW_ACCOUNT = 1_000_000n; // 1 USDC

export type TransferPolicyResult =
  | {
      ok: true;
      /** Token accounts the fee payer is rent payer for (CreateIdempotent — may already exist). */
      rentPaidAccounts: PublicKey[];
      /** USDC moved by the transaction, fee included, in subunits. */
      totalSubunits: bigint;
    }
  | { ok: false; reason: string };

/** The USDC account of `wallet`, for any owner — a PDA or other off-curve owner included. */
export function usdcAccountFor(wallet: PublicKey, mint: PublicKey = SOLANA_USDC_MINT): PublicKey {
  return getAssociatedTokenAddressSync(mint, wallet, true);
}

/**
 * A fee-payer-funded `CreateIdempotent`, checked account by account: the payer slot is the only
 * place the fee payer may appear, and the account it pays for must be exactly the USDC ATA of
 * the wallet named, under the real system and token programs.
 */
function checkRentPaidAtaCreate(
  ix: TransactionInstruction,
  params: { feePayer: PublicKey; owner: PublicKey; mint: PublicKey },
): PolicyResult {
  const { feePayer, owner, mint } = params;
  if (ix.data.length !== 1 || ix.data[0] !== 1) {
    return deny('a sponsored token account must use CreateIdempotent');
  }
  if (ix.keys.length !== 6) return deny('malformed ATA instruction');
  const [payer, ata, wallet, ixMint, system, token] = ix.keys;
  if (!payer.pubkey.equals(feePayer) || !payer.isSigner || !payer.isWritable) {
    return deny('malformed ATA payer');
  }
  for (const k of ix.keys.slice(1)) {
    if (k.pubkey.equals(feePayer)) return deny('fee payer referenced by an instruction');
    if (k.isSigner) return deny('unexpected signer in ATA instruction');
  }
  if (wallet.pubkey.equals(owner)) return deny("we do not pay for the caller's own account");
  if (!ixMint.pubkey.equals(mint)) return deny('ATA is not for USDC');
  if (!system.pubkey.equals(SystemProgram.programId)) return deny('wrong system program');
  if (!token.pubkey.equals(TOKEN_PROGRAM_ID)) return deny('wrong token program');
  if (!ata.pubkey.equals(usdcAccountFor(wallet.pubkey, mint))) {
    return deny('ATA does not match its wallet');
  }
  return { ok: true };
}

/**
 * A plain USDC payment from the caller: TransferChecked on USDC out of their own ATA, optionally
 * preceded by creating the destination ATAs, with memos and capped compute-budget instructions.
 * Used by /api/solana/sponsor and /api/solana/submit.
 *
 * A destination ATA may be created with the caller as rent payer (as the client builds it), or
 * — after `sponsorAtaRent` — with the fee payer as rent payer. The fee-payer case is narrow:
 * CreateIdempotent only, at most MAX_RENT_PAID_ACCOUNTS, and only for an account this same
 * transaction pays USDC into. Rent is the one thing the fee payer can lose beyond the fee, so
 * HOW OFTEN it does is bounded by the route (a per-user quota), not here.
 *
 * `tx.feePayer` is never trusted: signers are checked as though the fee payer were ours.
 */
export function checkSponsoredTransfer(
  tx: Transaction,
  params: { feePayer: PublicKey; owner: PublicKey; mint?: PublicKey },
): TransferPolicyResult {
  const { feePayer, owner } = params;
  const mint = params.mint ?? SOLANA_USDC_MINT;
  if (owner.equals(feePayer)) return deny('owner cannot be the fee payer');
  if (!tx.recentBlockhash) return deny('missing recent blockhash');

  const ixs = tx.instructions;
  if (ixs.length === 0 || ixs.length > MAX_INSTRUCTIONS) return deny('bad instruction count');

  const sourceAta = getAssociatedTokenAddressSync(mint, owner);
  const destinations = new Set<string>();
  const rentPaid: PublicKey[] = [];
  let transfers = 0;
  let total = 0n;

  for (const ix of ixs) {
    if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID) && ix.keys[0]?.pubkey.equals(feePayer)) {
      const r = checkRentPaidAtaCreate(ix, { feePayer, owner, mint });
      if (!r.ok) return r;
      rentPaid.push(ix.keys[1].pubkey);
      continue;
    }

    if (mentions(ix, feePayer)) return deny('fee payer referenced by an instruction');

    if (ix.programId.equals(ComputeBudgetProgram.programId)) {
      const r = checkComputeBudget(ix);
      if (!r.ok) return r;
      continue;
    }

    if (MEMO_PROGRAM_IDS.has(ix.programId.toBase58())) continue;

    if (ix.programId.equals(TOKEN_PROGRAM_ID)) {
      // TransferChecked: [12, amount u64, decimals u8]; accounts [source, mint, dest, authority].
      if (ix.data.length !== 10 || ix.data[0] !== 12) return deny('only TransferChecked is allowed');
      if (ix.data[9] !== USDC_DECIMALS) return deny('wrong decimals');
      if (ix.keys.length !== 4) return deny('multisig authorities are not supported');
      const [source, ixMint, dest, authority] = ix.keys;
      if (!source.pubkey.equals(sourceAta)) return deny("source is not the caller's USDC account");
      if (!ixMint.pubkey.equals(mint)) return deny('not USDC');
      if (!authority.pubkey.equals(owner)) return deny('authority is not the caller');
      const amount = Buffer.from(ix.data).readBigUInt64LE(1);
      if (amount === 0n) return deny('zero-amount transfer');
      destinations.add(dest.pubkey.toBase58());
      total += amount;
      transfers++;
      continue;
    }

    if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      // Create (empty data or 0) / CreateIdempotent (1); accounts [payer, ata, wallet, mint, ...].
      const kind = ix.data.length === 0 ? 0 : ix.data[0];
      if (ix.data.length > 1 || (kind !== 0 && kind !== 1)) return deny('unsupported ATA instruction');
      if (ix.keys.length < 6) return deny('malformed ATA instruction');
      if (!ix.keys[0].pubkey.equals(owner)) return deny('ATA rent must be paid by the caller');
      if (!ix.keys[3].pubkey.equals(mint)) return deny('ATA is not for USDC');
      continue;
    }

    return deny(`program ${ix.programId.toBase58()} is not allowed`);
  }

  if (transfers === 0) return deny('no USDC transfer');

  if (rentPaid.length > MAX_RENT_PAID_ACCOUNTS) return deny('too many sponsored token accounts');
  const seen = new Set<string>();
  for (const ata of rentPaid) {
    const key = ata.toBase58();
    if (seen.has(key)) return deny('duplicate sponsored token account');
    seen.add(key);
    // Rent for an account nothing is paid into is rent for somebody else's purposes.
    if (!destinations.has(key)) return deny('sponsored token account receives nothing');
  }

  const probe = cloneWithFeePayer(tx, feePayer);
  const signers = checkSigners(probe, [feePayer, owner]);
  if (!signers.ok) return signers;
  return { ok: true, rentPaidAccounts: rentPaid, totalSubunits: total };
}

/**
 * Move the rent of every caller-paid CreateIdempotent onto the fee payer, and make the fee payer
 * the transaction's fee payer. Run on a transaction `checkSponsoredTransfer` accepted; the
 * result must pass it again (the route re-checks).
 *
 * The client builds with the caller as rent payer because the caller is the only key it knows;
 * the caller holds no SOL, so left as is the create would fail for want of rent.
 */
export function sponsorAtaRent(tx: Transaction, owner: PublicKey, feePayer: PublicKey): void {
  for (const ix of tx.instructions) {
    if (!ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) continue;
    if (ix.data.length !== 1 || ix.data[0] !== 1) continue;
    if (ix.keys[0]?.pubkey.equals(owner)) {
      ix.keys[0] = { pubkey: feePayer, isSigner: true, isWritable: true };
    }
  }
  tx.feePayer = feePayer;
}

/**
 * Whether a send that opens `newAccounts` token accounts moves enough to be worth their rent.
 */
export function newAccountMinimumMet(totalSubunits: bigint, newAccounts: number): boolean {
  return newAccounts === 0 || totalSubunits >= MIN_SUBUNITS_FOR_NEW_ACCOUNT;
}

/** `deposit_for_burn` account slots — see `buildDepositForBurnTx` in lib/circle/solana-gateway. */
export const BURN_EVENT_RENT_PAYER_INDEX = 1;
const BURN_OWNER_INDEX = 0;
const BURN_TOKEN_ACCOUNT_INDEX = 3;
const BURN_MINT_INDEX = 10;
const BURN_EVENT_DATA_INDEX = 11;
const BURN_ACCOUNT_COUNT = 18;

/**
 * A CCTP V2 `deposit_for_burn` of the caller's own USDC, plus capped compute-budget
 * instructions. Used by /api/bridge/solana-sponsor.
 *
 * The client builds it with the caller as `event_rent_payer` (slot 1); the route then moves
 * that slot to the fee payer, because the user has no SOL for the event account's rent. That one
 * slot is the only place the fee payer may appear, and the program uses it for nothing else.
 *
 * Call BEFORE the rewrite — this checks the transaction as the client sent it.
 */
export function checkSponsoredBurn(
  tx: Transaction,
  params: { feePayer: PublicKey; owner: PublicKey; mint?: PublicKey },
): PolicyResult {
  const { feePayer, owner } = params;
  const mint = params.mint ?? SOLANA_USDC_MINT;
  if (owner.equals(feePayer)) return deny('owner cannot be the fee payer');
  if (!tx.recentBlockhash) return deny('missing recent blockhash');

  const ixs = tx.instructions;
  if (ixs.length === 0 || ixs.length > MAX_INSTRUCTIONS) return deny('bad instruction count');

  let burn: TransactionInstruction | null = null;
  for (const ix of ixs) {
    if (mentions(ix, feePayer)) return deny('fee payer referenced by an instruction');

    if (ix.programId.equals(ComputeBudgetProgram.programId)) {
      const r = checkComputeBudget(ix);
      if (!r.ok) return r;
      continue;
    }
    if (ix.programId.equals(TOKEN_MESSENGER_MINTER_V2)) {
      if (burn) return deny('more than one burn');
      burn = ix;
      continue;
    }
    return deny(`program ${ix.programId.toBase58()} is not allowed`);
  }

  if (!burn) return deny('no burn instruction');
  if (!burn.data.subarray(0, 8).equals(DEPOSIT_FOR_BURN_DISCRIMINATOR)) {
    return deny('only deposit_for_burn is allowed');
  }
  if (burn.keys.length !== BURN_ACCOUNT_COUNT) return deny('unexpected burn accounts');

  const k = burn.keys;
  if (!k[BURN_OWNER_INDEX].pubkey.equals(owner)) return deny('burn owner is not the caller');
  if (!k[BURN_EVENT_RENT_PAYER_INDEX].pubkey.equals(owner)) {
    return deny('event rent payer must be the caller before sponsoring');
  }
  if (!k[BURN_TOKEN_ACCOUNT_INDEX].pubkey.equals(getAssociatedTokenAddressSync(mint, owner))) {
    return deny("burn source is not the caller's USDC account");
  }
  if (!k[BURN_MINT_INDEX].pubkey.equals(mint)) return deny('not USDC');

  const eventData = k[BURN_EVENT_DATA_INDEX];
  if (!eventData.isSigner || eventData.pubkey.equals(owner)) {
    return deny('malformed event data account');
  }

  const probe = cloneWithFeePayer(tx, feePayer);
  probe.instructions
    .find((ix) => ix.programId.equals(TOKEN_MESSENGER_MINTER_V2))!
    .keys[BURN_EVENT_RENT_PAYER_INDEX].pubkey = feePayer;
  return checkSigners(probe, [feePayer, owner, eventData.pubkey]);
}

/** A copy to compile against, so checking never mutates the transaction being checked. */
function cloneWithFeePayer(tx: Transaction, feePayer: PublicKey): Transaction {
  const copy = new Transaction({ recentBlockhash: tx.recentBlockhash, feePayer });
  for (const ix of tx.instructions) {
    copy.add({
      programId: ix.programId,
      data: Buffer.from(ix.data),
      keys: ix.keys.map((k) => ({ ...k })),
    });
  }
  return copy;
}

/**
 * Which of the caller's wallets a CCTP message mints to, or null if none.
 *
 * A sponsored claim spends our SOL — and creates the token account at our expense when it is
 * missing — so it is only done for money arriving at the caller's own USDC account. Our burns
 * always name the recipient's ATA (see `solanaMintRecipientBytes32`), so that is the one match.
 */
export function claimRecipientOwner(
  messageBytes: string,
  callerWallets: string[],
  mint: PublicKey = SOLANA_USDC_MINT,
): string | null {
  let recipient: PublicKey;
  try {
    recipient = decodeMintRecipientFromMessage(messageBytes);
  } catch {
    return null;
  }
  for (const wallet of callerWallets) {
    try {
      if (getAssociatedTokenAddressSync(mint, new PublicKey(wallet)).equals(recipient)) {
        return wallet;
      }
    } catch {
      /* not a valid key — cannot be the recipient */
    }
  }
  return null;
}
