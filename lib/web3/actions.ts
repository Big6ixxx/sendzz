import { formatUnits} from 'viem';
import {  USDC_ADDRESS, VIEM_PUBLIC_CLIENT, } from './config';

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