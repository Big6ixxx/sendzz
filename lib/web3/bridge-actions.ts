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
  type SupportedChain,
  calculateMaxFee
} from '../circle/gateway';
import { getCircleClient } from './circle-client';
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
  recipientAddress: string
): Promise<{ userOpHash: `0x${string}`; txHashPromise: Promise<string> }> {
  try {
    const chain = VIEM_CHAINS[sourceChain];
    const usdcAddress = USDC_ADDRESSES[sourceChain];
    const destinationDomain = CCTP_DOMAINS.base;

    if (!chain || !usdcAddress) throw new Error('Unsupported chain config');

    toast.info(`Preparing gasless transfer on ${sourceChain}...`);
    const ethereumProvider = await embeddedWallet.getEthereumProvider();
    const { bundlerClient, account } = await getCircleClient(ethereumProvider, sourceChain);

    const amountRaw = parseUnits(amountUSDC, 6);
    const mintRecipient = `0x${'0'.repeat(24)}${recipientAddress.slice(2).toLowerCase()}` as `0x${string}`;
    const destinationCaller = `0x${'0'.repeat(64)}` as `0x${string}`;

    // Gas policy IDs per chain — set in .env
    const GAS_POLICY_IDS: Record<string, string | undefined> = {
      arbitrum: process.env.NEXT_PUBLIC_CIRCLE_GAS_POLICY_ARBITRUM,
      avalanche: process.env.NEXT_PUBLIC_CIRCLE_GAS_POLICY_AVALANCHE,
      ethereum: process.env.NEXT_PUBLIC_CIRCLE_GAS_POLICY_ETHEREUM,
    };
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
      // @ts-ignore: Circle extension allows boolean for gas sponsorship
      paymaster: true,
      paymasterContext: policyId ? { policyId } : undefined,
    });
    // Use our polling helper — Circle's bundler transport ignores the timeout param
    await resolveUserOpToTxHash(bundlerClient, approveOpHash);
    toast.success('Approval confirmed');

    // 3. Execute Deposit for Burn
    toast.info('Initiating bridge transfer...');
    const maxFee = await calculateMaxFee(sourceChain, amountUSDC);

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
      // @ts-ignore: Circle extension allows boolean for gas sponsorship
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
