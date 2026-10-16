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

const deny = (reason: string): PolicyResult => ({ ok: false, reason });

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
 * A plain USDC payment from the caller: TransferChecked on USDC out of their own ATA, optionally
 * preceded by creating the destination ATA (rent paid by the caller), with memos and capped
 * compute-budget instructions. Used by /api/solana/sponsor.
 *
 * Call BEFORE setting the fee payer — `tx.feePayer` is replaced, not trusted.
 */
export function checkSponsoredTransfer(
  tx: Transaction,
  params: { feePayer: PublicKey; owner: PublicKey; mint?: PublicKey },
): PolicyResult {
  const { feePayer, owner } = params;
  const mint = params.mint ?? SOLANA_USDC_MINT;
  if (owner.equals(feePayer)) return deny('owner cannot be the fee payer');
  if (!tx.recentBlockhash) return deny('missing recent blockhash');

  const ixs = tx.instructions;
  if (ixs.length === 0 || ixs.length > MAX_INSTRUCTIONS) return deny('bad instruction count');

  const sourceAta = getAssociatedTokenAddressSync(mint, owner);
  let transfers = 0;

  for (const ix of ixs) {
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
      const [source, ixMint, , authority] = ix.keys;
      if (!source.pubkey.equals(sourceAta)) return deny("source is not the caller's USDC account");
      if (!ixMint.pubkey.equals(mint)) return deny('not USDC');
      if (!authority.pubkey.equals(owner)) return deny('authority is not the caller');
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

  const probe = cloneWithFeePayer(tx, feePayer);
  return checkSigners(probe, [feePayer, owner]);
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
 * instructions and, optionally, one platform-fee transfer. Used by /api/bridge/solana-sponsor.
 *
 * The fee transfer is a USDC TransferChecked from the caller's own token account to the token
 * account of `feeTreasury` (FEE_TREASURY_SOLANA) — nowhere else. It moves the caller's USDC, not
 * ours, so its amount is the caller's business; only its destination is ours to pin. Without a
 * configured treasury no token instruction is accepted at all.
 *
 * The client builds it with the caller as `event_rent_payer` (slot 1); the route then moves
 * that slot to the fee payer, because the user has no SOL for the event account's rent. That one
 * slot is the only place the fee payer may appear, and the program uses it for nothing else.
 *
 * Call BEFORE the rewrite — this checks the transaction as the client sent it.
 */
export function checkSponsoredBurn(
  tx: Transaction,
  params: {
    feePayer: PublicKey;
    owner: PublicKey;
    mint?: PublicKey;
    feeTreasury?: PublicKey | null;
  },
): PolicyResult {
  const { feePayer, owner, feeTreasury } = params;
  const mint = params.mint ?? SOLANA_USDC_MINT;
  if (owner.equals(feePayer)) return deny('owner cannot be the fee payer');
  if (!tx.recentBlockhash) return deny('missing recent blockhash');

  const ixs = tx.instructions;
  if (ixs.length === 0 || ixs.length > MAX_INSTRUCTIONS) return deny('bad instruction count');

  const sourceAta = getAssociatedTokenAddressSync(mint, owner);
  let burn: TransactionInstruction | null = null;
  let feeTransfers = 0;
  for (const ix of ixs) {
    if (mentions(ix, feePayer)) return deny('fee payer referenced by an instruction');

    if (ix.programId.equals(ComputeBudgetProgram.programId)) {
      const r = checkComputeBudget(ix);
      if (!r.ok) return r;
      continue;
    }
    if (ix.programId.equals(TOKEN_PROGRAM_ID)) {
      if (!feeTreasury) return deny('no fee treasury configured for a fee transfer');
      if (feeTransfers > 0) return deny('more than one fee transfer');
      const r = checkFeeTransfer(ix, {
        sourceAta,
        owner,
        mint,
        treasuryAta: getAssociatedTokenAddressSync(mint, feeTreasury, true),
      });
      if (!r.ok) return r;
      feeTransfers++;
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

/** TransferChecked of USDC from the caller's own account to the fee treasury's account. */
function checkFeeTransfer(
  ix: TransactionInstruction,
  p: { sourceAta: PublicKey; owner: PublicKey; mint: PublicKey; treasuryAta: PublicKey },
): PolicyResult {
  // TransferChecked: [12, amount u64, decimals u8]; accounts [source, mint, dest, authority].
  if (ix.data.length !== 10 || ix.data[0] !== 12) return deny('only TransferChecked is allowed');
  if (ix.data[9] !== USDC_DECIMALS) return deny('wrong decimals');
  if (ix.keys.length !== 4) return deny('multisig authorities are not supported');
  const [source, ixMint, dest, authority] = ix.keys;
  if (!source.pubkey.equals(p.sourceAta)) return deny("fee source is not the caller's USDC account");
  if (!ixMint.pubkey.equals(p.mint)) return deny('not USDC');
  if (!dest.pubkey.equals(p.treasuryAta)) return deny('fee must go to the fee treasury');
  if (!authority.pubkey.equals(p.owner)) return deny('authority is not the caller');
  return { ok: true };
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
