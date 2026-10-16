import { describe, it, expect } from 'vitest';
import { Keypair } from '@solana/web3.js';
import {
  decodeBurnTokenFromMessage,
  decodeDestinationCallerFromMessage,
  decodeMintRecipientFromMessage,
  decodeNonceFromMessage,
  decodeSourceDomainFromMessage,
} from './solana-gateway';

/**
 * Decoding a CCTP V2 message bound for Solana.
 *
 * The offsets are the whole risk: a V2 message read at V1 offsets still yields real-looking
 * bytes, just from the wrong fields, and only fails when receive_message rejects a PDA. So the
 * message is built here field by field from Circle's V2 layout (see the map in solana-gateway),
 * every field filled with something distinct, and each decoder must pick out its own.
 */

/** A 32-byte buffer filled with one byte value — distinct per field, so overlaps show. */
const fill = (b: number) => Buffer.alloc(32, b);
const u32 = (n: number) => {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(n);
  return buf;
};

function v2Message(f: {
  sourceDomain: number;
  nonce: Buffer;
  destinationCaller: Buffer;
  burnToken: Buffer;
  mintRecipient: Buffer;
}): Buffer {
  const header = Buffer.concat([
    u32(1), //            version             0..4
    u32(f.sourceDomain), // sourceDomain     4..8
    u32(5), //            destinationDomain   8..12 (Solana)
    f.nonce, //           nonce              12..44
    fill(0xa1), //        sender             44..76
    fill(0xa2), //        recipient          76..108
    f.destinationCaller, // destinationCaller 108..140
    u32(1000), //         minFinalityThreshold
    u32(2000), //         finalityThresholdExecuted
  ]);
  const body = Buffer.concat([
    u32(1), //            body version       148..152
    f.burnToken, //       burnToken          152..184
    f.mintRecipient, //   mintRecipient      184..216
    fill(0xb1), //        amount
    fill(0xb2), //        messageSender
    fill(0xb3), //        maxFee
    fill(0xb4), //        feeExecuted
    fill(0xb5), //        expirationBlock
  ]);
  expect(header.length).toBe(148);
  expect(body.length).toBe(228);
  return Buffer.concat([header, body]);
}

const recipient = Keypair.generate().publicKey;
const caller = Keypair.generate().publicKey;
const nonce = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1));
const burnToken = Buffer.concat([Buffer.alloc(12), Buffer.from('833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'hex')]);

const message = v2Message({
  sourceDomain: 6, // Base
  nonce,
  destinationCaller: caller.toBuffer(),
  burnToken,
  mintRecipient: recipient.toBuffer(),
});

describe('CCTP V2 message decoders', () => {
  it('reads the source domain', () => {
    expect(decodeSourceDomainFromMessage(message)).toBe(6);
  });

  it('reads the full 32-byte nonce, not a V1 u64', () => {
    expect(decodeNonceFromMessage(message).equals(nonce)).toBe(true);
  });

  it('reads the burn token from the body', () => {
    expect(decodeBurnTokenFromMessage(message).equals(burnToken)).toBe(true);
  });

  it('reads the mint recipient token account', () => {
    expect(decodeMintRecipientFromMessage(message).equals(recipient)).toBe(true);
  });

  it('reads a set destination caller', () => {
    expect(decodeDestinationCallerFromMessage(message)?.equals(caller)).toBe(true);
  });

  it('reads a zeroed destination caller as unrestricted', () => {
    const open = v2Message({
      sourceDomain: 0,
      nonce,
      destinationCaller: Buffer.alloc(32),
      burnToken,
      mintRecipient: recipient.toBuffer(),
    });
    expect(decodeDestinationCallerFromMessage(open)).toBeNull();
    expect(decodeSourceDomainFromMessage(open)).toBe(0);
  });

  it('accepts the hex string Iris returns, with or without 0x', () => {
    const hex = message.toString('hex');
    expect(decodeSourceDomainFromMessage(`0x${hex}`)).toBe(6);
    expect(decodeMintRecipientFromMessage(hex).equals(recipient)).toBe(true);
    expect(decodeNonceFromMessage(`0x${hex}`).equals(nonce)).toBe(true);
  });

  it('returns a copy of the nonce, not a view into the message', () => {
    const buf = Buffer.from(message);
    const n = decodeNonceFromMessage(buf);
    buf.fill(0);
    expect(n.equals(nonce)).toBe(true);
  });
});
