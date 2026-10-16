import { describe, it, expect } from 'vitest';
import { Keypair, Transaction, SystemProgram } from '@solana/web3.js';
import { classifyAppError } from '@/lib/errors/appErrors';
import {
  classifyClaimFailure,
  errorText,
  isAlreadyClaimed,
  isExpiredAttestation,
  programErrorCode,
} from './claim-errors';
import { privySolanaAddress } from './privy-address';
import { keepLifetime, lifetimeOf } from './confirm';

describe('claim errors', () => {
  it('reads "already in use" — the used_nonce account a previous delivery created — as claimed', () => {
    expect(
      isAlreadyClaimed('Allocate: account Address { address: Abc } already in use'),
    ).toBe(true);
    expect(isAlreadyClaimed('nonce already used')).toBe(true);
    expect(isAlreadyClaimed('insufficient funds')).toBe(false);
  });

  it('finds an expired attestation in the program logs, not just the error', () => {
    const logs = [
      'Program CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC invoke [1]',
      'Program log: AnchorError occurred. Error Code: MessageExpired. Error Number: 6030. Error Message: Message has expired.',
    ];
    const err = Object.assign(new Error('custom program error: 0x178e'), { logs });
    const raw = errorText(err);
    expect(isExpiredAttestation(raw)).toBe(true);
    expect(programErrorCode(raw)).toBe('MessageExpired');
    expect(isExpiredAttestation(err.message)).toBe(false);
  });

  it('turns an expired attestation into a response the client classifies as attestation_expired', () => {
    const failure = classifyClaimFailure('Error Code: MessageExpired');
    expect(failure.kind).toBe('attestation_expired');
    if (failure.kind !== 'attestation_expired') return;
    // What claimOnSolana throws: error and code joined.
    const thrown = new Error(`${failure.error} ${failure.code}`);
    expect(classifyAppError(thrown).category).toBe('attestation_expired');
  });

  it('passes other program errors through by name', () => {
    expect(classifyClaimFailure('Error Code: InvalidAttestation. Error Number: 6001')).toMatchObject({
      kind: 'program_error',
      detail: 'InvalidAttestation',
    });
  });

  it('includes logs passed separately, as getTransaction returns them', () => {
    expect(errorText({ InstructionError: [1, { Custom: 6030 }] }, ['Error Code: MessageExpired'])).toContain(
      'MessageExpired',
    );
  });
});

describe('privySolanaAddress', () => {
  it("returns the embedded Solana wallet's address", () => {
    const user = {
      linkedAccounts: [
        { type: 'email', address: 'a@b.c' },
        { type: 'wallet', walletClientType: 'privy', chainType: 'ethereum', address: '0xabc' },
        { type: 'wallet', walletClientType: 'phantom', chainType: 'solana', address: 'External' },
        { type: 'wallet', walletClientType: 'privy', chainType: 'solana', address: 'Embedded' },
      ],
    };
    expect(privySolanaAddress(user)).toBe('Embedded');
  });

  it('is undefined without one', () => {
    expect(privySolanaAddress(null)).toBeUndefined();
    expect(privySolanaAddress({ linkedAccounts: [] })).toBeUndefined();
  });
});

describe('confirming against the transaction’s own blockhash', () => {
  const payer = Keypair.generate();
  const blockhash = Keypair.generate().publicKey.toBase58();

  it('reads the blockhash the wallet signed, not a fresh one', () => {
    const tx = new Transaction({ blockhash, lastValidBlockHeight: 123, feePayer: payer.publicKey }).add(
      SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: payer.publicKey, lamports: 1 }),
    );
    tx.sign(payer);
    expect(lifetimeOf(tx.serialize(), 123)).toEqual({ blockhash, lastValidBlockHeight: 123 });
  });

  it('carries lastValidBlockHeight across the sponsor round trip, which drops it', () => {
    const built = new Transaction({ blockhash, lastValidBlockHeight: 456, feePayer: payer.publicKey }).add(
      SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: payer.publicKey, lamports: 1 }),
    );
    const roundTripped = Transaction.from(built.serialize({ requireAllSignatures: false }));
    expect(roundTripped.lastValidBlockHeight).toBeUndefined();
    expect(keepLifetime(roundTripped, built).lastValidBlockHeight).toBe(456);
  });
});
