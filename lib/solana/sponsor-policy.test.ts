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
  checkSponsoredBurn,
  checkSponsoredTransfer,
  claimRecipientOwner,
  decodeLegacyTransaction,
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
    expect(check(tx(pay(), pay(10_000n)))).toEqual({ ok: true });
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
    expect(check(t)).toEqual({ ok: true });
  });

  it('refuses a SOL transfer out of the fee payer — the drain', () => {
    const drain = SystemProgram.transfer({ fromPubkey: feePayer, toPubkey: stranger, lamports: 1e9 });
    expect(check(tx(pay(), drain)).ok).toBe(false);
  });

  it('refuses any instruction that names the fee payer, even a harmless-looking one', () => {
    const rent = createAssociatedTokenAccountIdempotentInstruction(feePayer, strangerAta, stranger, mint);
    expect(check(tx(rent, pay()))).toMatchObject({ ok: false, reason: expect.stringContaining('fee payer') });
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

  describe('with a platform fee', () => {
    const treasury = Keypair.generate().publicKey;
    const treasuryAta = getAssociatedTokenAddressSync(mint, treasury, true);
    const fee = (dest = treasuryAta, from = ownerAta, authority = owner) =>
      createTransferCheckedInstruction(from, mint, dest, authority, 25_000n, 6);
    const checkFeeBurn = (t: Transaction, feeTreasury: PublicKey | null = treasury) =>
      checkSponsoredBurn(t, { feePayer, owner, mint, feeTreasury });

    async function feeBurn(feeIx = fee()) {
      const t = await burnTx();
      t.instructions.unshift(feeIx);
      return t;
    }

    it('accepts the burn with a fee to the treasury, as the bridge screen builds it', async () => {
      expect(checkFeeBurn(await feeBurn())).toEqual({ ok: true });
    });

    it('accepts the fee after the burn too', async () => {
      const t = await burnTx();
      t.add(fee());
      expect(checkFeeBurn(t)).toEqual({ ok: true });
    });

    it('refuses a fee transfer when no treasury is configured', async () => {
      expect(checkFeeBurn(await feeBurn(), null).ok).toBe(false);
    });

    it('refuses sending the "fee" anywhere but the treasury', async () => {
      expect(checkFeeBurn(await feeBurn(fee(strangerAta)))).toMatchObject({
        ok: false,
        reason: 'fee must go to the fee treasury',
      });
    });

    it('refuses the treasury wallet itself rather than its token account', async () => {
      expect(checkFeeBurn(await feeBurn(fee(treasury))).ok).toBe(false);
    });

    it("refuses a fee paid from someone else's USDC", async () => {
      expect(checkFeeBurn(await feeBurn(fee(treasuryAta, strangerAta, stranger))).ok).toBe(false);
    });

    it('refuses two fee transfers', async () => {
      const t = await feeBurn();
      t.add(fee());
      expect(checkFeeBurn(t)).toMatchObject({ ok: false, reason: 'more than one fee transfer' });
    });

    it('refuses an unchecked Transfer to the treasury', async () => {
      const t = await feeBurn(createTransferInstruction(ownerAta, treasuryAta, owner, 25_000n));
      expect(checkFeeBurn(t).ok).toBe(false);
    });

    it('refuses a fee transfer with no burn', () => {
      expect(checkFeeBurn(tx(fee())).ok).toBe(false);
    });

    it('refuses a fee transfer that names the fee payer', async () => {
      expect(checkFeeBurn(await feeBurn(fee(treasuryAta, ownerAta, feePayer))).ok).toBe(false);
    });
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
