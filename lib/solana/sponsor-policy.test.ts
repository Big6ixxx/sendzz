import { describe, it, expect } from 'vitest';
import { Buffer } from 'buffer';
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { buildDepositForBurnTx, SOLANA_USDC_MINT } from '@/lib/circle/solana-gateway';
import {
  BURN_EVENT_RENT_PAYER_INDEX,
  MIN_SUBUNITS_FOR_NEW_ACCOUNT,
  checkSponsoredBurn,
  checkSponsoredTransfer,
  claimRecipientOwner,
  decodeLegacyTransaction,
  newAccountMinimumMet,
  sponsorAtaRent,
  usdcAccountFor,
} from './sponsor-policy';

const mint = SOLANA_USDC_MINT;
const feePayer = Keypair.generate().publicKey;
const owner = Keypair.generate().publicKey;
const stranger = Keypair.generate().publicKey;
const blockhash = Keypair.generate().publicKey.toBase58();

const ownerAta = getAssociatedTokenAddressSync(mint, owner);
const strangerAta = getAssociatedTokenAddressSync(mint, stranger);

function tx(...ixs: TransactionInstruction[]): Transaction {
  // Built the way the client builds it: the user as placeholder fee payer.
  return new Transaction({ recentBlockhash: blockhash, feePayer: owner }).add(...ixs);
}

const pay = (amount = 1_000_000n, dest = strangerAta) =>
  createTransferCheckedInstruction(ownerAta, mint, dest, owner, amount, 6);

const check = (t: Transaction) => checkSponsoredTransfer(t, { feePayer, owner, mint });

describe('checkSponsoredTransfer', () => {
  it('accepts a USDC payment plus a fee transfer, the shape off-ramp settlement sends', () => {
    expect(check(tx(pay(), pay(10_000n)))).toMatchObject({ ok: true, rentPaidAccounts: [] });
  });

  it('accepts capped compute budget, an idempotent ATA create paid by the caller, and a memo', () => {
    const memo = new TransactionInstruction({
      programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
      keys: [],
      data: Buffer.from('rent'),
    });
    const t = tx(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }),
      createAssociatedTokenAccountIdempotentInstruction(owner, strangerAta, stranger, mint),
      pay(),
      memo,
    );
    expect(check(t)).toMatchObject({ ok: true, rentPaidAccounts: [] });
  });

  it('refuses a SOL transfer out of the fee payer — the drain', () => {
    const drain = SystemProgram.transfer({ fromPubkey: feePayer, toPubkey: stranger, lamports: 1e9 });
    expect(check(tx(pay(), drain)).ok).toBe(false);
  });

  it('refuses any instruction that names the fee payer, even a harmless-looking one', () => {
    // The fee payer as the WALLET of a token account, not its rent payer.
    const feePayerAta = getAssociatedTokenAddressSync(mint, feePayer);
    const rent = createAssociatedTokenAccountIdempotentInstruction(owner, feePayerAta, feePayer, mint);
    expect(check(tx(rent, pay(1n, feePayerAta)))).toMatchObject({
      ok: false,
      reason: expect.stringContaining('fee payer'),
    });
  });

  it('refuses an excessive priority fee', () => {
    const t = tx(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000_000 }), pay());
    expect(check(t)).toMatchObject({ ok: false, reason: 'priority fee too high' });
  });

  it("refuses moving someone else's USDC", () => {
    const theirs = createTransferCheckedInstruction(strangerAta, mint, ownerAta, stranger, 1n, 6);
    expect(check(tx(theirs)).ok).toBe(false);
  });

  it('refuses another mint', () => {
    const other = Keypair.generate().publicKey;
    const t = tx(
      createTransferCheckedInstruction(
        getAssociatedTokenAddressSync(other, owner), other, strangerAta, owner, 1n, 6,
      ),
    );
    expect(check(t).ok).toBe(false);
  });

  it('refuses unchecked Transfer and every other token instruction', () => {
    expect(check(tx(createTransferInstruction(ownerAta, strangerAta, owner, 1n))).ok).toBe(false);
    expect(check(tx(pay(), createCloseAccountInstruction(ownerAta, owner, owner))).ok).toBe(false);
  });

  it('refuses a program that is not on the list', () => {
    const t = tx(pay(), SystemProgram.transfer({ fromPubkey: owner, toPubkey: stranger, lamports: 1 }));
    expect(check(t).ok).toBe(false);
  });

  it('refuses an extra signer smuggled in through a memo', () => {
    const memo = new TransactionInstruction({
      programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
      keys: [{ pubkey: stranger, isSigner: true, isWritable: false }],
      data: Buffer.from('x'),
    });
    expect(check(tx(pay(), memo))).toMatchObject({ ok: false, reason: 'unexpected signer set' });
  });

  it('refuses a transaction with no transfer in it', () => {
    expect(check(tx(ComputeBudgetProgram.setComputeUnitLimit({ units: 1000 }))).ok).toBe(false);
  });

  it('does not modify the transaction it checks', () => {
    const t = tx(pay());
    check(t);
    expect(t.feePayer?.equals(owner)).toBe(true);
  });
});

describe('fee-payer-funded token accounts', () => {
  const treasury = Keypair.generate().publicKey;
  const treasuryAta = getAssociatedTokenAddressSync(mint, treasury);

  const createBy = (payer: PublicKey, wallet = stranger, ata = strangerAta) =>
    createAssociatedTokenAccountIdempotentInstruction(payer, ata, wallet, mint);

  /** As the route sees it after `sponsorAtaRent`: the fee payer is fee payer and rent payer. */
  function sponsored(...ixs: TransactionInstruction[]): Transaction {
    const t = tx(...ixs);
    sponsorAtaRent(t, owner, feePayer);
    return t;
  }

  it('moves caller-paid CreateIdempotent rent onto the fee payer, and the result passes', () => {
    const t = sponsored(createBy(owner), pay(), createBy(owner, treasury, treasuryAta), pay(10_000n, treasuryAta));
    expect(t.feePayer?.equals(feePayer)).toBe(true);
    expect(t.instructions[0].keys[0].pubkey.equals(feePayer)).toBe(true);
    const r = check(t);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rentPaidAccounts.map((k) => k.toBase58())).toEqual([strangerAta.toBase58(), treasuryAta.toBase58()]);
    expect(r.totalSubunits).toBe(1_010_000n);
  });

  it('leaves a plain Create on the caller — only the idempotent form is sponsored', () => {
    const create = createBy(owner);
    create.data = Buffer.alloc(0);
    const t = sponsored(create, pay());
    expect(t.instructions[0].keys[0].pubkey.equals(owner)).toBe(true);
    expect(check(t)).toMatchObject({ ok: true, rentPaidAccounts: [] });
  });

  it('refuses a plain Create with the fee payer as rent payer', () => {
    const create = createBy(feePayer);
    create.data = Buffer.alloc(0);
    expect(check(tx(create, pay()))).toMatchObject({ ok: false, reason: expect.stringContaining('CreateIdempotent') });
  });

  it('pays for an off-curve (PDA) recipient', () => {
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from('vault')], SystemProgram.programId);
    const pdaAta = usdcAccountFor(pda, mint);
    const t = tx(createBy(feePayer, pda, pdaAta), pay(1_000_000n, pdaAta));
    expect(check(t)).toMatchObject({ ok: true, rentPaidAccounts: [pdaAta] });
  });

  it('refuses rent for an account the transaction pays nothing into', () => {
    expect(check(tx(createBy(feePayer, treasury, treasuryAta), pay()))).toMatchObject({
      ok: false,
      reason: 'sponsored token account receives nothing',
    });
  });

  it('refuses rent for an address that is not the wallet\'s ATA', () => {
    const bogus = Keypair.generate().publicKey;
    expect(check(tx(createBy(feePayer, stranger, bogus), pay(1n, bogus))).ok).toBe(false);
  });

  it("refuses rent for the caller's own account", () => {
    expect(check(tx(createBy(feePayer, owner, ownerAta), pay(1n, ownerAta))).ok).toBe(false);
  });

  it('refuses more than two sponsored accounts in one transaction', () => {
    const wallets = [0, 1, 2].map(() => Keypair.generate().publicKey);
    const ixs = wallets.flatMap((w) => {
      const ata = getAssociatedTokenAddressSync(mint, w);
      return [createBy(feePayer, w, ata), pay(1n, ata)];
    });
    expect(check(tx(...ixs))).toMatchObject({ ok: false });
  });

  it('refuses the same sponsored account twice', () => {
    expect(check(tx(createBy(feePayer), createBy(feePayer), pay())).ok).toBe(false);
  });

  it('refuses a swapped system or token program', () => {
    const ix = createBy(feePayer);
    ix.keys[4] = { ...ix.keys[4], pubkey: Keypair.generate().publicKey };
    expect(check(tx(ix, pay()))).toMatchObject({ ok: false, reason: 'wrong system program' });
  });

  it('refuses a fee payer that is not writable-signer in the payer slot', () => {
    const ix = createBy(feePayer);
    ix.keys[0] = { ...ix.keys[0], isSigner: false };
    expect(check(tx(ix, pay())).ok).toBe(false);
  });

  it('refuses a zero-amount transfer', () => {
    expect(check(tx(pay(0n))).ok).toBe(false);
  });
});

describe('newAccountMinimumMet', () => {
  it('has no minimum when nothing new is opened', () => {
    expect(newAccountMinimumMet(1n, 0)).toBe(true);
  });
  it('requires the minimum when an account is opened', () => {
    expect(newAccountMinimumMet(MIN_SUBUNITS_FOR_NEW_ACCOUNT - 1n, 1)).toBe(false);
    expect(newAccountMinimumMet(MIN_SUBUNITS_FOR_NEW_ACCOUNT, 1)).toBe(true);
  });
});

describe('decodeLegacyTransaction', () => {
  it('round-trips a legacy transaction', () => {
    const b64 = tx(pay()).serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
    expect(decodeLegacyTransaction(b64)?.instructions).toHaveLength(1);
  });

  it('rejects v0 — its lookup tables could hide the fee payer from every check', () => {
    const message = new TransactionMessage({
      payerKey: feePayer,
      recentBlockhash: blockhash,
      instructions: [pay()],
    }).compileToV0Message();
    const b64 = Buffer.from(new VersionedTransaction(message).serialize()).toString('base64');
    expect(decodeLegacyTransaction(b64)).toBeNull();
  });

  it('rejects garbage', () => {
    expect(decodeLegacyTransaction('not a transaction')).toBeNull();
  });
});

describe('checkSponsoredBurn', () => {
  const connection = {
    getLatestBlockhash: async () => ({ blockhash, lastValidBlockHeight: 1 }),
  } as unknown as Connection;

  async function burnTx(burner = owner) {
    const { transaction } = await buildDepositForBurnTx(
      connection,
      burner,
      '5',
      '0x' + '11'.repeat(20),
      0n,
      'base',
    );
    return transaction;
  }

  const checkBurn = (t: Transaction) => checkSponsoredBurn(t, { feePayer, owner, mint });

  it('accepts the deposit_for_burn the client builds', async () => {
    expect(checkBurn(await burnTx())).toEqual({ ok: true });
  });

  it("refuses burning someone else's USDC", async () => {
    expect(checkBurn(await burnTx(stranger)).ok).toBe(false);
  });

  it('refuses a burn that already names the fee payer — the route puts it there, nobody else', async () => {
    const t = await burnTx();
    t.instructions[0].keys[BURN_EVENT_RENT_PAYER_INDEX].pubkey = feePayer;
    expect(checkBurn(t).ok).toBe(false);
  });

  it('refuses anything appended to the burn', async () => {
    const t = await burnTx();
    t.add(SystemProgram.transfer({ fromPubkey: owner, toPubkey: stranger, lamports: 1 }));
    expect(checkBurn(t).ok).toBe(false);
  });

  it('refuses two burns', async () => {
    const t = await burnTx();
    t.add((await burnTx()).instructions[0]);
    expect(checkBurn(t).ok).toBe(false);
  });

  it('refuses another instruction on the CCTP program', async () => {
    const t = await burnTx();
    t.instructions[0].data = Buffer.concat([Buffer.alloc(8), t.instructions[0].data.subarray(8)]);
    expect(checkBurn(t)).toMatchObject({ ok: false, reason: 'only deposit_for_burn is allowed' });
  });

  it('refuses a burn of another mint', async () => {
    const t = await burnTx();
    t.instructions[0].keys[10].pubkey = Keypair.generate().publicKey;
    expect(checkBurn(t).ok).toBe(false);
  });
});

describe('claimRecipientOwner', () => {
  function message(recipient: PublicKey): string {
    const buf = Buffer.alloc(248);
    recipient.toBuffer().copy(buf, 184);
    return buf.toString('hex');
  }

  it("returns the caller's wallet when the message mints to its USDC account", () => {
    expect(claimRecipientOwner(message(ownerAta), [owner.toBase58()], mint)).toBe(owner.toBase58());
  });

  it("returns null when the message mints to somebody else's account", () => {
    expect(claimRecipientOwner(message(strangerAta), [owner.toBase58()], mint)).toBeNull();
  });

  it('returns null for the wallet itself rather than its token account', () => {
    expect(claimRecipientOwner(message(owner), [owner.toBase58()], mint)).toBeNull();
  });

  it('returns null for a malformed message', () => {
    expect(claimRecipientOwner('zz', [owner.toBase58()], mint)).toBeNull();
  });
});
