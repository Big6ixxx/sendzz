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
import { Buffer } from 'buffer';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  AccountMeta,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import crypto from 'crypto';
import bs58 from 'bs58';
import { type AttestationResponse, CCTP_DOMAINS, type SupportedChain } from './gateway';


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

const RECEIVE_MESSAGE_DISCRIMINATOR = crypto
  .createHash('sha256')
  .update('global:receive_message')
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
  return findPda(
    [Buffer.from('remote_token_messenger'), Buffer.from(destinationDomain.toString())],
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

function getMessageTransmitterAuthorityPda(receiverProgram: PublicKey): PublicKey {
  return findPda(
    [Buffer.from('message_transmitter_authority'), receiverProgram.toBuffer()],
    MESSAGE_TRANSMITTER_V2,
  );
}

function getUsedNoncePda(nonceBytes: Buffer): PublicKey {
  return findPda(
    [
      Buffer.from('used_nonce'),
      nonceBytes,
    ],
    MESSAGE_TRANSMITTER_V2,
  );
}

function getTokenPairPda(remoteDomain: number, remoteToken: Buffer): PublicKey {
  return findPda(
    [
      Buffer.from('token_pair'),
      Buffer.from(remoteDomain.toString()),
      remoteToken,
    ],
    TOKEN_MESSENGER_MINTER_V2,
  );
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
  destChain: SupportedChain = 'base',
  feePayerPublicKey?: PublicKey,
): Promise<DepositForBurnResult> {
  // Convert to 6-decimal subunits
  const [whole, frac = ''] = amountUsdc.split('.');
  const frac6 = (frac + '000000').slice(0, 6);
  const amountSubunits = BigInt(whole + frac6);

  const destinationDomain = CCTP_DOMAINS[destChain];

  // The event account is freshly generated per transaction
  const messageSentEventData = Keypair.generate();

  // Mint recipient = user's EVM address encoded as 32 bytes
  const mintRecipientBytes = evmAddressToBytes32(evmRecipient);

  const senderAuthorityPda = getSenderAuthorityPda();
  const messageTransmitterConfig = getMessageTransmitterConfig();
  const tokenMessengerPda = getTokenMessengerPda();
  const remoteTokenMessengerPda = getRemoteTokenMessengerPda(destinationDomain);
  const tokenMinterPda = getTokenMinterPda();
  const localTokenPda = getLocalTokenPda(SOLANA_USDC_MINT);
  
  // V2 denylist account
  const denylistPda = findPda(
    [Buffer.from('denylist_account'), walletPublicKey.toBuffer()],
    TOKEN_MESSENGER_MINTER_V2,
  );

  // User's USDC associated token account (must exist and have sufficient balance)
  const burnTokenAccount = getAssociatedTokenAddressSync(
    SOLANA_USDC_MINT,
    walletPublicKey,
  );

  const instructionData = buildInstructionData({
    amountSubunits,
    destinationDomain,
    mintRecipientBytes,
    maxFeeSubunits,
    minFinalityThreshold: 1000, // Fast Transfer
  });

  const eventRentPayer = feePayerPublicKey ?? walletPublicKey;

  const keys = [
    { pubkey: walletPublicKey, isSigner: true, isWritable: true },
    { pubkey: eventRentPayer, isSigner: true, isWritable: true }, // eventRentPayer
    { pubkey: senderAuthorityPda, isSigner: false, isWritable: false },
    { pubkey: burnTokenAccount, isSigner: false, isWritable: true },
    { pubkey: denylistPda, isSigner: false, isWritable: false }, // <--- V2 addition
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
    // Anchor #[event_cpi] automatically injects these two accounts at the end
    {
      pubkey: findPda([Buffer.from('__event_authority')], TOKEN_MESSENGER_MINTER_V2),
      isSigner: false,
      isWritable: false,
    },
    { pubkey: TOKEN_MESSENGER_MINTER_V2, isSigner: false, isWritable: false },
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
      messages?: { status: string; attestation?: string; message?: string; forwardTxHash?: string }[];
    };
    const message = data.messages?.[0];
    if (!message) return { status: 'pending' };

    return {
      status: message.status === 'complete' ? 'complete' : 'pending',
      attestation: message.attestation,
      messageBytes: message.message,
      mintTxHash: message.forwardTxHash,
    };
  } catch (err) {
    console.error('[SolanaGateway] fetchAttestation error:', err);
    return { status: 'pending' };
  }
}

// ── EVM → Solana helpers ──────────────────────────────────────────────────────

/**
 * Encode a Solana wallet public key as a 32-byte hex string (bytes32) for use
 * as the `mintRecipient` in an EVM CCTP depositForBurn call targeting Solana.
 * Solana public keys are already 32 bytes (base58 decoded), no padding needed.
 */
export function solanaAddressToBytes32(solanaAddress: string): `0x${string}` {
  const decoded = new PublicKey(solanaAddress).toBytes();
  return `0x${Buffer.from(decoded).toString('hex')}` as `0x${string}`;
}

/**
 * Decode the nonce from a raw CCTP V2 message (bytes 12–19, big-endian uint64).
 * Message layout: version(4) | sourceDomain(4) | destinationDomain(4) | nonce(8) | ...
 */
export function decodeNonceFromMessage(messageHex: string): bigint {
  const data = Buffer.from(messageHex.replace(/^0x/, ''), 'hex');
  return data.readBigUInt64BE(12);
}

/**
 * Decode the source domain from a CCTP message (bytes 4–7, big-endian uint32).
 */
export function decodeSourceDomainFromMessage(messageHex: string): number {
  const data = Buffer.from(messageHex.replace(/^0x/, ''), 'hex');
  return data.readUInt32BE(4);
}

export interface ReceiveMessageResult {
  transaction: Transaction;
}

/**
 * Build an unsigned Solana receiveMessage transaction for the CCTP V2 MessageTransmitterV2.
 *
 * This is the "mint" side of an EVM → Solana CCTP transfer. After an EVM chain burns
 * USDC and Circle produces an attestation, this instruction delivers the USDC to the
 * `walletPublicKey`'s Solana USDC ATA.
 *
 * @param connection      Solana RPC connection
 * @param walletPublicKey The payer/caller — the user's Solana wallet
 * @param messageBytes    Hex string of the CCTP message (from Circle Iris API)
 * @param attestation     Hex string of the Circle attestation
 */
export async function buildReceiveMessageOnSolanaTx(
  connection: Connection,
  walletPublicKey: PublicKey,
  messageBytes: string,
  attestation: string,
): Promise<ReceiveMessageResult> {
  const msgBuf = Buffer.from(messageBytes.replace(/^0x/, ''), 'hex');
  const attBuf = Buffer.from(attestation.replace(/^0x/, ''), 'hex');

  const sourceDomain = decodeSourceDomainFromMessage(messageBytes);
  const nonce = decodeNonceFromMessage(messageBytes);

  // Core MessageTransmitterV2 PDAs
  const messageTransmitterConfig = getMessageTransmitterConfig();
  const authorityPda = getMessageTransmitterAuthorityPda(TOKEN_MESSENGER_MINTER_V2);
  const nonceBytes = msgBuf.subarray(12, 20);
  const usedNoncePda = getUsedNoncePda(nonceBytes);

  // TokenMessengerMinterV2 PDAs (remaining accounts for the CPI)
  const tokenMessengerPda = getTokenMessengerPda();
  const remoteTokenMessengerPda = getRemoteTokenMessengerPda(sourceDomain);
  const tokenMinterPda = getTokenMinterPda();
  const localTokenPda = getLocalTokenPda(SOLANA_USDC_MINT);

  // remoteToken bytes32 is embedded in the CCTP burn message body (bytes 120–152)
  const remoteTokenBytes32 = msgBuf.subarray(120, 152);
  const tokenPairPda = getTokenPairPda(sourceDomain, remoteTokenBytes32);

  // User's USDC ATA — where minted USDC lands
  const recipientAta = getAssociatedTokenAddressSync(SOLANA_USDC_MINT, walletPublicKey);

  // Check if the ATA exists
  let recipientAtaExists = false;
  try {
    const info = await connection.getAccountInfo(recipientAta);
    if (info) recipientAtaExists = true;
  } catch (err) {
    console.warn('[SolanaGateway] Failed to check ATA existence:', err);
  }

  // Anchor event_cpi PDAs
  const eventAuthorityMt = findPda([Buffer.from('__event_authority')], MESSAGE_TRANSMITTER_V2);
  const eventAuthorityTmm = findPda([Buffer.from('__event_authority')], TOKEN_MESSENGER_MINTER_V2);

  // Instruction data: discriminator(8) + message(u32-len + bytes) + attestation(u32-len + bytes)
  const msgLen = Buffer.alloc(4);
  msgLen.writeUInt32LE(msgBuf.length, 0);
  const attLen = Buffer.alloc(4);
  attLen.writeUInt32LE(attBuf.length, 0);
  const data = Buffer.concat([
    Buffer.from(RECEIVE_MESSAGE_DISCRIMINATOR),
    msgLen, msgBuf,
    attLen, attBuf,
  ]);

  const keys: AccountMeta[] = [
    // ReceiveMessageContext
    { pubkey: walletPublicKey,            isSigner: true,  isWritable: true  }, // payer
    { pubkey: walletPublicKey,            isSigner: true,  isWritable: false }, // caller
    { pubkey: authorityPda,              isSigner: false, isWritable: false }, // authority_pda
    { pubkey: messageTransmitterConfig,  isSigner: false, isWritable: true  }, // message_transmitter
    { pubkey: usedNoncePda,              isSigner: false, isWritable: true  }, // used_nonce (init_if_needed)
    { pubkey: TOKEN_MESSENGER_MINTER_V2, isSigner: false, isWritable: false }, // receiver program
    { pubkey: SystemProgram.programId,   isSigner: false, isWritable: false },
    // event_cpi for MessageTransmitterV2
    { pubkey: eventAuthorityMt,          isSigner: false, isWritable: false },
    { pubkey: MESSAGE_TRANSMITTER_V2,    isSigner: false, isWritable: false },
    // Remaining accounts → forwarded to TokenMessengerMinterV2.handleReceiveMessage
    { pubkey: tokenMessengerPda,         isSigner: false, isWritable: false },
    { pubkey: remoteTokenMessengerPda,   isSigner: false, isWritable: false },
    { pubkey: tokenMinterPda,            isSigner: false, isWritable: false },
    { pubkey: localTokenPda,             isSigner: false, isWritable: true  },
    { pubkey: tokenPairPda,              isSigner: false, isWritable: false },
    { pubkey: recipientAta,              isSigner: false, isWritable: true  }, // mint_recipient ATA
    { pubkey: SOLANA_USDC_MINT,          isSigner: false, isWritable: true  },
    { pubkey: TOKEN_PROGRAM_ID,          isSigner: false, isWritable: false },
    // event_cpi for TokenMessengerMinterV2
    { pubkey: eventAuthorityTmm,         isSigner: false, isWritable: false },
    { pubkey: TOKEN_MESSENGER_MINTER_V2, isSigner: false, isWritable: false },
  ];

  const instruction = new TransactionInstruction({
    programId: MESSAGE_TRANSMITTER_V2,
    keys,
    data,
  });

  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const transaction = new Transaction({
    recentBlockhash: blockhash,
    feePayer: walletPublicKey,
  });

  if (!recipientAtaExists) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        walletPublicKey,
        recipientAta,
        walletPublicKey,
        SOLANA_USDC_MINT,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }

  transaction.add(instruction);

  return { transaction };
}
