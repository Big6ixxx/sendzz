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
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import crypto from 'crypto';
import { type AttestationResponse, type AttestationStatus, CCTP_DOMAINS, type SupportedChain } from './gateway';
import { IS_TESTNET } from '../web3/network';
import { HOME_CHAIN } from '@/lib/explorers';


// ── Constants ────────────────────────────────────────────────────────────────

export const SOLANA_CCTP_DOMAIN = 5;
export const BASE_CCTP_DOMAIN = 6;

export const TOKEN_MESSENGER_MINTER_V2 = new PublicKey(
  'CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe',
);
export const MESSAGE_TRANSMITTER_V2 = new PublicKey(
  'CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC',
);
const IS_SIMULATION = IS_TESTNET;

/** Circle's USDC mint — devnet and mainnet-beta are different tokens. */
export const SOLANA_USDC_MINT = new PublicKey(
  IS_SIMULATION
    ? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
    : 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
);

const IRIS_API_BASE = IS_SIMULATION
  ? 'https://iris-api-sandbox.circle.com/v2'
  : 'https://iris-api.circle.com/v2';

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
  destChain: SupportedChain = HOME_CHAIN,
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
    if (res.status === 404) return { status: 'not_found' };
    if (!res.ok) throw new Error(`Iris API error: ${res.statusText}`);

    const data = (await res.json()) as {
      messages?: { status: string; attestation?: string; message?: string; forwardTxHash?: string }[];
    };
    const message = data.messages?.[0];
    if (!message) return { status: 'not_found' };

    return {
      status: message.status as AttestationStatus,
      attestation: message.attestation
        ? (message.attestation.startsWith('0x') ? message.attestation : `0x${message.attestation}`)
        : undefined,
      messageBytes: message.message
        ? (message.message.startsWith('0x') ? message.message : `0x${message.message}`)
        : undefined,
      mintTxHash: message.forwardTxHash,
    };
  } catch (err) {
    console.error('[SolanaGateway] fetchAttestation error:', err);
    return { status: 'pending' };
  }
}

// ── Encoding a Solana destination on the burn side ─────────────────────────────

/**
 * Encode a Solana wallet public key as a 32-byte hex string (bytes32).
 * Solana public keys are already 32 bytes (base58 decoded), no padding needed.
 */
export function solanaAddressToBytes32(solanaAddress: string): `0x${string}` {
  const decoded = new PublicKey(solanaAddress).toBytes();
  return `0x${Buffer.from(decoded).toString('hex')}` as `0x${string}`;
}

/**
 * Encode the `mintRecipient` for a CCTP burn whose destination is Solana.
 *
 * This is the recipient's USDC token account, *not* their wallet. On Solana,
 * TokenMessengerMinterV2 loads `mint_recipient` directly as an SPL token account —
 * the owning wallet never appears in the instruction, so the program has nothing to
 * derive an ATA from. A wallet address here produces a message that can never be
 * received: no token account exists at that address, account deserialization fails
 * on every attempt, and the burned USDC is stranded permanently.
 */
export function solanaMintRecipientBytes32(solanaAddress: string): `0x${string}` {
  const ata = getAssociatedTokenAddressSync(SOLANA_USDC_MINT, new PublicKey(solanaAddress));
  return `0x${Buffer.from(ata.toBytes()).toString('hex')}` as `0x${string}`;
}

// ── CCTP V2 message layout ────────────────────────────────────────────────────

/**
 * A CCTP V2 message is not a V1 message with fields appended — the nonce widened
 * from a u64 to a bytes32, which grew the header from 116 to 148 bytes and shifted
 * everything after it. Decoding V2 at V1 offsets still yields well-formed-looking
 * values (they are real bytes, just from the wrong fields), so the mistake doesn't
 * surface until the runtime rejects a PDA whose seeds don't match. Hence the
 * explicit map:
 *
 *   Header (148 bytes)
 *      0..4   version                     4..8   sourceDomain
 *      8..12  destinationDomain          12..44  nonce (bytes32)
 *     44..76  sender                     76..108 recipient
 *    108..140 destinationCaller         140..144 minFinalityThreshold
 *    144..148 finalityThresholdExecuted
 *
 *   BurnMessage V2 body (228 bytes, starts at 148)
 *    148..152 version                   152..184 burnToken
 *    184..216 mintRecipient             216..248 amount
 *    248..280 messageSender             280..312 maxFee
 *    312..344 feeExecuted               344..376 expirationBlock
 */
const V2_OFF_SOURCE_DOMAIN = 4;
const V2_OFF_NONCE = 12;
const V2_OFF_DESTINATION_CALLER = 108;
const V2_OFF_BURN_TOKEN = 152;
const V2_OFF_MINT_RECIPIENT = 184;

/** Shortest prefix we need to read every field above. */
const V2_MIN_MESSAGE_LEN = V2_OFF_MINT_RECIPIENT + 32;

function toMessageBuffer(message: string | Buffer): Buffer {
  return Buffer.isBuffer(message) ? message : Buffer.from(message.replace(/^0x/, ''), 'hex');
}

export function decodeSourceDomainFromMessage(message: string | Buffer): number {
  return toMessageBuffer(message).readUInt32BE(V2_OFF_SOURCE_DOMAIN);
}

/** The full 32-byte V2 nonce — the seed for the `used_nonce` PDA. */
export function decodeNonceFromMessage(message: string | Buffer): Buffer {
  const buf = toMessageBuffer(message);
  return Buffer.from(buf.subarray(V2_OFF_NONCE, V2_OFF_NONCE + 32));
}

/** The source chain's USDC address as bytes32 — the seed for the `token_pair` PDA. */
export function decodeBurnTokenFromMessage(message: string | Buffer): Buffer {
  const buf = toMessageBuffer(message);
  return Buffer.from(buf.subarray(V2_OFF_BURN_TOKEN, V2_OFF_BURN_TOKEN + 32));
}

/** The SPL token account the mint is destined for. */
export function decodeMintRecipientFromMessage(message: string | Buffer): PublicKey {
  const buf = toMessageBuffer(message);
  return new PublicKey(buf.subarray(V2_OFF_MINT_RECIPIENT, V2_OFF_MINT_RECIPIENT + 32));
}

/**
 * The address restricted to delivering this message, or `null` when the field is
 * zeroed. Zeroed is the common case and it is what makes sponsored claims possible:
 * with no restriction, anyone may call `receive_message`, so the fee payer can
 * deliver it and the recipient never has to sign.
 */
export function decodeDestinationCallerFromMessage(message: string | Buffer): PublicKey | null {
  const buf = toMessageBuffer(message);
  const caller = buf.subarray(V2_OFF_DESTINATION_CALLER, V2_OFF_DESTINATION_CALLER + 32);
  if (caller.every((b) => b === 0)) return null;
  return new PublicKey(caller);
}

// ── receive_message ───────────────────────────────────────────────────────────

function getCustodyTokenPda(mint: PublicKey): PublicKey {
  return findPda([Buffer.from('custody'), mint.toBuffer()], TOKEN_MESSENGER_MINTER_V2);
}

/**
 * Offset of the `fee_recipient` field within the `token_messenger` account.
 *
 * CCTP V2 takes a fee on fast transfers, so `handle_receive_message` needs the fee
 * recipient's token account. Unlike every other account in the instruction it isn't
 * a PDA, so it has to be read out of on-chain state rather than derived.
 */
const TOKEN_MESSENGER_FEE_RECIPIENT_OFFSET = 109;

async function getFeeRecipientTokenAccount(connection: Connection): Promise<PublicKey> {
  const info = await connection.getAccountInfo(getTokenMessengerPda());
  if (!info || info.data.length < TOKEN_MESSENGER_FEE_RECIPIENT_OFFSET + 32) {
    throw new Error('Could not read the CCTP token messenger account on Solana.');
  }
  const feeRecipient = new PublicKey(
    info.data.subarray(
      TOKEN_MESSENGER_FEE_RECIPIENT_OFFSET,
      TOKEN_MESSENGER_FEE_RECIPIENT_OFFSET + 32,
    ),
  );
  return getAssociatedTokenAddressSync(SOLANA_USDC_MINT, feeRecipient, true);
}

/**
 * Observed usage is ~199k CU, which overruns the 200k default. Circle's own relayer
 * raises the limit explicitly; so do we, with headroom for the optional ATA creation.
 */
const RECEIVE_MESSAGE_COMPUTE_UNITS = 350_000;

export interface ReceiveMessageResult {
  transaction: Transaction;
  /** The token account the USDC will land in. */
  mintRecipient: PublicKey;
  /** True when the message's `used_nonce` PDA already exists — the claim is done. */
  alreadyClaimed: boolean;
}

/**
 * Build an unsigned Solana `receive_message` transaction for MessageTransmitterV2.
 *
 * This is the "mint" side of any chain → Solana CCTP transfer. The account list is
 * order-sensitive and has no on-chain names to check against, so it is transcribed
 * from live mainnet deliveries: 20 accounts, with `fee_recipient_token_account` and
 * `custody_token_account` around `mint_recipient`.
 *
 * @param connection     Solana RPC connection
 * @param payer          Pays the fee, the `used_nonce` rent, and any ATA rent
 * @param messageBytes   Hex string of the CCTP message (from Circle's Iris API)
 * @param attestation    Hex string of the Circle attestation
 * @param recipientOwner Wallet owning the destination ATA, so a missing one can be
 *                       created in the same transaction
 */
export async function buildReceiveMessageOnSolanaTx(
  connection: Connection,
  payer: PublicKey,
  messageBytes: string,
  attestation: string,
  recipientOwner?: PublicKey,
): Promise<ReceiveMessageResult> {
  const msgBuf = toMessageBuffer(messageBytes);
  const attBuf = Buffer.from(attestation.replace(/^0x/, ''), 'hex');

  if (msgBuf.length < V2_MIN_MESSAGE_LEN) {
    throw new Error('This transfer is not a CCTP V2 burn message.');
  }

  const sourceDomain = decodeSourceDomainFromMessage(msgBuf);
  const nonce = decodeNonceFromMessage(msgBuf);
  const burnToken = decodeBurnTokenFromMessage(msgBuf);
  const mintRecipient = decodeMintRecipientFromMessage(msgBuf);
  const destinationCaller = decodeDestinationCallerFromMessage(msgBuf);

  // Unrestricted messages let the payer double as the caller, which is what keeps
  // the claim fully sponsored. A restricted one must be delivered by the named
  // address — we cannot substitute the payer and must not pretend otherwise.
  const caller = destinationCaller ?? payer;

  const messageTransmitterConfig = getMessageTransmitterConfig();
  const authorityPda = getMessageTransmitterAuthorityPda(TOKEN_MESSENGER_MINTER_V2);
  const usedNoncePda = getUsedNoncePda(nonce);

  const tokenMessengerPda = getTokenMessengerPda();
  const remoteTokenMessengerPda = getRemoteTokenMessengerPda(sourceDomain);
  const tokenMinterPda = getTokenMinterPda();
  const localTokenPda = getLocalTokenPda(SOLANA_USDC_MINT);
  const tokenPairPda = getTokenPairPda(sourceDomain, burnToken);
  const custodyTokenAccount = getCustodyTokenPda(SOLANA_USDC_MINT);

  const eventAuthorityMt = findPda([Buffer.from('__event_authority')], MESSAGE_TRANSMITTER_V2);
  const eventAuthorityTmm = findPda([Buffer.from('__event_authority')], TOKEN_MESSENGER_MINTER_V2);

  const [feeRecipientTokenAccount, usedNonceInfo, mintRecipientInfo] = await Promise.all([
    getFeeRecipientTokenAccount(connection),
    connection.getAccountInfo(usedNoncePda),
    connection.getAccountInfo(mintRecipient),
  ]);

  if (usedNonceInfo !== null) {
    return { transaction: new Transaction(), mintRecipient, alreadyClaimed: true };
  }

  // The program loads `mint_recipient` as a token account. Anything else means the
  // burn encoded the wrong address and no amount of retrying will help, so fail with
  // a description of the actual problem instead of an Anchor deserialization error.
  const recipientAta = recipientOwner
    ? getAssociatedTokenAddressSync(SOLANA_USDC_MINT, recipientOwner)
    : null;
  const mintRecipientIsTokenAccount =
    mintRecipientInfo !== null && mintRecipientInfo.owner.equals(TOKEN_PROGRAM_ID);
  const canCreateMintRecipient =
    mintRecipientInfo === null && recipientAta !== null && recipientAta.equals(mintRecipient);

  if (!mintRecipientIsTokenAccount && !canCreateMintRecipient) {
    throw new Error(
      'This transfer names a Solana recipient that is not a USDC token account, so it cannot be claimed.',
    );
  }

  // Instruction data: discriminator(8) + message(u32 len + bytes) + attestation(u32 len + bytes)
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
    { pubkey: payer,                     isSigner: true,  isWritable: true  }, // payer
    { pubkey: caller,                    isSigner: true,  isWritable: false }, // caller
    { pubkey: authorityPda,              isSigner: false, isWritable: false }, // authority_pda
    { pubkey: messageTransmitterConfig,  isSigner: false, isWritable: false }, // message_transmitter
    { pubkey: usedNoncePda,              isSigner: false, isWritable: true  }, // used_nonce (init_if_needed)
    { pubkey: TOKEN_MESSENGER_MINTER_V2, isSigner: false, isWritable: false }, // receiver program
    { pubkey: SystemProgram.programId,   isSigner: false, isWritable: false }, // system_program
    // Anchor #[event_cpi] for MessageTransmitterV2
    { pubkey: eventAuthorityMt,          isSigner: false, isWritable: false },
    { pubkey: MESSAGE_TRANSMITTER_V2,    isSigner: false, isWritable: false },
    // Remaining accounts → forwarded to TokenMessengerMinterV2.handle_receive_message
    { pubkey: tokenMessengerPda,         isSigner: false, isWritable: false },
    { pubkey: remoteTokenMessengerPda,   isSigner: false, isWritable: false },
    { pubkey: tokenMinterPda,            isSigner: false, isWritable: false },
    { pubkey: localTokenPda,             isSigner: false, isWritable: true  },
    { pubkey: tokenPairPda,              isSigner: false, isWritable: false },
    { pubkey: feeRecipientTokenAccount,  isSigner: false, isWritable: true  },
    { pubkey: mintRecipient,             isSigner: false, isWritable: true  },
    { pubkey: custodyTokenAccount,       isSigner: false, isWritable: true  },
    { pubkey: TOKEN_PROGRAM_ID,          isSigner: false, isWritable: false },
    // Anchor #[event_cpi] for TokenMessengerMinterV2
    { pubkey: eventAuthorityTmm,         isSigner: false, isWritable: false },
    { pubkey: TOKEN_MESSENGER_MINTER_V2, isSigner: false, isWritable: false },
  ];

  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const transaction = new Transaction({ recentBlockhash: blockhash, feePayer: payer });

  transaction.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: RECEIVE_MESSAGE_COMPUTE_UNITS }),
  );

  if (canCreateMintRecipient) {
    // Rent is on the payer, not the recipient — the whole point is that claiming
    // costs the user nothing, and a fresh Solana wallet has no SOL to spend.
    transaction.add(
      createAssociatedTokenAccountInstruction(
        payer,
        mintRecipient,
        recipientOwner!,
        SOLANA_USDC_MINT,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
  }

  transaction.add(new TransactionInstruction({ programId: MESSAGE_TRANSMITTER_V2, keys, data }));

  return { transaction, mintRecipient, alreadyClaimed: false };
}
