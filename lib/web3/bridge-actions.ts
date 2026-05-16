import { 
  createWalletClient, 
  custom, 
  parseUnits, 
  type PublicClient,
  encodeFunctionData 
} from 'viem';
import { MULTICHAIN_CLIENTS, VIEM_CHAINS } from './multichain';
import { 
  TOKEN_MESSENGER_V2, 
  USDC_ADDRESSES, 
  CCTP_DOMAINS, 
  type SupportedChain,
  calculateMaxFee
} from '../circle/gateway';
import { getCircleClient } from './circle-client';
import { toast } from 'sonner';

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
  embeddedWallet: any,
  sourceChain: SupportedChain,
  amountUSDC: string,
  recipientAddress: string
) {
  try {
    const chain = VIEM_CHAINS[sourceChain];
    const usdcAddress = USDC_ADDRESSES[sourceChain];
    const destinationDomain = CCTP_DOMAINS.base;

    if (!chain || !usdcAddress) throw new Error('Unsupported chain config');

    // 1. Get Circle Smart Account Client for the source chain
    toast.info(`Preparing gasless transfer on ${sourceChain}...`);
    const ethereumProvider = await embeddedWallet.getEthereumProvider();
    const { bundlerClient, account } = await getCircleClient(ethereumProvider, sourceChain);

    const amountRaw = parseUnits(amountUSDC, 6);
    const mintRecipient = '0x' + '0'.repeat(24) + recipientAddress.slice(2).toLowerCase();

    // 2. Execute Approve
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
    });
    await bundlerClient.waitForUserOperationReceipt({ hash: approveOpHash });
    toast.success('Approval confirmed');

    // 3. Execute Deposit for Burn
    toast.info('Initiating bridge transfer...');
    const maxFee = await calculateMaxFee(sourceChain, amountUSDC);
    const destinationCaller = ('0x' + '0'.repeat(64)) as `0x${string}`;

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
    });

    toast.info('Bridge transaction sent! Finalizing...');
    
    // 4. Wait for the UserOperation to be included
    const receipt = await bundlerClient.waitForUserOperationReceipt({
      hash: bridgeOpHash,
    });

    toast.success('Bridge transaction confirmed!');
    return receipt.receipt.transactionHash;
  } catch (error: any) {
    console.error('[SmartBridge] Execution error:', error);
    
    // Better rejection message
    const errorMsg = error.message || '';
    if (errorMsg.toLowerCase().includes('user rejected') || errorMsg.toLowerCase().includes('denied')) {
      toast.error('Transaction cancelled by user');
      throw new Error('User cancelled');
    }

    toast.error(error.message || 'Bridge failed');
    throw error;
  }
}
