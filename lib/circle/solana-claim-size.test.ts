import { describe, it, expect, vi } from 'vitest';
import { Buffer } from 'buffer';
import {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  type Connection,
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  SOLANA_USDC_MINT,
  TOKEN_MESSENGER_MINTER_V2,
  buildReceiveMessageOnSolanaTx,
  solanaClaimLookupAddresses,
} from './solana-gateway';
import { MAX_TRANSACTION_BYTES } from '@/lib/solana/lookup-table';

vi.mock('server-only', () => ({}));

/**
 * A Solana claim has to fit in a transaction, and for a while it did not.
 *
 * Circle signs a mainnet attestation with two attesters and a devnet one with a single attester,
 * so the same claim carries 130 bytes of signatures on mainnet against 65 on devnet. That is the
 * difference between 1264 bytes and 1199 — one side of Solana's 1232-byte limit and the other.
 * Every devnet test passed and every mainnet claim was refused with "Transaction too large",
 * after the USDC had already been burned on the source chain.
 *
 * So the sizes are asserted here, at the size that matters, for both shapes of claim: the plain
 * one, and the one that also opens the recipient's token account.
 */

/** Mainnet signs with two attesters, devnet with one. 65 bytes each. */
const MAINNET_ATTESTATION_BYTES = 130;
const DEVNET_ATTESTATION_BYTES = 65;

const owner = Keypair.generate().publicKey;
const recipientAta = getAssociatedTokenAddressSync(SOLANA_USDC_MINT, owner);
const payer = Keypair.generate().publicKey;
const tokenMessengerPda = PublicKey.findProgramAddressSync(
  [Buffer.from('token_messenger')],
  TOKEN_MESSENGER_MINTER_V2,
)[0];

/** A CCTP V2 burn message: a 148-byte header followed by a 228-byte body. */
function burnMessage(mintRecipient: PublicKey, sourceDomain = 3): string {
  const buf = Buffer.alloc(376);
  buf.writeUInt32BE(sourceDomain, 4);
  Buffer.alloc(32, 7).copy(buf, 12); // nonce
  Buffer.alloc(32, 9).copy(buf, 152); // burnToken
  mintRecipient.toBuffer().copy(buf, 184);
  return buf.toString('hex');
}

const attestation = (bytes: number) => Buffer.alloc(bytes, 1).toString('hex');

/** Enough of an RPC to build a claim: a readable token messenger, and a recipient account or not. */
function rpc(recipientAtaExists: boolean): Connection {
  return {
    getLatestBlockhash: async () => ({
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 1,
    }),
    getAccountInfo: async (key: PublicKey) => {
      if (key.equals(tokenMessengerPda)) {
        return { owner: TOKEN_MESSENGER_MINTER_V2, data: Buffer.alloc(200, 3) };
      }
      if (key.equals(recipientAta)) {
        return recipientAtaExists ? { owner: TOKEN_PROGRAM_ID, data: Buffer.alloc(165) } : null;
      }
      return null; // used_nonce: not delivered yet
    },
  } as unknown as Connection;
}

/** The table the deployed app reads, built from the addresses the setup script would add. */
async function lookupTable(connection: Connection): Promise<AddressLookupTableAccount> {
  return new AddressLookupTableAccount({
    key: Keypair.generate().publicKey,
    state: {
      deactivationSlot: BigInt('0xffffffffffffffff'),
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      authority: payer,
      addresses: await solanaClaimLookupAddresses(connection),
    },
  });
}

async function claimSize(params: {
  attestationBytes: number;
  recipientAtaExists: boolean;
  withTable: boolean;
}): Promise<number> {
  const connection = rpc(params.recipientAtaExists);
  const built = await buildReceiveMessageOnSolanaTx(
    connection,
    payer,
    burnMessage(recipientAta),
    attestation(params.attestationBytes),
    owner,
    params.withTable ? [await lookupTable(connection)] : [],
  );
  if (built.alreadyClaimed) throw new Error('fixture should not be already claimed');
  expect(built.createsMintRecipient).toBe(!params.recipientAtaExists);
  return built.transaction.serialize().length;
}

describe('a Solana claim fits in a transaction', () => {
  for (const recipientAtaExists of [true, false]) {
    const shape = recipientAtaExists ? 'plain' : 'also opening the token account';

    it(`on mainnet, ${shape}`, async () => {
      const size = await claimSize({
        attestationBytes: MAINNET_ATTESTATION_BYTES,
        recipientAtaExists,
        withTable: true,
      });
      expect(size).toBeLessThanOrEqual(MAX_TRANSACTION_BYTES);
    });

    it(`on devnet, ${shape}`, async () => {
      const size = await claimSize({
        attestationBytes: DEVNET_ATTESTATION_BYTES,
        recipientAtaExists,
        withTable: true,
      });
      expect(size).toBeLessThanOrEqual(MAX_TRANSACTION_BYTES);
    });
  }

  it('is what the lookup table buys: without one, a mainnet claim does not fit', async () => {
    // The bug, kept as a test. If this ever passes, the table has stopped being load-bearing and
    // the comments that call it required are wrong.
    const withoutTable = await claimSize({
      attestationBytes: MAINNET_ATTESTATION_BYTES,
      recipientAtaExists: true,
      withTable: false,
    });
    expect(withoutTable).toBeGreaterThan(MAX_TRANSACTION_BYTES);

    const withTable = await claimSize({
      attestationBytes: MAINNET_ATTESTATION_BYTES,
      recipientAtaExists: true,
      withTable: true,
    });
    // Worth at least a few hundred bytes, not a handful — otherwise the table is missing most of
    // the accounts it should hold.
    expect(withoutTable - withTable).toBeGreaterThan(250);
  });
});

describe('solanaClaimLookupAddresses', () => {
  it('holds no executable program, which could not be indexed through a table', async () => {
    const programs = [
      TOKEN_MESSENGER_MINTER_V2.toBase58(),
      'CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC', // MessageTransmitterV2
      TOKEN_PROGRAM_ID.toBase58(),
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // associated token program
      '11111111111111111111111111111111', // system program
      'ComputeBudget111111111111111111111111111111',
    ];
    const addresses = (await solanaClaimLookupAddresses(rpc(true))).map((a) => a.toBase58());
    for (const program of programs) expect(addresses).not.toContain(program);
  });

  it('covers every source chain, and lists nothing twice', async () => {
    const addresses = await solanaClaimLookupAddresses(rpc(true));
    const unique = new Set(addresses.map((a) => a.toBase58()));
    expect(unique.size).toBe(addresses.length);
    // Ten shared accounts, plus a remote messenger and a token pair per EVM source chain.
    expect(addresses.length).toBeGreaterThanOrEqual(10 + 2 * 6);
  });
});
