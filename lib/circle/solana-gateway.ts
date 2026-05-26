/**
 * Solana CCTP V2 Gateway
 *
 * Handles building depositForBurn transactions, balance checks, and attestation
 * polling for Circle CCTP V2 on Solana (domain 5 → Base domain 6).
 *
 * Program addresses (mainnet):
 *   TokenMessengerMinterV2 : CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe
 *   MessageTransmitterV2   : CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC
 *   USDC mint              : EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import crypto from 'crypto';
import { type AttestationResponse } from './gateway';

// ── Constants ────────────────────────────────────────────────────────────────

export const SOLANA_CCTP_DOMAIN = 5;
export const BASE_CCTP_DOMAIN = 6;

export const TOKEN_MESSENGER_MINTER_V2 = new PublicKey(
  'CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe',
);
export const MESSAGE_TRANSMITTER_V2 = new PublicKey(
  'CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC',
);
export const SOLANA_USDC_MINT = new PublicKey(
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
);

const IRIS_API_BASE = 'https://iris-api.circle.com/v2';

// Anchor discriminator = sha256("global:<instruction_name>")[0..8]
const DEPOSIT_FOR_BURN_DISCRIMINATOR = crypto
  .createHash('sha256')
  .update('global:deposit_for_burn')
  .digest()
  .subarray(0, 8);

// ── PDA derivation ────────────────────────────────────────────────────────────

function findPda(seeds: Buffer[], programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(seeds, programId);
  return pda;
}

function getMessageTransmitterConfig(): PublicKey {
  return findPda([Buffer.from('message_transmitter')], MESSAGE_TRANSMITTER_V2);
}

function getTokenMessengerPda(): PublicKey {
  return findPda([Buffer.from('token_messenger')], TOKEN_MESSENGER_MINTER_V2);
}

function getRemoteTokenMessengerPda(destinationDomain: number): PublicKey {
  const domainBuf = Buffer.alloc(4);
  domainBuf.writeUInt32LE(destinationDomain);
  return findPda(
    [Buffer.from('remote_token_messenger'), domainBuf],
    TOKEN_MESSENGER_MINTER_V2,
  );
}

function getTokenMinterPda(): PublicKey {
  return findPda([Buffer.from('token_minter')], TOKEN_MESSENGER_MINTER_V2);
}

function getLocalTokenPda(mintPubkey: PublicKey): PublicKey {
  return findPda(
    [Buffer.from('local_token'), mintPubkey.toBuffer()],
    TOKEN_MESSENGER_MINTER_V2,
  );
}

function getSenderAuthorityPda(): PublicKey {
  return findPda([Buffer.from('sender_authority')], TOKEN_MESSENGER_MINTER_V2);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Encode a Base/EVM address as a 32-byte mint_recipient for CCTP.
 * EVM addresses are 20 bytes; CCTP uses 32-byte fields (left-padded with zeros).
 */
export function evmAddressToBytes32(evmAddress: string): Buffer {
  const buf = Buffer.alloc(32, 0);
  const addrHex = evmAddress.replace(/^0x/i, '');
  Buffer.from(addrHex.padStart(40, '0'), 'hex').copy(buf, 12);
  return buf;
}

/**
 * Build the Anchor instruction data for depositForBurn (CCTP V2).
 *
 * Layout (96 bytes total):
 *   [0..8]   discriminator  (sha256("global:deposit_for_burn")[0..8])
 *   [8..16]  amount         (u64 LE)
 *   [16..20] destinationDomain (u32 LE)
 *   [20..52] mintRecipient  ([u8; 32])
 *   [52..84] destinationCaller ([u8; 32]) – zeros = no restriction
 *   [84..92] maxFee         (u64 LE)
 *   [92..96] minFinalityThreshold (u32 LE) – 1000 = fast transfer
 */
function buildInstructionData(params: {
  amountSubunits: bigint;
  destinationDomain: number;
  mintRecipientBytes: Buffer;
  maxFeeSubunits: bigint;
  minFinalityThreshold: number;
}): Buffer {
  const buf = Buffer.alloc(96);
  DEPOSIT_FOR_BURN_DISCRIMINATOR.copy(buf, 0);

  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(params.amountSubunits);
  amountBuf.copy(buf, 8);

  buf.writeUInt32LE(params.destinationDomain, 16);
  params.mintRecipientBytes.copy(buf, 20);
  // destinationCaller = zero bytes (no restriction on who can call the mint)
  buf.fill(0, 52, 84);

  const maxFeeBuf = Buffer.alloc(8);
  maxFeeBuf.writeBigUInt64LE(params.maxFeeSubunits);
  maxFeeBuf.copy(buf, 84);

  buf.writeUInt32LE(params.minFinalityThreshold, 92);
  return buf;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface DepositForBurnResult {
  transaction: Transaction;
  /** Must be included as a signer alongside the user's wallet */
  messageSentEventData: Keypair;
}

/**
 * Build an unsigned Solana CCTP V2 depositForBurn transaction.
 *
 * @param connection       Solana RPC connection
 * @param walletPublicKey  The sender's Solana wallet public key
 * @param amountUsdc       Human-readable USDC amount (e.g. "10.5")
 * @param evmRecipient     The Base smart account address (0x…)
 * @param maxFeeSubunits   Pre-calculated maxFee in 6-decimal subunits
 */
export async function buildDepositForBurnTx(
  connection: Connection,
  walletPublicKey: PublicKey,
  amountUsdc: string,
  evmRecipient: string,
  maxFeeSubunits: bigint,
): Promise<DepositForBurnResult> {
  // Convert to 6-decimal subunits
  const [whole, frac = ''] = amountUsdc.split('.');
  const frac6 = (frac + '000000').slice(0, 6);
  const amountSubunits = BigInt(whole + frac6);

  // The event account is freshly generated per transaction
  const messageSentEventData = Keypair.generate();

  // Mint recipient = user's Base EVM address encoded as 32 bytes
  const mintRecipientBytes = evmAddressToBytes32(evmRecipient);

  // Derive PDAs
  const senderAuthorityPda = getSenderAuthorityPda();
  const messageTransmitterConfig = getMessageTransmitterConfig();
  const tokenMessengerPda = getTokenMessengerPda();
  const remoteTokenMessengerPda = getRemoteTokenMessengerPda(BASE_CCTP_DOMAIN);
  const tokenMinterPda = getTokenMinterPda();
  const localTokenPda = getLocalTokenPda(SOLANA_USDC_MINT);

  // User's USDC associated token account (must exist and have sufficient balance)
  const burnTokenAccount = getAssociatedTokenAddressSync(
    SOLANA_USDC_MINT,
    walletPublicKey,
  );

  const instructionData = buildInstructionData({
    amountSubunits,
    destinationDomain: BASE_CCTP_DOMAIN,
    mintRecipientBytes,
    maxFeeSubunits,
    minFinalityThreshold: 1000, // Fast Transfer
  });

  const keys = [
    { pubkey: walletPublicKey, isSigner: true, isWritable: true },
    { pubkey: walletPublicKey, isSigner: true, isWritable: true }, // eventRentPayer = owner
    { pubkey: senderAuthorityPda, isSigner: false, isWritable: false },
    { pubkey: burnTokenAccount, isSigner: false, isWritable: true },
    { pubkey: messageTransmitterConfig, isSigner: false, isWritable: true },
    { pubkey: tokenMessengerPda, isSigner: false, isWritable: false },
    { pubkey: remoteTokenMessengerPda, isSigner: false, isWritable: false },
    { pubkey: tokenMinterPda, isSigner: false, isWritable: false },
    { pubkey: localTokenPda, isSigner: false, isWritable: true },
    { pubkey: SOLANA_USDC_MINT, isSigner: false, isWritable: true },
    { pubkey: messageSentEventData.publicKey, isSigner: true, isWritable: true },
    { pubkey: MESSAGE_TRANSMITTER_V2, isSigner: false, isWritable: false },
    { pubkey: TOKEN_MESSENGER_MINTER_V2, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const instruction = new TransactionInstruction({
    programId: TOKEN_MESSENGER_MINTER_V2,
    keys,
    data: instructionData,
  });

  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const transaction = new Transaction({
    recentBlockhash: blockhash,
    feePayer: walletPublicKey,
  }).add(instruction);

  // Pre-sign with the event data keypair (program also requires it as a signer)
  transaction.partialSign(messageSentEventData);

  return { transaction, messageSentEventData };
}

/**
 * Get the USDC balance (in full USDC) of a Solana wallet.
 * Returns 0 if no token account exists.
 */
export async function getSolanaUsdcBalance(
  connection: Connection,
  walletPublicKey: PublicKey,
): Promise<number> {
  try {
    const ata = getAssociatedTokenAddressSync(SOLANA_USDC_MINT, walletPublicKey);
    const info = await connection.getTokenAccountBalance(ata);
    return Number(info.value.uiAmount ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Fetch CCTP attestation status for a Solana burn transaction.
 * Uses the Circle Iris API /v2/messages endpoint with domain 5.
 */
export async function fetchSolanaAttestation(
  txSignature: string,
): Promise<AttestationResponse> {
  try {
    const res = await fetch(
      `${IRIS_API_BASE}/messages/${SOLANA_CCTP_DOMAIN}?transactionHash=${txSignature}`,
    );
    if (res.status === 404) return { status: 'pending' };
    if (!res.ok) throw new Error(`Iris API error: ${res.statusText}`);

    const data = (await res.json()) as {
      messages?: { status: string; attestation?: string; forwardTxHash?: string }[];
    };
    const message = data.messages?.[0];
    if (!message) return { status: 'pending' };

    return {
      status: message.status === 'complete' ? 'complete' : 'pending',
      attestation: message.attestation,
      mintTxHash: message.forwardTxHash,
    };
  } catch (err) {
    console.error('[SolanaGateway] fetchAttestation error:', err);
    return { status: 'pending' };
  }
}
