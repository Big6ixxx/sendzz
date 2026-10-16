import { describe, it, expect, vi } from 'vitest';
import { Keypair, SystemProgram, Transaction, type Connection } from '@solana/web3.js';
import { sendAndConfirmSigned } from './confirm';

function signedBytes(): Uint8Array {
  const payer = Keypair.generate();
  const tx = new Transaction({
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    feePayer: payer.publicKey,
  }).add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: payer.publicKey, lamports: 1 }));
  tx.sign(payer);
  return tx.serialize();
}

function connection(overrides: Partial<Record<'sendRawTransaction' | 'confirmTransaction', unknown>>) {
  return {
    sendRawTransaction: vi.fn().mockResolvedValue('SIG'),
    confirmTransaction: vi.fn().mockResolvedValue({ value: { err: null } }),
    getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: 'x', lastValidBlockHeight: 1 }),
    ...overrides,
  } as unknown as Connection;
}

describe('sendAndConfirmSigned', () => {
  it('reports the broadcast before confirmation, so a landed burn is recorded even if confirming throws', async () => {
    const order: string[] = [];
    const conn = connection({
      confirmTransaction: vi.fn().mockImplementation(async () => {
        order.push('confirm');
        throw new Error('socket closed');
      }),
    });
    const onBroadcast = vi.fn(async (sig: string) => {
      order.push(`broadcast:${sig}`);
    });

    await expect(sendAndConfirmSigned(conn, signedBytes(), 100, onBroadcast)).rejects.toThrow('socket closed');
    expect(order).toEqual(['broadcast:SIG', 'confirm']);
  });

  it('reports nothing when the RPC refuses the broadcast — nothing was sent', async () => {
    const conn = connection({ sendRawTransaction: vi.fn().mockRejectedValue(new Error('preflight failed')) });
    const onBroadcast = vi.fn(async () => {});
    await expect(sendAndConfirmSigned(conn, signedBytes(), 100, onBroadcast)).rejects.toThrow('preflight');
    expect(onBroadcast).not.toHaveBeenCalled();
  });
});
