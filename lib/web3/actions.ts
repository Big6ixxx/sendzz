import { createSmartAccountClient, PaymasterMode } from '@biconomy/account';
import { encodeFunctionData, formatUnits, parseUnits, createWalletClient, custom } from 'viem';
import { BICONOMY_BUNDLER_URL, BICONOMY_PAYMASTER_URL, USDC_ADDRESS, VIEM_PUBLIC_CLIENT, chain } from './config';

import { parseAbi } from 'viem';

const ERC20_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address _to, uint256 _value) returns (bool)'
]);

/**
 * Fetches the USDC balance of a given address.
 */
export async function getUSDCBalance(address: string): Promise<string> {
  try {
    const balance = await VIEM_PUBLIC_CLIENT.readContract({
      address: USDC_ADDRESS as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    });
    return formatUnits(balance, 6);
  } catch (error) {
    console.error('Error fetching USDC balance:', error);
    return '0';
  }
}



/**
 * Initializes a Biconomy Smart Account using the Privy embedded wallet EIP1193 provider.
 * This now uses the server-side proxy for Bundler and Paymaster to keep API keys secret.
 */
export async function getSmartAccount(provider: any) {
  try {
    console.log('[getSmartAccount] Step 1: Requesting accounts...');
    // Fetch the current address
    const [address] = await provider.request({ method: 'eth_requestAccounts' });
    console.log('[getSmartAccount] Step 1 passed, address:', address);

    console.log('[getSmartAccount] Step 2: Creating Viem wallet client on chain:', chain.id);
    const walletClient = createWalletClient({
      account: address,
      chain,
      transport: custom(provider),
    });
    console.log('[getSmartAccount] Step 2 passed, walletClient created.');

    console.log('[getSmartAccount] Step 3: Creating Biconomy smart account...', {
      bundlerUrl: BICONOMY_BUNDLER_URL,
      paymasterUrl: BICONOMY_PAYMASTER_URL || undefined,
    });
    
    const account = await createSmartAccountClient({
      signer: walletClient,
      bundlerUrl: BICONOMY_BUNDLER_URL,
      paymasterUrl: BICONOMY_PAYMASTER_URL || undefined,
    });
    
    console.log('[getSmartAccount] Step 3 passed, smart account created successfully.');
    return account;
  } catch (error) {
    console.error('[getSmartAccount] FATAL ERROR:', error);
    throw error;
  }
}

/**
 * Executes a gasless USDC transfer to the recipient's smart account via Circle Paymaster
 */
export async function executeGaslessTransfer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  provider: any,
  recipientAddress: string,
  amountUSDC: string
) {
  const smartAccount = await getSmartAccount(provider);
  const amountParsed = parseUnits(amountUSDC, 6);

  const transferData = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [recipientAddress as `0x${string}`, amountParsed],
  });

  const tx = {
    to: USDC_ADDRESS,
    data: transferData,
  };

  // Dispatch the ERC-4337 UserOperation gaslessly
  const userOpResponse = await smartAccount.sendTransaction(tx, {
    paymasterServiceData: { mode: PaymasterMode.SPONSORED },
  });

  const { transactionHash } = await userOpResponse.waitForTxHash();
  return transactionHash;
}
