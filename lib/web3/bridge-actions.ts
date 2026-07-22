import {
  parseUnits,
  encodeFunctionData,
  createPublicClient,
  http,
  keccak256
} from 'viem';
import { type BundlerClient } from 'viem/account-abstraction';
import { type ConnectedWallet } from '@privy-io/react-auth';
import { VIEM_CHAINS } from './multichain';
import {
  TOKEN_MESSENGER_V2,
  USDC_ADDRESSES,
  CCTP_DOMAINS,
  GAS_POLICY_IDS,
  CHAIN_NAMES,
  CHAIN_IDS,
  type SupportedChain,
  type AttestationResponse,
  calculateMaxFee
} from '../circle/gateway';
import { solanaAddressToBytes32 } from '../circle/solana-gateway';

import { getCircleClient, getStandardRpcUrl } from './circle-client';
import { EVM_CHAINS, type ChainBalances, type SolanaSource, type SourceChainKey } from './routing';
import { toast } from 'sonner';

export async function resolveUserOpToTxHash(
  bundlerClient: BundlerClient,
  userOpHash: `0x${string}`,
  timeoutMs = 300_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const receipt = await bundlerClient.getUserOperationReceipt({ hash: userOpHash });
      if (receipt) {
        if (receipt.success === false) {
          throw new Error('UserOperation reverted on-chain');
        }
        if (receipt.receipt?.transactionHash) {
          return receipt.receipt.transactionHash;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'UserOperation reverted on-chain') {
        throw err;
      }
      // receipt not yet available
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(`UserOperation ${userOpHash} not confirmed within ${timeoutMs / 1000}s`);
}

const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const TOKEN_MESSENGER_ABI = [
  {
    name: 'depositForBurn',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'burnToken', type: 'address' },
      { name: 'destinationCaller', type: 'bytes32' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'minFinalityThreshold', type: 'uint32' },
    ],
    outputs: [{ name: 'nonce', type: 'uint64' }],
  },
  {
    name: 'depositForBurnWithHook',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'burnToken', type: 'address' },
      { name: 'destinationCaller', type: 'bytes32' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'minFinalityThreshold', type: 'uint32' },
      { name: 'hookData', type: 'bytes' },
    ],
    outputs: [{ name: 'nonce', type: 'uint64' }],
  },
] as const;

export async function executeSmartBridge(
  embeddedWallet: ConnectedWallet,
  sourceChain: SupportedChain,
  amountUSDC: string,
  recipientAddress: string,
  destChain: SupportedChain | 'stellar' | 'solana' = 'base'
): Promise<{ userOpHash: `0x${string}`; txHashPromise: Promise<string> }> {

  try {
    if (sourceChain === destChain) {
      throw new Error('Source and destination chains must differ');
    }
    const chain = VIEM_CHAINS[sourceChain];
    const usdcAddress = USDC_ADDRESSES[sourceChain];
    const destinationDomain = destChain === 'stellar'
      ? 27
      : destChain === 'solana'
        ? 5
        : CCTP_DOMAINS[destChain as SupportedChain];


    if (!chain || !usdcAddress) throw new Error('Unsupported chain config');

    toast.info(`Preparing gasless transfer on ${sourceChain}...`);
    const ethereumProvider = await embeddedWallet.getEthereumProvider();
    const { bundlerClient, account } = await getCircleClient(ethereumProvider, sourceChain);

    const amountRaw = parseUnits(amountUSDC, 6);
    
    let mintRecipient: `0x${string}`;
    let destinationCaller = `0x${'0'.repeat(64)}` as `0x${string}`;
    let hookData: `0x${string}` | undefined;

    if (destChain === 'stellar') {
      const { StrKey } = await import('@stellar/stellar-sdk');
      // Set mintRecipient and destinationCaller to CctpForwarder contract address
      const forwarderRawBytes = StrKey.decodeContract('CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T');
      mintRecipient = `0x${forwarderRawBytes.toString('hex')}`;
      destinationCaller = `0x${forwarderRawBytes.toString('hex')}`;

      // Build CCTP V2 hookData for Stellar:
      // magic (24 bytes) + version (4 bytes) + length (4 bytes uint32 BE) + recipient strkey string
      const magic = Buffer.alloc(24, 0);
      const version = Buffer.alloc(4, 0);
      const addrBytes = Buffer.from(recipientAddress, 'utf-8');
      const lenBuf = Buffer.alloc(4, 0);
      lenBuf.writeUInt32BE(addrBytes.length, 0);
      
      hookData = `0x${Buffer.concat([magic, version, lenBuf, addrBytes]).toString('hex')}` as `0x${string}`;
    } else if (destChain === 'solana') {
      // For Solana destination: mintRecipient is the recipient's Solana public key as bytes32
      mintRecipient = solanaAddressToBytes32(recipientAddress);
    } else {
      mintRecipient = `0x${'0'.repeat(24)}${recipientAddress.slice(2).toLowerCase()}` as `0x${string}`;
    }


    const policyId = GAS_POLICY_IDS[sourceChain];

    const standardRpcClient = createPublicClient({
      chain: VIEM_CHAINS[sourceChain],
      transport: http(getStandardRpcUrl(sourceChain)),
    });
    const feeData = await standardRpcClient.estimateFeesPerGas().catch(() => null);
    const defaultPriorityFee = sourceChain === 'polygon' ? 30_000_000_000n : 1_000_000n;
    const defaultMaxFee = sourceChain === 'polygon' ? 35_000_000_000n : undefined;

    const maxPriorityFeePerGas = feeData?.maxPriorityFeePerGas 
      ? feeData.maxPriorityFeePerGas 
      : defaultPriorityFee;

    const maxFeePerGas = feeData?.maxFeePerGas 
      ? feeData.maxFeePerGas 
      : defaultMaxFee;

    toast.info('Approving USDC transfer...');
    const approveOpHash = await bundlerClient.sendUserOperation({
      account,
      calls: [{
        to: usdcAddress as `0x${string}`,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [TOKEN_MESSENGER_V2 as `0x${string}`, amountRaw],
        }),
      }],
      maxFeePerGas,
      maxPriorityFeePerGas,
      paymaster: true,
      paymasterContext: policyId ? { policyId } : undefined,
    });
    // Use our polling helper — Circle's bundler transport ignores the timeout param
    await resolveUserOpToTxHash(bundlerClient, approveOpHash);
    toast.success('Approval confirmed');

    // 3. Execute Deposit for Burn
    toast.info('Initiating bridge transfer...');
    const amountVal = parseFloat(amountUSDC);
    // Always use Fast Transfer (1000) — Standard Transfer (2000) takes 13+ minutes.
    const minFinalityThreshold = 1000;
    const maxFee = await calculateMaxFee(sourceChain, amountUSDC, destChain, minFinalityThreshold);

    const callData = destChain === 'stellar'
      ? encodeFunctionData({
          abi: TOKEN_MESSENGER_ABI,
          functionName: 'depositForBurnWithHook',
          args: [
            amountRaw,
            destinationDomain,
            mintRecipient,
            usdcAddress as `0x${string}`,
            destinationCaller,
            maxFee,
            minFinalityThreshold,
            hookData!
          ],
        })
      : encodeFunctionData({
          abi: TOKEN_MESSENGER_ABI,
          functionName: 'depositForBurn',
          args: [
            amountRaw,
            destinationDomain,
            mintRecipient,
            usdcAddress as `0x${string}`,
            destinationCaller,
            maxFee,
            minFinalityThreshold
          ],
        });

    const bridgeOpHash = await bundlerClient.sendUserOperation({
      account,
      calls: [{
        to: TOKEN_MESSENGER_V2 as `0x${string}`,
        data: callData,
      }],
      maxFeePerGas,
      maxPriorityFeePerGas,
      paymaster: true,
      paymasterContext: policyId ? { policyId } : undefined,
    });

    toast.info('Bridge transaction sent! Finalizing...');

    // 4. Return immediately with the userOp hash and a background promise for the tx hash.
    // waitForUserOperationReceipt can be slow on Arbitrum — we don't block the UI on it.
    const txHashPromise = resolveUserOpToTxHash(bundlerClient, bridgeOpHash);
    txHashPromise
      .then(() => toast.success('Bridge transaction confirmed on-chain!'))
      .catch((e) => console.warn('[SmartBridge] tx resolution failed:', e));

    return { userOpHash: bridgeOpHash, txHashPromise };
  } catch (error: unknown) {
    // Full error dump — copy from console for easy debugging
    const err = error as Record<string, unknown>;
    console.error('[SmartBridge] ❌ Execution error:', error);
    console.error('[SmartBridge] message:', err?.message);
    console.error('[SmartBridge] cause:', err?.cause);
    console.error('[SmartBridge] details:', err?.details);
    console.error('[SmartBridge] shortMessage:', err?.shortMessage);
    console.error('[SmartBridge] metaMessages:', err?.metaMessages);
    console.error('[SmartBridge] data:', err?.data);
    console.error('[SmartBridge] full JSON:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));

    // Better rejection message
    const errorMsg = typeof err?.message === 'string' ? err.message : '';
    if (errorMsg.toLowerCase().includes('user rejected') || errorMsg.toLowerCase().includes('denied')) {
      toast.error('Transaction cancelled by user');
      throw new Error('User cancelled');
    }

    // Show the most descriptive message available
    const displayMsg =
      (typeof err?.shortMessage === 'string' && err.shortMessage) ||
      (typeof err?.details === 'string' && err.details) ||
      errorMsg ||
      'Bridge failed';

    toast.error(displayMsg);
    throw error;
  }
}

const MESSAGE_TRANSMITTER_ABI = [
  {
    name: 'receiveMessage',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'message', type: 'bytes' },
      { name: 'attestation', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'processedMessages',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'messageHash', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

/**
 * Gaslessly submit a receiveMessage transaction on the destination chain using the
 * user's Privy smart account, minting the bridged USDC there. Used to complete CCTP
 * transfers when Circle's relayer doesn't auto-mint (non-EVM sources, and EVM→EVM
 * bridges to chains other than Base). The MessageTransmitterV2 contract shares one
 * CREATE2 address across all EVM chains, so only the bundler chain changes.
 */
const pendingClaims = new Set<string>();

export async function executeReceiveMessage(
  embeddedWallet: ConnectedWallet,
  messageHex: string,
  attestationHex: string,
  destChain: SupportedChain = 'base',
): Promise<string> {
  const normMessage = messageHex.toLowerCase();
  if (pendingClaims.has(normMessage)) {
    console.warn('[executeReceiveMessage] Claim already in progress for this message.');
    return 'N/A';
  }
  pendingClaims.add(normMessage);

  let MESSAGE_TRANSMITTER = '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64';
  let messageHash: `0x${string}` = '0x0000000000000000000000000000000000000000000000000000000000000000';
  let standardRpcClient: any = null;

  try {
    if (process.env.NEXT_PUBLIC_SIMULATION_MODE === 'true') {
      MESSAGE_TRANSMITTER = '0x81D40F2169b009c9103C280963d76e4B4d4c464B';
    }

    const chainId = CHAIN_IDS[destChain];
  const chainHex = `0x${chainId.toString(16)}`;

  // 1. Attempt to switch the network via Privy ConnectedWallet API
  await embeddedWallet.switchChain(chainId).catch((err) => {
    console.warn("[executeReceiveMessage] Privy switchChain failed, fallback to provider request...", err);
  });

  // 2. Allow network switch state to propagate in the Privy iframe
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // 3. Re-acquire the EIP1193 provider to fetch the updated chain configuration
  let ethereumProvider = await embeddedWallet.getEthereumProvider();

  // 4. Verify chain ID and force switch via direct EIP1193 RPC request if not matched
  const currentChainHex = await ethereumProvider.request({ method: 'eth_chainId' }).catch(() => null);
  if (currentChainHex !== chainHex) {
    console.log(`[executeReceiveMessage] Provider chain is ${currentChainHex}, forcing switch to ${chainHex}...`);
    try {
      await ethereumProvider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainHex }],
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      ethereumProvider = await embeddedWallet.getEthereumProvider();
    } catch (switchErr) {
      console.error("[executeReceiveMessage] Forced chain switch failed:", switchErr);
    }
  }

  // Fallback for Ethereum mainnet L1 and Avalanche since gas sponsorship/bundlers are not supported/feasible there.
  // This submits the transaction directly from the user's Privy EOA wallet and triggers the Privy wallet confirmation.
  if (destChain === 'ethereum' || destChain === 'avalanche') {
    const { createWalletClient, custom } = await import('viem');
    const [eoaAddress] = await ethereumProvider.request({
      method: 'eth_requestAccounts',
    }) as `0x${string}`[];

    const walletClient = createWalletClient({
      chain: VIEM_CHAINS[destChain],
      transport: custom(ethereumProvider),
    });

    const hash = await walletClient.writeContract({
      address: MESSAGE_TRANSMITTER as `0x${string}`,
      abi: MESSAGE_TRANSMITTER_ABI,
      functionName: 'receiveMessage',
      args: [
        (messageHex.startsWith('0x') ? messageHex : `0x${messageHex}`) as `0x${string}`,
        (attestationHex.startsWith('0x') ? attestationHex : `0x${attestationHex}`) as `0x${string}`,
      ],
      account: eoaAddress,
    });
    return hash;
  }

  // getCircleClient calls eth_requestAccounts internally — Privy providers can return []
  // on the first call if the wallet is still initialising. Retry once after a short delay.
  let circleResult: Awaited<ReturnType<typeof getCircleClient>>;
  try {
    circleResult = await getCircleClient(ethereumProvider, destChain);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('no accounts')) {
      console.warn('[executeReceiveMessage] Privy wallet not ready, retrying in 2s…');
      await new Promise((r) => setTimeout(r, 2000));
      const freshProvider = await embeddedWallet.getEthereumProvider();
      circleResult = await getCircleClient(freshProvider, destChain);
    } else {
      throw err;
    }
  }
  const { bundlerClient, account } = circleResult;

  // Normalize hex strings — Circle Iris API may return them without 0x prefix
  const normalizedMessage = (messageHex.startsWith('0x') ? messageHex : `0x${messageHex}`) as `0x${string}`;
  const normalizedAttestation = (attestationHex.startsWith('0x') ? attestationHex : `0x${attestationHex}`) as `0x${string}`;

  messageHash = keccak256(normalizedMessage);

  // Use gas policy if one exists for the dest chain, otherwise rely on
  // Circle's default paymaster (no context needed — works on Base).
  const policyId = GAS_POLICY_IDS[destChain];

  standardRpcClient = createPublicClient({
    chain: VIEM_CHAINS[destChain],
    transport: http(getStandardRpcUrl(destChain)),
  });

  const isProcessed = await standardRpcClient.readContract({
    address: MESSAGE_TRANSMITTER as `0x${string}`,
    abi: MESSAGE_TRANSMITTER_ABI,
    functionName: 'processedMessages',
    args: [messageHash],
  }).catch(() => false);

  if (isProcessed) {
    console.log('[executeReceiveMessage] Message already processed on-chain.');
    const mintTx = await findMintTxHashFromLogs(standardRpcClient, MESSAGE_TRANSMITTER, messageHash);
    if (mintTx) return mintTx;
    return 'N/A'; // fallback mock hash
  }
  const feeData = await standardRpcClient.estimateFeesPerGas().catch(() => null);
  const defaultPriorityFee = destChain === 'polygon' ? 30_000_000_000n : 1_000_000n;
  const defaultMaxFee = destChain === 'polygon' ? 35_000_000_000n : undefined;

  const maxPriorityFeePerGas = feeData?.maxPriorityFeePerGas 
    ? feeData.maxPriorityFeePerGas 
    : defaultPriorityFee;

  const maxFeePerGas = feeData?.maxFeePerGas 
    ? feeData.maxFeePerGas 
    : defaultMaxFee;

    const userOpHash = await bundlerClient.sendUserOperation({
      account,
      calls: [
        {
          to: MESSAGE_TRANSMITTER as `0x${string}`,
          data: encodeFunctionData({
            abi: MESSAGE_TRANSMITTER_ABI,
            functionName: 'receiveMessage',
            args: [normalizedMessage, normalizedAttestation],
          }),
        },
      ],
      maxFeePerGas,
      maxPriorityFeePerGas,
      paymaster: true,
      ...(policyId ? { paymasterContext: { policyId } } : {}),
    });

    // Poll both standard RPC client (processedMessages) and bundler client (with timeout) for instant, hang-free resolution
    const deadline = Date.now() + 15_000; // Poll for max 15 seconds to avoid freezing the UI
    while (Date.now() < deadline) {
      const receipt = await withTimeout(
        bundlerClient.getUserOperationReceipt({ hash: userOpHash }),
        2000
      ).catch(() => null);

      if (receipt?.receipt?.transactionHash) {
        return receipt.receipt.transactionHash;
      }

      const isProcessedNow = await standardRpcClient.readContract({
        address: MESSAGE_TRANSMITTER as `0x${string}`,
        abi: MESSAGE_TRANSMITTER_ABI,
        functionName: 'processedMessages',
        args: [messageHash],
      }).catch(() => false);

      if (isProcessedNow) {
        console.log('[executeReceiveMessage] Message processed on-chain during polling. Returning userOpHash.');
        return userOpHash;
      }

      await new Promise((r) => setTimeout(r, 2000));
    }

    console.log('[executeReceiveMessage] Polling timed out. Returning userOpHash in-flight.');
    return userOpHash;
  } catch (error) {
    if (standardRpcClient) {
      const isProcessedNow = await standardRpcClient.readContract({
        address: MESSAGE_TRANSMITTER as `0x${string}`,
        abi: MESSAGE_TRANSMITTER_ABI,
        functionName: 'processedMessages',
        args: [messageHash],
      }).catch(() => false);

      if (isProcessedNow) {
        console.log('[executeReceiveMessage] UserOperation reverted because message is already processed. Recovering mint hash...');
        const mintTx = await findMintTxHashFromLogs(standardRpcClient, MESSAGE_TRANSMITTER, messageHash);
        if (mintTx) return mintTx;
        return 'N/A';
      }
    }
    throw error;
  } finally {
    pendingClaims.delete(normMessage);
  }
}

/**
 * Bridge USDC from one chain to another and deliver it straight to `recipient` on the
 * destination, end to end. Used by the external-address transfer flow when the user's
 * funds are on a different chain than the recipient.
 *
 * CCTP's mintRecipient is the recipient itself, so no separate transfer is needed. The
 * burn and mint live on different chains separated by Circle's attestation, so this
 * cannot be a single transaction — it burns on the source, waits for the attestation,
 * then mints on the destination (Circle's relayed mint if present, else submits
 * `receiveMessage` itself).
 *
 * Resolves once the destination mint is in flight; rejects only if the burn fails.
 */
export async function bridgeAndDeliver(
  embeddedWallet: ConnectedWallet,
  params: {
    sourceChain: SupportedChain;
    destChain: SupportedChain;
    amountUSDC: string;
    recipient: string;
    onStatus?: (status: string) => void;
    timeoutMs?: number;
  },
): Promise<{ burnTxHash: string; mintTxHash?: string }> {
  const { sourceChain, destChain, amountUSDC, recipient, onStatus } = params;
  const timeoutMs = params.timeoutMs ?? 20 * 60_000;

  onStatus?.(`Bridging from ${sourceChain}…`);
  const { txHashPromise } = await executeSmartBridge(
    embeddedWallet,
    sourceChain,
    amountUSDC,
    recipient,
    destChain,
  );
  const burnTxHash = await txHashPromise;

  onStatus?.('Waiting for network confirmation…');
  let attestationData: AttestationResponse | null = null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `/api/bridge/status?txHash=${burnTxHash}&sourceChain=${sourceChain}`,
      );
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'complete') {
          attestationData = data;
          break;
        }
      }
    } catch (err) {
      console.warn('[bridgeAndDeliver] status poll error:', err);
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }

  if (!attestationData) {
    throw new Error('Bridge attestation timed out');
  }

  const MESSAGE_TRANSMITTER =
    process.env.NEXT_PUBLIC_SIMULATION_MODE === 'true'
      ? '0x81D40F2169b009c9103C280963d76e4B4d4c464B'
      : '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64';

  let mintTxHash: string | undefined = attestationData.mintTxHash;
  if (!mintTxHash && attestationData.attestation && attestationData.messageBytes) {
    const messageHash = keccak256(attestationData.messageBytes as `0x${string}`);
    const standardRpcClient = createPublicClient({
      chain: VIEM_CHAINS[destChain],
      transport: http(getStandardRpcUrl(destChain)),
    });
    const isProcessed = await standardRpcClient.readContract({
      address: MESSAGE_TRANSMITTER as `0x${string}`,
      abi: MESSAGE_TRANSMITTER_ABI,
      functionName: 'processedMessages',
      args: [messageHash],
    }).catch(() => false);

    if (isProcessed) {
      console.log('[bridgeAndDeliver] Message already processed on-chain. Skipping manual claim popup.');
      mintTxHash = await findMintTxHashFromLogs(standardRpcClient, MESSAGE_TRANSMITTER, messageHash);
      if (!mintTxHash) {
        mintTxHash = 'N/A';
      }
    } else {
      onStatus?.(`Delivering on ${destChain}…`);
      mintTxHash = await executeReceiveMessage(
        embeddedWallet,
        attestationData.messageBytes,
        attestationData.attestation,
        destChain,
      );
    }
  }

  return { burnTxHash, mintTxHash };
}

/**
 * Move enough USDC onto `targetChain` to cover `requiredAmount`, by bridging from the
 * user's other chains (largest balances first, to minimise the number of hops). Used by
 * batch and off-ramp flows when funds are too fragmented to complete on a single chain.
 *
 * Bridges run sequentially and each waits for CCTP settlement, so this can take several
 * minutes. A 1% buffer is added to absorb CCTP fees. No-op if the target already holds
 * enough.
 */
export async function consolidateFundsToChain(
  embeddedWallet: ConnectedWallet,
  params: {
    targetChain: SupportedChain;
    requiredAmount: string;
    balances: ChainBalances;
    recipient: string;
    onStatus?: (status: string) => void;
    /** Optional Solana source — drawn from last (only when target is Base). */
    solana?: SolanaSource;
    /** Optional Stellar source — drawn from last (only when target is Base). */
    stellar?: {
      walletId: string;
      address: string;
      balance: number;
      bridgeToBase: (amount: string, recipient: string, onStatus?: (status: string) => void) => Promise<void>;
    };
  },
): Promise<void> {
  const { targetChain, requiredAmount, balances, recipient, onStatus, solana, stellar } = params;
  const required = parseFloat(requiredAmount) || 0;
  const have = balances[targetChain] ?? 0;
  let remaining = (required - have) * 1.01; // 1% buffer for CCTP fees
  if (remaining <= 0) return;

  interface UnifiedSource {
    type: 'evm' | 'solana' | 'stellar';
    chain: SourceChainKey;
    balance: number;
  }

  const allSources: UnifiedSource[] = [];

  // Add EVM sources (excluding target chain)
  for (const c of EVM_CHAINS) {
    if (c !== targetChain && (balances[c] ?? 0) > 0) {
      allSources.push({ type: 'evm', chain: c, balance: balances[c]! });
    }
  }

  // Add Solana source (only if target is Base)
  if (targetChain === 'base' && solana && solana.balance > 0) {
    allSources.push({ type: 'solana', chain: 'solana', balance: solana.balance });
  }

  // Add Stellar source (only if target is Base)
  if (targetChain === 'base' && stellar && stellar.balance > 0) {
    allSources.push({ type: 'stellar', chain: 'stellar', balance: stellar.balance });
  }

  // Sort all sources descending by balance
  allSources.sort((a, b) => b.balance - a.balance);

  for (const source of allSources) {
    if (remaining <= 0) break;
    const take = Math.min(source.balance, remaining);
    if (take <= 0) continue;

    if (source.type === 'evm') {
      const evmChain = source.chain as SupportedChain;
      onStatus?.(`Moving funds from ${CHAIN_NAMES[evmChain]} to ${CHAIN_NAMES[targetChain]}…`);
      await bridgeAndDeliver(embeddedWallet, {
        sourceChain: evmChain,
        destChain: targetChain,
        amountUSDC: take.toFixed(6),
        recipient,
        onStatus,
      });
    } else if (source.type === 'solana' && solana) {
      onStatus?.(`Moving funds from Solana to ${CHAIN_NAMES[targetChain]}…`);
      await solana.bridgeToBase(take.toFixed(6), recipient, onStatus);
    } else if (source.type === 'stellar' && stellar) {
      onStatus?.(`Moving funds from Stellar to ${CHAIN_NAMES[targetChain]}…`);
      await stellar.bridgeToBase(take.toFixed(6), recipient, onStatus);
    }
    remaining -= take;
  }
}

const MESSAGE_RECEIVED_EVENT = {
  name: 'MessageReceived',
  type: 'event',
  inputs: [
    { name: 'foreignSender', type: 'address', indexed: true },
    { name: 'sourceDomain', type: 'uint32', indexed: true },
    { name: 'nonce', type: 'uint64', indexed: true },
    { name: 'messageHash', type: 'bytes32', indexed: false },
  ],
} as const;

async function findMintTxHashFromLogs(
  publicClient: any,
  messageTransmitterAddress: string,
  messageHash: `0x${string}`
): Promise<string | undefined> {
  try {
    const currentBlock = await publicClient.getBlockNumber();
    const fromBlock = currentBlock - 5000n > 0n ? currentBlock - 5000n : 0n;

    const logs = await publicClient.getLogs({
      address: messageTransmitterAddress as `0x${string}`,
      event: MESSAGE_RECEIVED_EVENT,
      fromBlock,
    });
    const match = logs.find((log: any) => log.args?.messageHash === messageHash);
    return match?.transactionHash;
  } catch (err) {
    console.warn('[findMintTxHashFromLogs] failed:', err);
  }
  return undefined;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('timeout')), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}
