import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, fallback, type Chain } from 'viem';
import { mainnet, arbitrum, avalanche, optimism, polygon, base } from 'viem/chains';
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

// Reliable public RPC fallbacks — always available, no rate limits
const PUBLIC_RPCS: Record<SupportedChain, string> = {
  arbitrum:  'https://arb1.arbitrum.io/rpc',
  avalanche: 'https://api.avax.network/ext/bc/C/rpc',
  ethereum:  'https://cloudflare-eth.com',
  optimism:  'https://mainnet.optimism.io',
  polygon:   'https://polygon-rpc.com',
  base:      'https://mainnet.base.org',
};

function makeClient(chain: Chain, alchemyUrl?: string, publicUrl?: string) {
  const transports = [
    ...(alchemyUrl ? [http(alchemyUrl, { timeout: 8000, retryCount: 1 })] : []),
    ...(publicUrl  ? [http(publicUrl,  { timeout: 10000, retryCount: 2 })] : []),
  ];
  return createPublicClient({
    chain,
    // fallback() tries each transport in order, moving to the next on any error (incl. 429)
    transport: transports.length > 1 ? fallback(transports) : transports[0],
  });
}

function getClients(): Record<SupportedChain, ReturnType<typeof createPublicClient>> {
  const key = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || '';
  const alchemy = (subdomain: string) =>
    key ? `https://${subdomain}.g.alchemy.com/v2/${key}` : undefined;

  return {
    ethereum:  makeClient(mainnet,   process.env.ETHEREUM_RPC_URL  || alchemy('eth-mainnet'),     PUBLIC_RPCS.ethereum),
    arbitrum:  makeClient(arbitrum,  process.env.ARBITRUM_RPC_URL  || alchemy('arb-mainnet'),     PUBLIC_RPCS.arbitrum),
    avalanche: makeClient(avalanche, process.env.AVALANCHE_RPC_URL || alchemy('avax-mainnet'),    PUBLIC_RPCS.avalanche),
    optimism:  makeClient(optimism,  process.env.OPTIMISM_RPC_URL  || alchemy('opt-mainnet'),     PUBLIC_RPCS.optimism),
    polygon:   makeClient(polygon,   process.env.POLYGON_RPC_URL   || alchemy('polygon-mainnet'), PUBLIC_RPCS.polygon),
    base:      makeClient(base,      process.env.NEXT_PUBLIC_RPC_URL,                             PUBLIC_RPCS.base),
  };
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
        return { chain, balance: '0', hasBalance: false };
      }
    }),
  );

  return NextResponse.json(results.filter((r) => r.hasBalance));
}
