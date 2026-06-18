import { formatUnits } from 'viem';
import { USDC_ADDRESS, VIEM_PUBLIC_CLIENT } from './config';
import { MULTICHAIN_CLIENTS } from './multichain';
import { USDC_ADDRESSES, type SupportedChain } from '../circle/gateway';

import { parseAbi } from 'viem';

const ERC20_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address _to, uint256 _value) returns (bool)',
]);

/**
 * Fetches the USDC balance of a given address.
 * Defaults to Base for backward compatibility.
 */
export async function getUSDCBalance(address: string, chain: SupportedChain = 'base'): Promise<string> {
  try {
    const client = MULTICHAIN_CLIENTS[chain] || VIEM_PUBLIC_CLIENT;
    const usdcAddress = USDC_ADDRESSES[chain] || USDC_ADDRESS;

    const balance = await client.readContract({
      address: usdcAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    });
    return formatUnits(balance as bigint, 6);
  } catch (error) {
    console.error(`Error fetching USDC balance on ${chain}:`, error);
    return '0';
  }
}
