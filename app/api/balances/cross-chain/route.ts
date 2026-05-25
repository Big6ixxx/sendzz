import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { mainnet, arbitrum, avalanche, optimism, polygon } from 'viem/chains';
import { USDC_ADDRESSES, SOURCE_CHAINS, type SupportedChain } from '@/lib/circle/gateway';

const BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

function makeClient(chain: any, rpcUrl?: string) {
  return createPublicClient({
    chain,
    transport: http(rpcUrl || undefined, { timeout: 5000, retryCount: 1 }),
  });
}

function getClients(): Record<SupportedChain, ReturnType<typeof createPublicClient>> {
  const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || '';
  
  return {
    ethereum: makeClient(mainnet, process.env.ETHEREUM_RPC_URL || (alchemyKey ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}` : undefined)),
    arbitrum: makeClient(arbitrum, process.env.ARBITRUM_RPC_URL || (alchemyKey ? `https://arb-mainnet.g.alchemy.com/v2/${alchemyKey}` : undefined)),
    avalanche: makeClient(avalanche, process.env.AVALANCHE_RPC_URL || (alchemyKey ? `https://avax-mainnet.g.alchemy.com/v2/${alchemyKey}` : undefined)),
    optimism: makeClient(optimism, process.env.OPTIMISM_RPC_URL || (alchemyKey ? `https://opt-mainnet.g.alchemy.com/v2/${alchemyKey}` : undefined)),
    polygon: makeClient(polygon, process.env.POLYGON_RPC_URL || (alchemyKey ? `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}` : undefined)),
    // base is destination — not scanned
    base: makeClient(mainnet),
  } as any;
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address');

  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
  }

  const clients = getClients();

  const results = await Promise.all(
    SOURCE_CHAINS.map(async (chain) => {
      try {
        const client = clients[chain];
        const usdcAddress = USDC_ADDRESSES[chain];

        const balance = await client.readContract({
          address: usdcAddress as `0x${string}`,
          abi: BALANCE_ABI,
          functionName: 'balanceOf',
          args: [address as `0x${string}`],
        });

        const formatted = (Number(balance) / 1_000_000).toString();
        return { chain, balance: formatted, hasBalance: Number(balance) > 0 };
      } catch (err) {
        console.error(`[cross-chain balances] Error on ${chain}:`, err);
        return { chain, balance: '0', hasBalance: false };
      }
    }),
  );

  return NextResponse.json(results.filter((r) => r.hasBalance));
}
