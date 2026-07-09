import {
  parseUnits,
  encodeFunctionData
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
  type SupportedChain,
  calculateMaxFee
} from '../circle/gateway';
import { getCircleClient } from './circle-client';
import { EVM_CHAINS, type ChainBalances, type SolanaSource } from './routing';
import { modularWalletActions } from '@circle-fin/modular-wallets-core';
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
      if (receipt?.receipt?.transactionHash) {
        return receipt.receipt.transactionHash;
      }
    } catch {
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
] as const;

export async function executeSmartBridge(
  embeddedWallet: ConnectedWallet,
  sourceChain: SupportedChain,
  amountUSDC: string,
  recipientAddress: string,
  destChain: SupportedChain = 'base'
): Promise<{ userOpHash: `0x${string}`; txHashPromise: Promise<string> }> {
  try {
    if (sourceChain === destChain) {
      throw new Error('Source and destination chains must differ');
    }
    const chain = VIEM_CHAINS[sourceChain];
    const usdcAddress = USDC_ADDRESSES[sourceChain];
    const destinationDomain = CCTP_DOMAINS[destChain];

    if (!chain || !usdcAddress) throw new Error('Unsupported chain config');

    toast.info(`Preparing gasless transfer on ${sourceChain}...`);
    const ethereumProvider = await embeddedWallet.getEthereumProvider();
    const { bundlerClient, account } = await getCircleClient(ethereumProvider, sourceChain);

    const amountRaw = parseUnits(amountUSDC, 6);
    const mintRecipient = `0x${'0'.repeat(24)}${recipientAddress.slice(2).toLowerCase()}` as `0x${string}`;
    const destinationCaller = `0x${'0'.repeat(64)}` as `0x${string}`;

    const policyId = GAS_POLICY_IDS[sourceChain];

    const modularClient = bundlerClient.extend(modularWalletActions);
    const gasPrices = await modularClient.getUserOperationGasPrice().catch(() => null);
    const gasLevel = gasPrices?.medium ?? gasPrices?.high ?? null;

    const maxPriorityFeePerGas = gasLevel?.maxPriorityFeePerGas
      ? BigInt(gasLevel.maxPriorityFeePerGas)
      : 1_000_000n;
    const maxFeePerGas = gasLevel?.maxFeePerGas
      ? BigInt(gasLevel.maxFeePerGas)
      : undefined;

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
    const maxFee = await calculateMaxFee(sourceChain, amountUSDC, destChain);

    const bridgeOpHash = await bundlerClient.sendUserOperation({
      account,
      calls: [{
        to: TOKEN_MESSENGER_V2 as `0x${string}`,
        data: encodeFunctionData({
          abi: TOKEN_MESSENGER_ABI,
          functionName: 'depositForBurn',
          args: [
            amountRaw,
            destinationDomain,
            mintRecipient as `0x${string}`,
            usdcAddress as `0x${string}`,
            destinationCaller,
            maxFee,
            1000 // minFinalityThreshold
          ],
        }),
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
] as const;

/**
 * Gaslessly submit a receiveMessage transaction on the destination chain using the
 * user's Privy smart account, minting the bridged USDC there. Used to complete CCTP
 * transfers when Circle's relayer doesn't auto-mint (non-EVM sources, and EVM→EVM
 * bridges to chains other than Base). The MessageTransmitterV2 contract shares one
 * CREATE2 address across all EVM chains, so only the bundler chain changes.
 */
export async function executeReceiveMessage(
  embeddedWallet: ConnectedWallet,
  messageHex: string,
  attestationHex: string,
  destChain: SupportedChain = 'base',
): Promise<string> {
  const MESSAGE_TRANSMITTER =
    process.env.NEXT_PUBLIC_SIMULATION_MODE === 'true'
      ? '0x81D40F2169b009c9103C280963d76e4B4d4c464B'
      : '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64';

  const provider = await embeddedWallet.getEthereumProvider();
  const { bundlerClient, account } = await getCircleClient(provider, destChain);

  const userOpHash = await bundlerClient.sendUserOperation({
    account,
    calls: [
      {
        to: MESSAGE_TRANSMITTER as `0x${string}`,
        data: encodeFunctionData({
          abi: MESSAGE_TRANSMITTER_ABI,
          functionName: 'receiveMessage',
          args: [messageHex as `0x${string}`, attestationHex as `0x${string}`],
        }),
      },
    ],
    paymaster: true,
  });

  return resolveUserOpToTxHash(bundlerClient, userOpHash);
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
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `/api/bridge/status?txHash=${burnTxHash}&sourceChain=${sourceChain}`,
      );
      const data = await res.json();
      if (data.status === 'complete') {
        let mintTxHash: string | undefined = data.mintTxHash;
        if (!mintTxHash && data.attestation && data.messageBytes) {
          onStatus?.(`Delivering on ${destChain}…`);
          mintTxHash = await executeReceiveMessage(
            embeddedWallet,
            data.messageBytes,
            data.attestation,
            destChain,
          );
        }
        return { burnTxHash, mintTxHash };
      }
    } catch (err) {
      console.warn('[bridgeAndDeliver] status poll error:', err);
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }

  // Burn settled but attestation/mint didn't complete in time — funds are safely bridged
  // and the mint can still be finalized later. Surface the burn hash.
  return { burnTxHash };
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
  },
): Promise<void> {
  const { targetChain, requiredAmount, balances, recipient, onStatus, solana } = params;
  const required = parseFloat(requiredAmount) || 0;
  const have = balances[targetChain] ?? 0;
  let remaining = (required - have) * 1.01; // 1% buffer for CCTP fees
  if (remaining <= 0) return;

  const sources = EVM_CHAINS.filter(
    (c) => c !== targetChain && (balances[c] ?? 0) > 0,
  ).sort((a, b) => (balances[b] ?? 0) - (balances[a] ?? 0));

  for (const source of sources) {
    if (remaining <= 0) break;
    const take = Math.min(balances[source] ?? 0, remaining);
    if (take <= 0) continue;
    onStatus?.(`Moving funds from ${CHAIN_NAMES[source]} to ${CHAIN_NAMES[targetChain]}…`);
    await bridgeAndDeliver(embeddedWallet, {
      sourceChain: source,
      destChain: targetChain,
      amountUSDC: take.toFixed(6),
      recipient,
      onStatus,
    });
    remaining -= take;
  }

  // Solana can only bridge to Base (CCTP mints there). Draw on it last if still short.
  if (remaining > 0 && targetChain === 'base' && solana && solana.balance > 0) {
    const take = Math.min(solana.balance, remaining);
    onStatus?.(`Moving funds from Solana to ${CHAIN_NAMES[targetChain]}…`);
    await solana.bridgeToBase(take.toFixed(6), recipient, onStatus);
    remaining -= take;
  }
}
