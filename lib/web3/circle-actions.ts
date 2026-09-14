import { toModularTransport } from '@circle-fin/modular-wallets-core';
import { EIP1193Provider } from '@privy-io/react-auth';
import { createPublicClient, encodeFunctionData, parseAbi, parseUnits, type Address } from 'viem';
import { createBundlerClient } from 'viem/account-abstraction';
import { getCircleClient } from './circle-client';
import {
  CIRCLE_CLIENT_KEY,
  CIRCLE_SEND_URL,
} from './config';
import { VIEM_CHAINS } from './multichain';
import { USDC_ADDRESSES, GAS_POLICY_IDS, type SupportedChain } from '../circle/gateway';
import { type RouteLeg } from './routing';
import { rpcTransport } from './rpc';
import {
  sponsoredUserOpFees,
  sendWithAdaptiveVerificationGas,
  resolveUserOpToTxHash,
} from './bridge-actions';

/**
 * How long to wait for a UserOperation to be included before giving up on watching it.
 *
 * Five minutes, against viem's 120s default. The transfer is already irreversible by this point,
 * so the only thing a short wait buys is an incorrect failure message.
 */
const USEROP_CONFIRM_MS = 300_000;

const ERC20_ABI = parseAbi([
  'function transfer(address _to, uint256 _value) returns (bool)',
]);

// All operations default to mainnet
function getChainSlug(targetChain: SupportedChain): string {
  return targetChain;
}

/**
 * Called the instant the bundler accepts the UserOperation — the point of no return.
 *
 * This is the only moment at which the operation is both committed AND identifiable: before it,
 * there is no hash; after it, the wait may time out or the tab may close, and whatever we have
 * not written down is unrecoverable. Anything this does must be non-fatal.
 */
export type OnBroadcast = (userOpHash: string) => void | Promise<void>;

export async function executeCircleGaslessTransfer(
  provider: EIP1193Provider,
  recipientAddress: string,
  amountUSDC: string,
  targetChain: SupportedChain = 'base',
  onBroadcast?: OnBroadcast,
) {
  return executeCircleGaslessBatchTransfer(provider, [
    { recipientAddress, amountUSDC },
  ], targetChain, onBroadcast);
}

/**
 * Execute a routed transfer to a single recipient. The route engine may split the
 * amount across several chains (multi-source); each leg is an independent gasless
 * transfer on its own chain. Returns the tx hash of every leg in order.
 *
 * Note: legs are NOT atomic across chains. They run sequentially; if a later leg
 * fails, earlier legs have already settled. The caller surfaces partial state.
 */
export async function executeRoutedTransfer(
  provider: EIP1193Provider,
  recipientAddress: string,
  legs: RouteLeg[],
  /** Called per leg as each is accepted by the bundler — legs settle independently. */
  onBroadcast?: (userOpHash: string, leg: RouteLeg) => void | Promise<void>,
): Promise<string[]> {
  const txHashes: string[] = [];
  for (const leg of legs) {
    const hash = await executeCircleGaslessTransfer(
      provider,
      recipientAddress,
      leg.amount,
      leg.chain,
      onBroadcast ? (userOpHash) => onBroadcast(userOpHash, leg) : undefined,
    );
    txHashes.push(hash);
  }
  return txHashes;
}

export async function executeCircleGaslessBatchTransfer(
  provider: EIP1193Provider,
  transfers: { recipientAddress: string; amountUSDC: string }[],
  targetChain: SupportedChain = 'base',
  onBroadcast?: OnBroadcast,
) {
  const selectedChain = VIEM_CHAINS[targetChain];
  const usdcContractAddress = USDC_ADDRESSES[targetChain];

  // Falling back to Base's chain and token address for an unrecognised chain would send
  // real USDC using the wrong contract — refuse instead of guessing.
  if (!selectedChain || !usdcContractAddress) {
    throw new Error(`Unsupported chain for transfer: ${targetChain}`);
  }
  
  // Circle's bundler + paymaster endpoint — handles gas sponsorship via our policy
  const SEND_RPC_URL = `${CIRCLE_SEND_URL}/${getChainSlug(targetChain)}`;

  // 1. Get Circle smart account
  const { account } = await getCircleClient(
    provider as unknown as Parameters<typeof getCircleClient>[0],
    targetChain
  );

  // 2. Create bundler client using Circle's send transport
  const sendTransport = toModularTransport(SEND_RPC_URL, CIRCLE_CLIENT_KEY!);

  const bundlerClient = createBundlerClient({
    chain: selectedChain,
    transport: sendTransport,
    account,
  });

  // 3. Encode all transfers as multiple calls
  const calls = transfers.map((t) => {
    const amountParsed = parseUnits(t.amountUSDC, 6);
    const transferData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [t.recipientAddress as Address, amountParsed],
    });

    return {
      to: usdcContractAddress as Address,
      data: transferData,
      value: 0n,
    };
  });

  const policyId = GAS_POLICY_IDS[targetChain];

  const standardRpcClient = createPublicClient({
    chain: selectedChain,
    transport: rpcTransport(targetChain),
  });

  const { maxFeePerGas, maxPriorityFeePerGas } = await sponsoredUserOpFees(
    bundlerClient,
    standardRpcClient,
    targetChain,
  );

  // 4. Send UserOperation in one batch with adaptive verification gas and chain-specific fee floors
  console.log(`[BatchTransfer] Sending UserOp with ${calls.length} calls on ${targetChain}...`);

  const userOpHash = await sendWithAdaptiveVerificationGas(targetChain, (verificationGasLimit: bigint | undefined) =>
    bundlerClient.sendUserOperation({
      account,
      calls,
      maxFeePerGas,
      maxPriorityFeePerGas,
      verificationGasLimit,
      paymaster: true,
      paymasterContext: policyId ? { policyId } : undefined,
    }),
  );

  console.log('[BatchTransfer] UserOp Hash:', userOpHash);

  // The bundler has it and will include it. Write the intent down NOW, while we still can —
  // everything after this line is a wait that may not survive. Failures here are swallowed: a
  // bookkeeping problem must never fail a transfer the user has already paid for.
  if (onBroadcast) {
    try {
      await onBroadcast(userOpHash);
    } catch (err) {
      console.error('[BatchTransfer] onBroadcast failed (continuing):', err);
    }
  }

  // 5. Wait for inclusion.
  //
  // `sendUserOperation` returning is the point of no return: the bundler has the UserOp and will
  // include it. viem's own waitForUserOperationReceipt gives up after 120s and throws, which the
  // caller could only read as a failed send — so a busy chain produced an error on screen, a
  // reduced balance, and no ledger row, for a transfer that went through moments later.
  //
  // resolveUserOpToTxHash polls the bundler instead, for long enough to cover real congestion,
  // and distinguishes "reverted on-chain" (a true failure) from "not confirmed yet".
  const txHash = await resolveUserOpToTxHash(bundlerClient, userOpHash, USEROP_CONFIRM_MS);

  console.log('[BatchTransfer] Success:', txHash);
  return txHash;
}
