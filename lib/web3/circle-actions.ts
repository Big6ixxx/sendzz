import { toModularTransport } from '@circle-fin/modular-wallets-core';
import { EIP1193Provider } from '@privy-io/react-auth';
import { encodeFunctionData, parseAbi, parseUnits, type Address } from 'viem';
import { createBundlerClient } from 'viem/account-abstraction';
import { getCircleClient } from './circle-client';
import {
  chain,
  CIRCLE_CLIENT_KEY,
  CIRCLE_SEND_URL,
  USDC_ADDRESS,
} from './config';

const ERC20_ABI = parseAbi([
  'function transfer(address _to, uint256 _value) returns (bool)',
]);

// Chain slug for Circle modular transport URL
const CHAIN_SLUG = chain.id === 8453 ? 'base' : 'base-sepolia';

// Circle's bundler + paymaster endpoint — handles gas sponsorship via our policy
const SEND_RPC_URL = `${CIRCLE_SEND_URL}/${CHAIN_SLUG}`;

export async function executeCircleGaslessTransfer(
  provider: EIP1193Provider,
  recipientAddress: string,
  amountUSDC: string,
) {
  return executeCircleGaslessBatchTransfer(provider, [
    { recipientAddress, amountUSDC },
  ]);
}

export async function executeCircleGaslessBatchTransfer(
  provider: EIP1193Provider,
  transfers: { recipientAddress: string; amountUSDC: string }[],
) {
  // 1. Get Circle smart account
  const { account } = await getCircleClient(
    provider as unknown as Parameters<typeof getCircleClient>[0],
  );

  // 2. Create bundler client using Circle's send transport
  const sendTransport = toModularTransport(SEND_RPC_URL, CIRCLE_CLIENT_KEY!);

  const bundlerClient = createBundlerClient({
    chain,
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
      to: USDC_ADDRESS as Address,
      data: transferData,
      value: 0n,
    };
  });

  // 4. Send UserOperation in one batch
  // Note: Circle's modularTransport handles gas sponsorship natively via the
  // configured gas policy — do NOT pass paymaster:true here, which would tell
  // viem to call ERC-7677 pm_getPaymasterData methods that Circle doesn't expose.
  console.log(`[BatchTransfer] Sending UserOp with ${calls.length} calls...`);

  const userOpHash = await bundlerClient.sendUserOperation({ calls });

  console.log('[BatchTransfer] UserOp Hash:', userOpHash);

  // 5. Wait for transaction
  const receipt = await bundlerClient.waitForUserOperationReceipt({
    hash: userOpHash,
  });

  console.log('[BatchTransfer] Success:', receipt.receipt.transactionHash);
  return receipt.receipt.transactionHash;
}
