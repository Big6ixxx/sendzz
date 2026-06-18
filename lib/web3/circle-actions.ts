import { toModularTransport } from '@circle-fin/modular-wallets-core';
import { EIP1193Provider } from '@privy-io/react-auth';
import { encodeFunctionData, parseAbi, parseUnits, type Address } from 'viem';
import { createBundlerClient } from 'viem/account-abstraction';
import { getCircleClient } from './circle-client';
import {
  chain as baseChain,
  CIRCLE_CLIENT_KEY,
  CIRCLE_SEND_URL,
  USDC_ADDRESS,
} from './config';
import { VIEM_CHAINS } from './multichain';
import { USDC_ADDRESSES, type SupportedChain } from '../circle/gateway';

const ERC20_ABI = parseAbi([
  'function transfer(address _to, uint256 _value) returns (bool)',
]);

// All operations default to mainnet
function getChainSlug(targetChain: SupportedChain): string {
  return targetChain;
}

export async function executeCircleGaslessTransfer(
  provider: EIP1193Provider,
  recipientAddress: string,
  amountUSDC: string,
  targetChain: SupportedChain = 'base'
) {
  return executeCircleGaslessBatchTransfer(provider, [
    { recipientAddress, amountUSDC },
  ], targetChain);
}

export async function executeCircleGaslessBatchTransfer(
  provider: EIP1193Provider,
  transfers: { recipientAddress: string; amountUSDC: string }[],
  targetChain: SupportedChain = 'base'
) {
  const selectedChain = VIEM_CHAINS[targetChain] || baseChain;
  const usdcContractAddress = USDC_ADDRESSES[targetChain] || USDC_ADDRESS;
  
  // Circle's bundler + paymaster endpoint — handles gas sponsorship via our policy
  const SEND_RPC_URL = `${CIRCLE_SEND_URL}/${getChainSlug(targetChain)}`;

  // 1. Get Circle smart account
  const { account } = await getCircleClient(
    provider as unknown as Parameters<typeof getCircleClient>[0],
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

  // 4. Send UserOperation in one batch
  console.log(`[BatchTransfer] Sending UserOp with ${calls.length} calls on ${targetChain}...`);

  const userOpHash = await bundlerClient.sendUserOperation({
    calls,
    paymaster: true,
  });

  console.log('[BatchTransfer] UserOp Hash:', userOpHash);

  // 5. Wait for transaction
  const receipt = await bundlerClient.waitForUserOperationReceipt({
    hash: userOpHash,
  });

  console.log('[BatchTransfer] Success:', receipt.receipt.transactionHash);
  return receipt.receipt.transactionHash;
}
