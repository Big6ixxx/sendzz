import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { checkSponsoredTransfer, sponsorAtaRent } from './sponsor-policy';
import { buildSolanaUsdcTransferTx, clampMemo, MAX_MEMO_BYTES, usdcToSubunits } from './usdc-transfer';

const blockhash = Keypair.generate().publicKey.toBase58();
const connection = { getLatestBlockhash: async () => ({ blockhash, lastValidBlockHeight: 100 }) };
const sender = Keypair.generate().publicKey;
const recipient = Keypair.generate().publicKey;
const treasury = Keypair.generate().publicKey;
const feePayer = Keypair.generate().publicKey;

describe('usdcToSubunits', () => {
  it('converts without floating point', () => {
    expect(usdcToSubunits('0.29')).toBe(290_000n);
    expect(usdcToSubunits('1')).toBe(1_000_000n);
    expect(usdcToSubunits('12.3456789')).toBe(12_345_678n);
    expect(usdcToSubunits('.5')).toBe(500_000n);
  });
  it('refuses junk', () => {
    expect(() => usdcToSubunits('1e3')).toThrow();
    expect(() => usdcToSubunits('-1')).toThrow();
    expect(() => usdcToSubunits('')).toThrow();
  });
});

describe('clampMemo', () => {
  it('keeps short memos and cuts long ones on a character boundary', () => {
    expect(clampMemo(' rent ')).toBe('rent');
    const long = 'é'.repeat(200);
    expect(Buffer.byteLength(clampMemo(long), 'utf8')).toBeLessThanOrEqual(MAX_MEMO_BYTES);
  });
});

describe('buildSolanaUsdcTransferTx', () => {
  it('builds exactly what the sponsor accepts, before and after it takes the rent', async () => {
    const tx = await buildSolanaUsdcTransferTx({
      connection,
      senderAddress: sender.toBase58(),
      recipientAddress: recipient.toBase58(),
      amount: '5',
      platformFee: { usdc: '0.05', treasury: treasury.toBase58() },
      memo: 'lunch',
    });
    expect(tx.instructions).toHaveLength(5);
    expect(checkSponsoredTransfer(tx, { feePayer, owner: sender })).toMatchObject({ ok: true, rentPaidAccounts: [] });

    sponsorAtaRent(tx, sender, feePayer);
    const r = checkSponsoredTransfer(tx, { feePayer, owner: sender });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rentPaidAccounts).toHaveLength(2);
      expect(r.totalSubunits).toBe(5_050_000n);
    }
  });

  it('pays an off-curve recipient', async () => {
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from('x')], SystemProgram.programId);
    const tx = await buildSolanaUsdcTransferTx({
      connection,
      senderAddress: sender.toBase58(),
      recipientAddress: pda.toBase58(),
      amount: '2',
    });
    sponsorAtaRent(tx, sender, feePayer);
    expect(checkSponsoredTransfer(tx, { feePayer, owner: sender }).ok).toBe(true);
  });

  it('skips a zero fee and an empty memo', async () => {
    const tx = await buildSolanaUsdcTransferTx({
      connection,
      senderAddress: sender.toBase58(),
      recipientAddress: recipient.toBase58(),
      amount: '1',
      platformFee: { usdc: '0', treasury: treasury.toBase58() },
      memo: '   ',
    });
    expect(tx.instructions).toHaveLength(2);
  });
});
